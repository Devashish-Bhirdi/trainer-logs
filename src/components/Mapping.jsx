import { useState, useEffect, useCallback, Fragment } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase'; // adjust this path if needed
import { exportMappingToExcel } from '../services/mappingExportService';

// ---------- Mapping helpers (pure functions, no Firebase) ----------

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// Keyed per batch, so two batches with the same topic / module / lesson stay separate
const lessonKey = (batchId, topic, moduleName, lesson) =>
  `${batchId}||${norm(topic)}||${norm(moduleName)}||${norm(lesson)}`;

// keeps the first of each repeat (case-insensitive) and the original order
const unique = (list) => {
  const seen = new Set();
  return list.filter((item) => {
    const key = norm(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

// Firestore Timestamp | Date | 'YYYY-MM-DD'  ->  'YYYY-MM-DD'
// (the entry form saves dates as midnight UTC, so they are read back in UTC too)
const toDateKey = (value) => {
  if (!value) return '';
  const d = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

const formatDateKey = (key) => {
  if (!key) return 'N/A';
  const [y, m, d] = key.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};

// Compares the curriculum with the trainers' entries.
//   - a lesson in an entry counts as covered when (batch, topic, module, lesson) exists in the curriculum
//   - any lesson that is NOT in the curriculum is an extra
//
// Each curriculum document looks like:
//   { name, data: { topic: { module: [lessons] } }, batch: { batchId: batchName }, campusName, ... }
// and applies to EVERY batch in its `batch` map. `batchFilter` (optional) limits the result to one batch.
//
// Returns { dailyRows, pendingRows } for the two tables.
const buildMapping = (entries, curriculumDocs, getTrainerName, batchFilter = '') => {
  // 1. flatten the curriculum into unique (batch, topic, module, lesson) rows
  //    (if two documents cover the same batch, a repeated lesson is only counted once)
  const curriculumLessons = new Map();
  curriculumDocs.forEach(({ data, batch, campusName }) => {
    Object.entries(batch || {}).forEach(([batchId, batchName]) => {
      if (batchFilter && batchId !== batchFilter) return;

      Object.entries(data || {}).forEach(([topicName, modules]) => {
        Object.entries(modules || {}).forEach(([moduleName, lessons]) => {
          (lessons || []).forEach((lesson) => {
            const key = lessonKey(batchId, topicName, moduleName, lesson);
            if (!curriculumLessons.has(key)) {
              curriculumLessons.set(key, {
                topic: topicName,
                module: moduleName,
                lesson,
                batchId,
                batchName,
                campusName,
              });
            }
          });
        });
      });
    });
  });

  // 2. walk the entries: build the daily rows, note which curriculum lessons were covered,
  //    and share each session's hours across the lessons it touched
  const coveredKeys = new Set();
  const hoursByGroup = {};   // "batch||topic||module" -> estimated hours
  const daily = {};          // "date||batch"          -> row

  entries.forEach((entry) => {
    // older entries saved a single "subtopic" text instead of a lessons list
    const lessons = Array.isArray(entry.lessons) ? entry.lessons : (entry.subtopic ? [entry.subtopic] : []);
    const hours = Number(entry.hours) || 0;
    const perLesson = lessons.length ? hours / lessons.length : 0;

    const dateKey = toDateKey(entry.date);
    const rowKey = `${dateKey}||${entry.batchId}`;
    if (!daily[rowKey]) {
      daily[rowKey] = {
        dateKey,
        batchId: entry.batchId,
        batchName: entry.batchName || '',
        trainers: new Set(),
        topics: new Set(),
        covered: [],
        extra: [],
        hours: 0,
        studentCounts: [],
      };
    }
    const row = daily[rowKey];
    row.trainers.add(getTrainerName(entry));
    if (entry.topic) row.topics.add(entry.topic);
    row.hours += hours;
    if (entry.studentCount != null) row.studentCounts.push(Number(entry.studentCount) || 0);

    lessons.forEach((lesson) => {
      const key = lessonKey(entry.batchId, entry.topic, entry.module, lesson);
      const match = curriculumLessons.get(key);
      if (match) {
        coveredKeys.add(key);
        const groupKey = `${match.batchId}||${norm(match.topic)}||${norm(match.module)}`;
        hoursByGroup[groupKey] = (hoursByGroup[groupKey] || 0) + perLesson;
        row.covered.push(match.lesson);   // use the curriculum's own spelling
      } else {
        row.extra.push(lesson);           // not in the curriculum -> extra
      }
    });
  });

  const dailyRows = Object.values(daily)
    .map((r) => ({
      ...r,
      trainers: [...r.trainers],
      topics: [...r.topics],
      covered: unique(r.covered),
      extra: unique(r.extra),
      // highest single-session count for that batch/day (not summed)
      students: r.studentCounts.length ? Math.max(...r.studentCounts) : null,
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.batchName.localeCompare(b.batchName));

  // 3. pending lessons, grouped by batch -> topic -> module
  const groups = {};
  curriculumLessons.forEach((item, key) => {
    const groupKey = `${item.batchId}||${norm(item.topic)}||${norm(item.module)}`;
    if (!groups[groupKey]) {
      groups[groupKey] = {
        batchId: item.batchId,
        batchName: item.batchName || '',
        campusName: item.campusName || '',
        topic: item.topic,
        module: item.module,
        total: 0,
        covered: 0,
        hoursCovered: hoursByGroup[groupKey] || 0,
        pendingLessons: [],
      };
    }
    const g = groups[groupKey];
    g.total += 1;
    if (coveredKeys.has(key)) g.covered += 1;
    else g.pendingLessons.push(item.lesson);
  });

  // sorted by campus, then batch, so grouping in the UI is just a walk over the list
  const pendingRows = Object.values(groups).sort(
    (a, b) =>
      a.campusName.localeCompare(b.campusName) ||
      a.batchName.localeCompare(b.batchName) ||
      a.topic.localeCompare(b.topic) ||
      a.module.localeCompare(b.module)
  );

  return { dailyRows, pendingRows };
};

// campus -> batch -> rows (campusName is '' for projects without campuses)
const groupPending = (rows) => {
  const campusMap = new Map();
  rows.forEach((r) => {
    if (!campusMap.has(r.campusName)) campusMap.set(r.campusName, new Map());
    const batchMap = campusMap.get(r.campusName);
    if (!batchMap.has(r.batchId)) batchMap.set(r.batchId, { batchName: r.batchName, rows: [] });
    batchMap.get(r.batchId).rows.push(r);
  });
  return [...campusMap].map(([campusName, batchMap]) => ({ campusName, batches: [...batchMap.values()] }));
};

// totals for a set of pending rows, shown on collapsed group headers
const summarize = (rows) => {
  const total = rows.reduce((n, r) => n + r.total, 0);
  const covered = rows.reduce((n, r) => n + r.covered, 0);
  return { total, covered, pending: total - covered };
};

// Arrow + label (+ short summary while collapsed) for a campus / batch header
const GroupToggle = ({ open, label, summary }) => (
  <span className="flex items-center gap-2">
    <svg
      className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 12 12"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4 2l5 4-5 4z" />
    </svg>
    <span>{label}</span>
    {!open && summary && (
      <span className="ml-2 text-xs font-normal text-gray-600">
        {summary.covered} / {summary.total} covered, {summary.pending} pending
      </span>
    )}
  </span>
);

// shared table styling
const TH = 'px-4 py-3 text-left text-xs font-semibold text-white';
const THC = 'px-4 py-3 text-center text-xs font-semibold text-white';
const TD = 'px-4 py-3 whitespace-nowrap text-sm text-gray-900';
const TDC = 'px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-center';

const Mapping = () => {
  const [entries, setEntries] = useState([]);
  const [projects, setProjects] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [isExporting, setIsExporting] = useState(false); // loading state during async export
  const [exportError, setExportError] = useState(null);  // surface errors to the user

  // ---- Mapping data ----
  const [curriculum, setCurriculum] = useState([]);                // curriculum documents for the current filters
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [curriculumLoading, setCurriculumLoading] = useState(false);

  // keys of collapsed groups in the pending table: `c:<campusName>` and `b:<batchId>`
  const [collapsed, setCollapsed] = useState(() => new Set());

  const [filters, setFilters] = useState({
    project: '',
    campus: '',
    batch: '',
    trainer: '',
    startDate: '',
    endDate: ''
  });

  const [projectHasCampuses, setProjectHasCampuses] = useState(true);

  // Data loads as soon as a project is chosen; campus / batch / trainer / dates just narrow it down
  const filtersReady = !!filters.project;

  // Fetch projects and trainers when component loads
  useEffect(() => {
    fetchProjects();
    fetchTrainers();
  }, []);

  // Fetch campuses and batches whenever project changes
  useEffect(() => {
    if (filters.project) {
      fetchCampuses(filters.project);
      fetchBatchesForProject(filters.project);
    } else {
      setCampuses([]);
      setBatches([]);
      setFilters(prev => ({
        ...prev,
        campus: '',
        batch: ''
      }));
      setProjectHasCampuses(true);
    }
  }, [filters.project]);

  // Reload batches whenever the campus changes or is cleared
  // (clearing it goes back to every batch in the project)
  useEffect(() => {
    if (!filters.project) return;
    if (filters.campus) fetchBatchesForCampus(filters.campus);
    else fetchBatchesForProject(filters.project);
  }, [filters.campus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dates are NOT part of the query (that would need a composite index);
  // they are applied in memory further down, so changing a date never refetches.
  const fetchEntries = useCallback(async () => {
    if (!filtersReady) {
      setEntries([]);
      return;
    }

    setEntriesLoading(true);
    try {
      const constraints = [where('projectId', '==', filters.project)];

      if (filters.campus) {
        constraints.push(where('campusId', '==', filters.campus));
      }
      if (filters.batch) {
        constraints.push(where('batchId', '==', filters.batch));
      }
      if (filters.trainer) {
        constraints.push(where('trainerId', '==', filters.trainer));
      }

      const querySnapshot = await getDocs(query(collection(db, 'entries'), ...constraints));
      const entriesData = [];
      querySnapshot.forEach((doc) => {
        entriesData.push({ id: doc.id, ...doc.data() });
      });

      setEntries(entriesData);
    }
    catch (error) {
      console.error('Error fetching entries:', error);
      setEntries([]); // don't leave old results on screen
    } finally {
      setEntriesLoading(false);
    }

  }, [filters.project, filters.campus, filters.batch, filters.trainer, filtersReady]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Load the curriculum once a project is chosen, narrowed by campus when that is set.
  // The batch filter is NOT part of the query: a document holds a map of batches, so the
  // batch is applied in memory (see buildMapping's batchFilter).
  useEffect(() => {
    if (!filtersReady) {
      setCurriculum([]);
      setCurriculumLoading(false);
      return;
    }

    let cancelled = false; // ignore the result if the filters changed while this was loading
    const loadCurriculum = async () => {
      setCurriculumLoading(true);
      try {
        const constraints = [where('projectId', '==', filters.project)];
        if (filters.campus) constraints.push(where('campusId', '==', filters.campus));

        const snapshot = await getDocs(query(collection(db, 'curriculum'), ...constraints));
        if (!cancelled) setCurriculum(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error('Error fetching curriculum:', error);
        if (!cancelled) setCurriculum([]);
      } finally {
        if (!cancelled) setCurriculumLoading(false);
      }
    };
    loadCurriculum();

    return () => { cancelled = true; };
  }, [filtersReady, filters.project, filters.campus]);

  // Fetch all projects
  const fetchProjects = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'projects'));

      const projectsData = [];

      querySnapshot.forEach((doc) => {
        projectsData.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Sort projects alphabetically by name
      projectsData.sort((a, b) =>
        (a.name || '')
          .toString()
          .localeCompare((b.name || '').toString())
      );

      setProjects(projectsData);
    } catch (error) {
      console.error('Error fetching projects:', error);
    }
  };

  // Fetch campuses belonging to selected project
  const fetchCampuses = async (projectId) => {
    try {
      const q = query(
        collection(db, 'campuses'),
        where('projectId', '==', projectId)
      );

      const querySnapshot = await getDocs(q);

      const campusesData = [];

      querySnapshot.forEach((doc) => {
        campusesData.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Sort campuses alphabetically by name
      campusesData.sort((a, b) =>
        (a.name || '')
          .toString()
          .localeCompare((b.name || '').toString())
      );

      setCampuses(campusesData);

      // Used to determine whether batches should depend on campus
      setProjectHasCampuses(campusesData.length > 0);
    } catch (error) {
      console.error('Error fetching campuses:', error);
      setProjectHasCampuses(true);
    }
  };

  // Fetch all batches belonging to selected project
  // (the batch selection is reset by handleFilterChange, not here)
  const fetchBatchesForProject = async (projectId) => {
    try {
      const q = query(
        collection(db, 'batches'),
        where('projectId', '==', projectId)
      );

      const querySnapshot = await getDocs(q);

      const batchesData = [];

      querySnapshot.forEach((doc) => {
        batchesData.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Sort batches alphabetically by name
      batchesData.sort((a, b) =>
        (a.name || '')
          .toString()
          .localeCompare((b.name || '').toString())
      );

      setBatches(batchesData);
    } catch (error) {
      console.error('Error fetching batches for project:', error);
      setBatches([]);
    }
  };

  // Fetch batches belonging to selected campus
  // (the batch selection is reset by handleFilterChange, not here)
  const fetchBatchesForCampus = async (campusId) => {
    try {
      const q = query(
        collection(db, 'batches'),
        where('campusId', '==', campusId)
      );

      const querySnapshot = await getDocs(q);

      const batchesData = [];

      querySnapshot.forEach((doc) => {
        batchesData.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Sort batches alphabetically by name
      batchesData.sort((a, b) =>
        (a.name || '')
          .toString()
          .localeCompare((b.name || '').toString())
      );

      setBatches(batchesData);
    } catch (error) {
      console.error('Error fetching batches for campus:', error);
      setBatches([]);
    }
  };

  const fetchTrainers = async () => {
    try {
      const q = query(collection(db, 'users'), where('role', '==', 'trainer'));
      const querySnapshot = await getDocs(q);
      const trainerData = [];
      querySnapshot.forEach((doc) => {
        trainerData.push({ id: doc.id, ...doc.data() });
      });
      trainerData.sort((a, b) => ((a.name || a.email) || '').toString().localeCompare(((b.name || b.email) || '').toString()));
      setTrainers(trainerData);
    }
    catch (error) {
      console.error('Error fetching trainer:', error);
    }
  };

  const getTrainerDisplay = (trainerId, entry) => {
    const t = trainers.find(tr => tr.id === trainerId || tr.uid === trainerId);
    if (t) return t.name || t.email || t.uid || 'N/A';
    return (entry && (entry.trainerName || entry.trainerEmail)) || 'N/A';
  };

  // Handle Project, Campus and Batch changes
  const handleFilterChange = (filterName, value) => {
    // When project changes, reset campus and batch
    if (filterName === 'project') {
      setFilters(prev => ({
        ...prev,
        project: value,
        campus: '',
        batch: ''
      }));
    }

    // When campus changes, reset batch
    else if (filterName === 'campus') {
      setFilters(prev => ({
        ...prev,
        campus: value,
        batch: ''
      }));
    }

    // Normal filter change
    else {
      setFilters(prev => ({
        ...prev,
        [filterName]: value
      }));
    }
  };

  const handleExport = async (format) => {
    if (format !== 'excel') return;

    setIsExporting(true);
    setExportError(null);
    try {
      const trainer = trainers.find((t) => t.id === filters.trainer || t.uid === filters.trainer);

      exportMappingToExcel(dailyRows, {
        project: projects.find((p) => p.id === filters.project)?.name,
        campus: campuses.find((c) => c.id === filters.campus)?.name,
        batch: batches.find((b) => b.id === filters.batch)?.name,
        trainer: trainer ? (trainer.name || trainer.email) : '',
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      setExportError(error.message || 'Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  // Apply the date range in memory ('YYYY-MM-DD' strings compare correctly as plain text)
  const visibleEntries = entries.filter((e) => {
    const key = toDateKey(e.date);
    if (filters.startDate && key < filters.startDate) return false;
    if (filters.endDate && key > filters.endDate) return false;
    return true;
  });

  const { dailyRows, pendingRows } = filtersReady
    ? buildMapping(
        visibleEntries,
        curriculum,
        (entry) => getTrainerDisplay(entry.trainerId, entry),
        filters.batch
      )
    : { dailyRows: [], pendingRows: [] };
  const mappingLoading = entriesLoading || curriculumLoading;

  // With no batch picked, the pending table is grouped by campus and then batch
  const showGroups = !filters.batch;
  const pendingColCount = showGroups ? 7 : 8;
  const pendingGroups = showGroups ? groupPending(pendingRows) : [];

  const toggleGroup = (key) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const expandAll = () => setCollapsed(new Set());

  const collapseAll = () => {
    const keys = [];
    pendingGroups.forEach((c) => {
      if (c.campusName) keys.push(`c:${c.campusName}`);
      c.batches.forEach((b) => keys.push(`b:${b.rows[0].batchId}`));
    });
    setCollapsed(new Set(keys));
  };

  const renderPendingRow = (row) => {
    const pct = row.total ? Math.round((row.covered / row.total) * 100) : 0;
    return (
      <tr key={`${row.batchId}-${row.topic}-${row.module}`} className="hover:bg-gray-50">
        {!showGroups && <td className={TD}>{row.batchName || 'N/A'}</td>}
        <td className={TD}>{row.topic}</td>
        <td className={TD}>{row.module}</td>

        <td className="px-4 py-3 w-56">
          <div className="h-2 w-full rounded bg-gray-200">
            <div className="h-2 rounded bg-green-700" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-gray-500">{pct}%</span>
        </td>

        <td className={TD}>{row.covered} / {row.total}</td>
        <td className={TD}>{row.hoursCovered.toFixed(1)}</td>

        <td className="px-4 py-3 whitespace-nowrap text-sm">
          {row.pendingLessons.length ? (
            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
              {row.pendingLessons.length} pending
            </span>
          ) : (
            <span className="text-gray-500">0</span>
          )}
        </td>

        <td className="px-4 py-3 text-sm text-gray-900">
          {row.pendingLessons.length ? row.pendingLessons.join(', ') : (
            <span className="text-gray-500">All covered</span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-4 md:mb-6">
        Trainer Content Mapping
      </h2>

      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">

        {/* Project */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Project
          </label>

          <select
            value={filters.project || ''}
            onChange={(e) =>
              handleFilterChange('project', e.target.value)
            }
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Projects</option>

            {projects.map(project => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        {/* Campus */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Campus
          </label>

          <select
            value={filters.campus || ''}
            onChange={(e) =>
              handleFilterChange('campus', e.target.value)
            }
            disabled={!filters.project || !projectHasCampuses}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="">
              {!filters.project
                ? 'Select Project First'
                : !projectHasCampuses
                  ? 'No Campuses'
                  : 'All Campuses'}
            </option>

            {campuses.map(campus => (
              <option key={campus.id} value={campus.id}>
                {campus.name}
              </option>
            ))}
          </select>
        </div>

        {/* Batch */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Batch
          </label>

          <select
            value={filters.batch || ''}
            onChange={(e) =>
              handleFilterChange('batch', e.target.value)
            }
            disabled={!filters.project}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="">
              {!filters.project ? 'Select Project First' : 'All Batches'}
            </option>

            {batches.map(batch => (
              <option key={batch.id} value={batch.id}>
                {batch.name}
              </option>
            ))}
          </select>
        </div>

        {/* Start Date */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Start Date
          </label>

          <input
            type="date"
            value={filters.startDate}
            max={filters.endDate || undefined}
            onChange={(e) => handleFilterChange('startDate', e.target.value)}
            disabled={!filters.project}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
          />
        </div>

        {/* End Date */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            End Date
          </label>

          <input
            type="date"
            value={filters.endDate}
            min={filters.startDate || undefined}
            onChange={(e) => handleFilterChange('endDate', e.target.value)}
            disabled={!filters.project}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
          />
        </div>

        {/* Excel */}
        <div className="flex flex-col justify-end">
          <label className="block text-sm font-medium text-gray-700 mb-1 invisible">
            Export
          </label>

          <button
            onClick={() => handleExport('excel')}
            disabled={isExporting || !filtersReady || mappingLoading || dailyRows.length === 0}
            className="px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium transition-colors disabled:opacity-60"
          >
            {isExporting ? 'Exporting...' : 'Excel'}
          </button>
        </div>
      </div>

      {exportError && (
        <p className="mb-4 text-sm text-red-600">{exportError}</p>
      )}

      {!filtersReady ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Select a project to see the curriculum mapping.
        </div>
      ) : mappingLoading ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Loading...
        </div>
      ) : (
        <div className="space-y-6">

          {/* Daily coverage */}
          <section className="rounded-lg border border-gray-200 bg-white p-4 md:p-6">
            <h3 className="text-lg font-semibold text-gray-900">Daily coverage</h3>
            <p className="text-sm text-gray-500 mb-4">One row per batch, per day.</p>

            <div className="overflow-x-auto rounded-md border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-blue-900">
                  <tr>
                    <th className={TH}>Date</th>
                    <th className={TH}>Batch</th>
                    <th className={TH}>Trainer(s)</th>
                    <th className={TH}>Topic(s)</th>
                    <th className={TH}>Lessons covered</th>
                    <th className={TH}>Extra topics</th>
                    <th className={THC}>Hours</th>
                    <th className={THC}>Students</th>
                  </tr>
                </thead>

                <tbody className="bg-white divide-y divide-gray-200">
                  {dailyRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-4 text-center text-gray-500">
                        No sessions logged yet.
                      </td>
                    </tr>
                  ) : (
                    dailyRows.map((row) => (
                      <tr key={`${row.dateKey}-${row.batchId}`} className="hover:bg-gray-50">
                        <td className={TD}>{formatDateKey(row.dateKey)}</td>
                        <td className={TD}>{row.batchName || 'N/A'}</td>
                        <td className={TD}>{row.trainers.join(', ')}</td>
                        <td className={TD}>{row.topics.length ? row.topics.join(', ') : '—'}</td>

                        <td className="px-4 py-3 text-sm">
                          {row.covered.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {row.covered.map((lesson) => (
                                <span
                                  key={lesson}
                                  className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800"
                                >
                                  {lesson}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>

                        <td className="px-4 py-3 text-sm">
                          {row.extra.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {row.extra.map((lesson) => (
                                <span
                                  key={lesson}
                                  className="rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-800"
                                >
                                  {lesson}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>

                        <td className={TDC}>{row.hours.toFixed(1)}</td>
                        <td className={TDC}>{row.students ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-gray-500">
              Student count shown is the <strong>highest</strong> single-session count for that batch/day (not summed across sessions).
            </p>
          </section>

          {/* Pending lessons */}
          <section className="rounded-lg border border-gray-200 bg-white p-4 md:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Pending lessons by batch &amp; module</h3>
                <p className="text-sm text-gray-500">
                  Curriculum lessons with no matching entry yet.
                  {showGroups && ' Grouped by campus, then batch.'}
                </p>
              </div>

              {showGroups && pendingRows.length > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={expandAll}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Expand all
                  </button>
                  <button
                    onClick={collapseAll}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Collapse all
                  </button>
                </div>
              )}
            </div>

            <div className="overflow-x-auto rounded-md border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-blue-900">
                  <tr>
                    {!showGroups && <th className={TH}>Batch</th>}
                    <th className={TH}>Topic</th>
                    <th className={TH}>Module</th>
                    <th className={TH}>Progress</th>
                    <th className={TH}>Covered</th>
                    <th className={TH}>Hours covered</th>
                    <th className={TH}>Pending</th>
                    <th className={TH}>Pending lessons</th>
                  </tr>
                </thead>

                <tbody className="bg-white divide-y divide-gray-200">
                  {pendingRows.length === 0 ? (
                    <tr>
                      <td colSpan={pendingColCount} className="px-4 py-4 text-center text-gray-500">
                        No curriculum has been added yet.
                      </td>
                    </tr>
                  ) : showGroups ? (
                    pendingGroups.map((campusGroup) => {
                      const campusKey = `c:${campusGroup.campusName}`;
                      const campusOpen = !campusGroup.campusName || !collapsed.has(campusKey);

                      return (
                        <Fragment key={campusGroup.campusName || 'no-campus'}>
                          {campusGroup.campusName && (
                            <tr className="bg-gray-200">
                              <td colSpan={pendingColCount} className="p-0">
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(campusKey)}
                                  aria-expanded={campusOpen}
                                  className="w-full px-4 py-2 text-left text-sm font-semibold text-gray-900 hover:bg-gray-300"
                                >
                                  <GroupToggle
                                    open={campusOpen}
                                    label={campusGroup.campusName}
                                    summary={summarize(campusGroup.batches.flatMap((b) => b.rows))}
                                  />
                                </button>
                              </td>
                            </tr>
                          )}

                          {campusOpen &&
                            campusGroup.batches.map((batchGroup) => {
                              const batchKey = `b:${batchGroup.rows[0].batchId}`;
                              const batchOpen = !collapsed.has(batchKey);

                              return (
                                <Fragment key={batchKey}>
                                  <tr className="bg-blue-50">
                                    <td colSpan={pendingColCount} className="p-0">
                                      <button
                                        type="button"
                                        onClick={() => toggleGroup(batchKey)}
                                        aria-expanded={batchOpen}
                                        className={`w-full py-2 text-left text-sm font-medium text-blue-900 hover:bg-blue-100 ${
                                          campusGroup.campusName ? 'pl-8 pr-4' : 'px-4'
                                        }`}
                                      >
                                        <GroupToggle
                                          open={batchOpen}
                                          label={batchGroup.batchName || 'N/A'}
                                          summary={summarize(batchGroup.rows)}
                                        />
                                      </button>
                                    </td>
                                  </tr>
                                  {batchOpen && batchGroup.rows.map(renderPendingRow)}
                                </Fragment>
                              );
                            })}
                        </Fragment>
                      );
                    })
                  ) : (
                    pendingRows.map(renderPendingRow)
                  )}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-gray-500">
              "Hours covered" splits a session's logged hours evenly across all the lessons it touched (extras included), then sums by module — an estimate, since sessions don't record time per lesson.
            </p>
          </section>
        </div>
      )}

    </div>
  );
};

export default Mapping;