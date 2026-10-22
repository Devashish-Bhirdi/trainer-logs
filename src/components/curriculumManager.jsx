import { useEffect, useRef, useState } from 'react';
import { collection, getDocs, query, where, deleteDoc, doc, writeBatch } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db } from '../services/firebase';

// shared table styling (same look as the Mapping page)
const TH = 'px-4 py-3 text-left text-xs font-semibold text-white';
const TD = 'px-4 py-3 text-sm text-gray-900';

// ---------- Helpers (pure functions, no Firebase / React) ----------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// counts for the upload dialog: { topics, modules, lessons }
const sheetStats = (data) => {
  let modules = 0;
  let lessons = 0;
  const topics = Object.keys(data);
  topics.forEach((t) => {
    Object.values(data[t]).forEach((list) => {
      modules += 1;
      lessons += list.length;
    });
  });
  return { topics: topics.length, modules, lessons };
};

// Reads one worksheet -> { sheetName, data: { topic: { module: [lessons] } } }, or null if it has no lessons.
// Columns are read by position (A = topic, B = module, C = lesson), so the header text doesn't matter.
// A blank topic or module cell inherits the one above it (merged-cell style layouts).
const parseBatchSheet = (ws, sheetName) => {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const data = {};
  let currentTopic = 'General';           // used until a topic name shows up
  let currentModule = 'General';          // used until a module name shows up

  rows.slice(1).forEach((row) => {        // row 0 is the header row
    const topicCell = String(row[0] ?? '').trim();
    const moduleCell = String(row[1] ?? '').trim();
    const lessonCell = String(row[2] ?? '').trim();

    if (topicCell) {
      currentTopic = topicCell;
      // a new topic with no module written must not inherit the previous topic's module
      if (!moduleCell) currentModule = 'General';
    }
    if (moduleCell) currentModule = moduleCell;
    if (!lessonCell) return;              // spacer rows carry no lesson

    if (!data[currentTopic]) data[currentTopic] = {};
    if (!data[currentTopic][currentModule]) data[currentTopic][currentModule] = [];
    data[currentTopic][currentModule].push(lessonCell);
  });

  return Object.keys(data).length ? { sheetName, data } : null;
};

/**
 * Lists the documents in the `curriculum` collection (narrowed by the Project / Campus filters),
 * lets an admin delete them, and uploads new curriculum workbooks.
 *
 * Props:
 *  - refreshKey: number (optional). Bump it from a parent to force the list to reload.
 *    The list already reloads by itself after an upload or delete.
 */
export default function CurriculumManager({ refreshKey = 0 }) {
  const fileInputRef = useRef(null);

  // ---- List ----
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);    // bumped after an upload so the list reloads
  const [message, setMessage] = useState(null);     // { type: 'success' | 'error', text }
  const [confirmId, setConfirmId] = useState(null); // id of the document awaiting delete confirmation
  const [deleting, setDeleting] = useState(false);

  // ---- Filters ----
  const [projects, setProjects] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [batches, setBatches] = useState([]);       // batches of the chosen project / campus (upload dialog)
  const [projectHasCampuses, setProjectHasCampuses] = useState(true);
  const [filters, setFilters] = useState({ project: '', campus: '' });

  // ---- Upload ----
  const [addingCurriculum, setAddingCurriculum] = useState(false);
  const [parsedSheets, setParsedSheets] = useState([]);   // [{ sheetName, data }] read from the workbook
  const [sheetBatches, setSheetBatches] = useState({});   // { sheetName: [batchId, ...] } chosen in the dialog
  const [showCurriculumModal, setShowCurriculumModal] = useState(false);

  // The dialog needs a project (and a campus, if the project has campuses) before batches can be chosen
  const destinationReady = !!filters.project && (!projectHasCampuses || !!filters.campus);

  // Saving needs a destination plus at least one sheet linked to at least one batch
  const canSaveCurriculum =
    destinationReady && parsedSheets.some((s) => (sheetBatches[s.sheetName] || []).length > 0);

  // ---------- Projects, campuses and batches ----------

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    if (filters.project) {
      fetchCampuses(filters.project);
    } else {
      setCampuses([]);
      setProjectHasCampuses(true);
    }
  }, [filters.project]);

  // Batches are only needed by the upload dialog, so they load when it opens
  // (and again if the project / campus is changed inside it).
  useEffect(() => {
    if (!showCurriculumModal || !filters.project) {
      setBatches([]);
      return;
    }

    let cancelled = false;
    const loadBatches = async () => {
      try {
        const q = filters.campus
          ? query(collection(db, 'batches'), where('campusId', '==', filters.campus))
          : query(collection(db, 'batches'), where('projectId', '==', filters.project));
        const snapshot = await getDocs(q);
        if (cancelled) return;

        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (a.name || '').toString().localeCompare((b.name || '').toString()));
        setBatches(data);
      } catch (error) {
        if (cancelled) return;
        console.error('Error fetching batches:', error);
        setBatches([]);
      }
    };
    loadBatches();

    return () => {
      cancelled = true;
    };
  }, [showCurriculumModal, filters.project, filters.campus]);

  // The batch list changes with the project / campus, so any sheet -> batch links made in the
  // dialog would point at the wrong batches. Clear them.
  useEffect(() => {
    setSheetBatches({});
  }, [filters.project, filters.campus]);

  const fetchProjects = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'projects'));
      const projectsData = [];

      querySnapshot.forEach((d) => {
        projectsData.push({ id: d.id, ...d.data() });
      });

      projectsData.sort((a, b) =>
        (a.name || '').toString().localeCompare((b.name || '').toString())
      );
      setProjects(projectsData);
    } catch (error) {
      console.error('Error fetching projects:', error);
    }
  };

  const fetchCampuses = async (projectId) => {
    try {
      const q = query(collection(db, 'campuses'), where('projectId', '==', projectId));
      const querySnapshot = await getDocs(q);

      const campusesData = [];
      querySnapshot.forEach((d) => {
        campusesData.push({ id: d.id, ...d.data() });
      });

      campusesData.sort((a, b) =>
        (a.name || '').toString().localeCompare((b.name || '').toString())
      );
      setCampuses(campusesData);
      setProjectHasCampuses(campusesData.length > 0);
    } catch (error) {
      console.error('Error fetching campuses:', error);
      setCampuses([]);              // don't leave the previous project's campuses on screen
      setProjectHasCampuses(true);  // unknown, so keep the campus filter available
    }
  };

  const handleFilterChange = (filterName, value) => {
    if (filterName === 'project') {
      // a new project invalidates the campus choice
      setFilters({ project: value, campus: '' });
    } else if (filterName === 'campus') {
      setFilters((prev) => ({ ...prev, campus: value }));
    }
  };

  // ---------- Curriculum documents ----------

  // Reloads whenever a filter changes, after an upload, or when the parent bumps refreshKey.
  // No filter = every document; project = that project's; project + campus = that campus's.
  useEffect(() => {
    let cancelled = false; // ignore the result if the filters changed while this was loading

    const loadCurriculum = async () => {
      setLoading(true);
      try {
        const constraints = [];
        if (filters.project) constraints.push(where('projectId', '==', filters.project));
        if (filters.campus) constraints.push(where('campusId', '==', filters.campus));

        const snapshot = await getDocs(query(collection(db, 'curriculum'), ...constraints));
        if (cancelled) return;

        // keep only the fields this screen needs
        const rows = snapshot.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            projectId: x.projectId || '',
            projectName: x.projectName || '',
            campusId: x.campusId || null,
            campusName: x.campusName || '',
            batch: x.batch || {},       // { batchId: batchName }
          };
        });

        rows.sort(
          (a, b) =>
            a.projectName.localeCompare(b.projectName) ||
            a.campusName.localeCompare(b.campusName)
        );
        setItems(rows);
      } catch (error) {
        if (cancelled) return;
        console.error('Error loading curriculum:', error);
        setItems([]);
        setMessage({ type: 'error', text: 'Could not load the curriculum. Please refresh.' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadCurriculum();

    return () => {
      cancelled = true;
    };
  }, [filters.project, filters.campus, refreshKey, reloadKey]);

  // ---------- Upload ----------

  // Fired when the user picks a file. Parses every sheet, then opens the floating dialog.
  const handleCurriculum = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';                    // lets the same file be chosen again later
    if (!file) return;

    setMessage(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });

      const sheets = workbook.SheetNames
        .map((name) => parseBatchSheet(workbook.Sheets[name], name.trim()))
        .filter(Boolean);

      if (sheets.length === 0) {
        setMessage({
          type: 'error',
          text: 'No lessons found. Each sheet needs the columns Topic, Module and Lesson.',
        });
        return;
      }

      setParsedSheets(sheets);
      setSheetBatches({});
      setShowCurriculumModal(true);
    } catch (error) {
      console.error('Error reading curriculum file:', error);
      setMessage({ type: 'error', text: 'Could not read that file. Please choose a valid Excel workbook.' });
    }
  };

  const closeCurriculumModal = () => {
    setShowCurriculumModal(false);
    setParsedSheets([]);
    setSheetBatches({});
  };

  // Tick / untick a batch under one sheet
  const toggleSheetBatch = (sheetName, batchId) =>
    setSheetBatches((prev) => {
      const current = prev[sheetName] || [];
      const next = current.includes(batchId)
        ? current.filter((id) => id !== batchId)
        : [...current, batchId];
      return { ...prev, [sheetName]: next };
    });

  // Writes one document per sheet to the "curriculum" collection, all-or-nothing.
  // Sheets with no batch chosen are skipped.
  const handleSaveCurriculum = async () => {
    const project = projects.find((p) => p.id === filters.project);
    const campus = campuses.find((c) => c.id === filters.campus);
    if (!project || (projectHasCampuses && !campus)) return;

    const docs = parsedSheets
      .map((sheet) => {
        const batch = {};
        (sheetBatches[sheet.sheetName] || []).forEach((id) => {
          const b = batches.find((x) => x.id === id);
          if (b) batch[b.id] = b.name;
        });
        return { sheet, batch };
      })
      .filter(({ batch }) => Object.keys(batch).length > 0);

    if (docs.length === 0) return;

    setAddingCurriculum(true);
    try {
      const wb = writeBatch(db);
      docs.forEach(({ sheet, batch }) => {
        wb.set(doc(collection(db, 'curriculum')), {
          name: sheet.sheetName,
          data: sheet.data,               // { topic: { module: [lessons] } }
          batch,                          // { batchId: batchName }
          projectId: project.id,
          projectName: project.name,
          campusId: campus ? campus.id : null,
          campusName: campus ? campus.name : null,
        });
      });
      await wb.commit();
      setReloadKey((n) => n + 1);

      const batchCount = docs.reduce((n, { batch }) => n + Object.keys(batch).length, 0);
      const skipped = parsedSheets.length - docs.length;
      setMessage({
        type: 'success',
        text:
          `Added ${plural(docs.length, 'curriculum')} for ${plural(batchCount, 'batch')}.` +
          (skipped ? ` ${plural(skipped, 'sheet')} skipped (no batch chosen).` : ''),
      });
      closeCurriculumModal();
    } catch (error) {
      console.error('Error saving curriculum:', error);
      setMessage({ type: 'error', text: 'Could not save the curriculum. Please try again.' });
      closeCurriculumModal();
    } finally {
      setAddingCurriculum(false);
    }
  };

  // ---------- Delete ----------

  const handleDelete = async () => {
    if (!confirmId) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'curriculum', confirmId));
      setItems((prev) => prev.filter((it) => it.id !== confirmId));
      setMessage({ type: 'success', text: 'Curriculum deleted.' });
    } catch (error) {
      console.error('Error deleting curriculum:', error);
      setMessage({ type: 'error', text: 'Could not delete. Please try again.' });
    } finally {
      setDeleting(false);
      setConfirmId(null);
    }
  };

  const batchNames = (batch) => Object.values(batch).sort((a, b) => a.localeCompare(b));
  const confirmItem = items.find((it) => it.id === confirmId);

  // Batches that already have a curriculum, so the dialog can flag them.
  // `items` is already narrowed to the same project / campus the dialog is using.
  const batchIdsWithCurriculum = new Set(items.flatMap((it) => Object.keys(it.batch)));

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-4 md:mb-6">
        Curriculum Management
      </h2>

      {/* Filters + upload */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
          <select
            value={filters.project}
            onChange={(e) => handleFilterChange('project', e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Campus</label>
          <select
            value={filters.campus}
            onChange={(e) => handleFilterChange('campus', e.target.value)}
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
            {campuses.map((campus) => (
              <option key={campus.id} value={campus.id}>
                {campus.name}
              </option>
            ))}
          </select>
        </div>

        {/* Add Curriculum */}
        <div className="flex flex-col justify-end">
          <label className="block text-sm font-medium text-gray-700 mb-1 invisible">
            Add Curriculum
          </label>

          <input
            type="file"
            accept=".xlsx,.xls"
            ref={fileInputRef}
            onChange={handleCurriculum}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={addingCurriculum}
            className="px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium transition-colors disabled:opacity-60"
          >
            {addingCurriculum ? 'Adding...' : 'Add Curriculum'}
          </button>
        </div>
      </div>

      {message && (
        <div
          role="status"
          className={`mb-4 flex items-center justify-between gap-3 rounded-md p-3 text-sm ${
            message.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}
        >
          <span>{message.text}</span>
          <button type="button" className="underline" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-blue-900">
            <tr>
              <th className={TH}>Project</th>
              <th className={TH}>Campus</th>
              <th className={TH}>Batch(s)</th>
              <th className={TH} />
            </tr>
          </thead>

          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-center text-sm text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-center text-sm text-gray-500">
                  No curriculum found.
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} className="hover:bg-gray-50">
                  <td className={TD}>{it.projectName || '—'}</td>
                  <td className={TD}>{it.campusName || '—'}</td>
                  <td className={TD}>
                    {Object.keys(it.batch).length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {batchNames(it.batch).map((name) => (
                          <span
                            key={name}
                            className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className={`${TD} text-right`}>
                    <button
                      type="button"
                      onClick={() => setConfirmId(it.id)}
                      className="px-3 py-1 border border-red-600 text-red-600 rounded-md text-xs font-medium hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Confirm delete dialog */}
      {confirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Delete this curriculum?</h3>
            {confirmItem && (
              <p className="text-sm text-gray-700 mb-1">
                {confirmItem.projectName}
                {confirmItem.campusName && ` · ${confirmItem.campusName}`}
                {Object.keys(confirmItem.batch).length > 0 &&
                  ` · ${batchNames(confirmItem.batch).join(', ')}`}
              </p>
            )}
            <p className="text-sm text-gray-500">
              This permanently removes the document from the database. It can't be undone.
            </p>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmId(null)}
                disabled={deleting}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating dialog: link each sheet in the workbook to the batches it applies to */}
      {showCurriculumModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-800 mb-1">Add Curriculum</h3>
            <p className="text-sm text-gray-500 mb-4">
              Choose the project and campus, then pick the batches that follow each sheet's curriculum.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {/* Project */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
                <select
                  value={filters.project}
                  onChange={(e) => handleFilterChange('project', e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select Project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </div>

              {/* Campus */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Campus</label>
                <select
                  value={filters.campus}
                  onChange={(e) => handleFilterChange('campus', e.target.value)}
                  disabled={!filters.project || !projectHasCampuses}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="">
                    {!filters.project
                      ? 'Select Project First'
                      : !projectHasCampuses
                        ? 'No Campuses'
                        : 'Select Campus'}
                  </option>
                  {campuses.map((campus) => (
                    <option key={campus.id} value={campus.id}>{campus.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* One block per sheet: what was read, and which batches it applies to */}
            <div className="space-y-3">
              {parsedSheets.map((sheet) => {
                const stats = sheetStats(sheet.data);
                const selectedIds = sheetBatches[sheet.sheetName] || [];
                const takenElsewhere = new Set(
                  Object.entries(sheetBatches)
                    .filter(([name]) => name !== sheet.sheetName)
                    .flatMap(([, ids]) => ids)
                );

                return (
                  <div key={sheet.sheetName} className="rounded-md border border-gray-200 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-gray-900">{sheet.sheetName}</span>
                      <span className="text-xs text-gray-500">
                        {plural(stats.topics, 'topic')}, {plural(stats.modules, 'module')}, {plural(stats.lessons, 'lesson')}
                      </span>
                    </div>

                    {!destinationReady ? (
                      <p className="mt-2 text-sm text-gray-500">
                        {!filters.project ? 'Select a project first.' : 'Select a campus first.'}
                      </p>
                    ) : batches.length === 0 ? (
                      <p className="mt-2 text-sm text-gray-500">No batches found here.</p>
                    ) : (
                      <>
                        <div className="mt-2 grid max-h-36 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                          {batches.map((b) => {
                            const disabled = takenElsewhere.has(b.id);
                            return (
                              <label
                                key={b.id}
                                className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${
                                  disabled ? 'text-gray-400' : 'text-gray-800 hover:bg-gray-50'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedIds.includes(b.id)}
                                  disabled={disabled}
                                  onChange={() => toggleSheetBatch(sheet.sheetName, b.id)}
                                />
                                <span>{b.name}</span>
                                {batchIdsWithCurriculum.has(b.id) && (
                                  <span className="text-xs text-amber-700">has curriculum</span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          {selectedIds.length
                            ? `${plural(selectedIds.length, 'batch')} selected`
                            : 'No batch selected. This sheet will be skipped.'}
                        </p>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeCurriculumModal}
                disabled={addingCurriculum}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCurriculum}
                disabled={!canSaveCurriculum || addingCurriculum}
                className="px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium transition-colors disabled:opacity-60"
              >
                {addingCurriculum ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}