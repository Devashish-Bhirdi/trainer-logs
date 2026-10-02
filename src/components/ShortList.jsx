import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db } from '../services/firebase';

// shared table styling (same look as the other pages)
const TH = 'px-4 py-3 text-left text-xs font-semibold text-white';
const THC = 'px-4 py-3 text-center text-xs font-semibold text-white';
const TD = 'px-4 py-3 whitespace-nowrap text-sm text-gray-900';
const TDC = 'px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-center';

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const round2 = (n) => Math.round(n * 100) / 100;

// The same person across different tests: email if there is one, otherwise the normalised name
const studentKey = (s) => norm(s.email) || norm(s.key) || norm(s.name);

/**
 * Shortlist: top-N students for a project / campus / domain, from the `evaluations` collection.
 *
 * Each evaluation document is one test:
 *   { projectId, campusId, testName, campusName,
 *     students: [{ name, email, domain, marks, percentage }] }
 *
 * Operations
 *   - Top scorers : ranked by each student's best percentage across the included tests
 *   - Top average : ranked by each student's average percentage across the included tests
 * (with a single test selected the two give the same ranking)
 */
const Shortlist = () => {
  const [projects, setProjects] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [tests, setTests] = useState([]);            // evaluation documents for the project / campus
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [filters, setFilters] = useState({ project: '', campus: '', domain: '', test: '' });
  const [operation, setOperation] = useState('top'); // 'top' | 'average'
  const [nInput, setNInput] = useState('10');        // kept as text so the box can be cleared while typing
  const [fullAttendanceOnly, setFullAttendanceOnly] = useState(false);

  const n = parseInt(nInput, 10);
  const validN = Number.isInteger(n) && n >= 1;

  // ---------- Projects and campuses ----------

  useEffect(() => {
    let cancelled = false;
    const loadProjects = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'projects'));
        if (cancelled) return;
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (a.name || '').toString().localeCompare((b.name || '').toString()));
        setProjects(data);
      } catch (err) {
        console.error('Error fetching projects:', err);
      }
    };
    loadProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!filters.project) {
      setCampuses([]);
      return;
    }
    let cancelled = false;
    const loadCampuses = async () => {
      try {
        const q = query(collection(db, 'campuses'), where('projectId', '==', filters.project));
        const snapshot = await getDocs(q);
        if (cancelled) return;
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (a.name || '').toString().localeCompare((b.name || '').toString()));
        setCampuses(data);
      } catch (err) {
        console.error('Error fetching campuses:', err);
        if (!cancelled) setCampuses([]);
      }
    };
    loadCampuses();
    return () => {
      cancelled = true;
    };
  }, [filters.project]);

  // ---------- Evaluation documents ----------

  useEffect(() => {
    if (!filters.project) {
      setTests([]);
      return;
    }
    let cancelled = false;
    const loadTests = async () => {
      setLoading(true);
      setError(null);
      try {
        const constraints = [where('projectId', '==', filters.project)];
        if (filters.campus) constraints.push(where('campusId', '==', filters.campus));

        const snapshot = await getDocs(query(collection(db, 'evaluations'), ...constraints));
        if (cancelled) return;

        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (a.testName || '').toString().localeCompare((b.testName || '').toString()));
        setTests(data);
      } catch (err) {
        console.error('Error loading evaluations:', err);
        if (cancelled) return;
        setTests([]);
        setError('Could not load the evaluation data. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadTests();
    return () => {
      cancelled = true;
    };
  }, [filters.project, filters.campus]);

  // ---------- Filters ----------

  // A new project or campus changes the data, so the domain and test choices no longer apply
  const handleFilterChange = (name, value) => {
    setFilters((prev) => {
      if (name === 'project') return { project: value, campus: '', domain: '', test: '' };
      if (name === 'campus') return { ...prev, campus: value, domain: '', test: '' };
      return { ...prev, [name]: value };
    });
  };

  // Domains found in the loaded tests ("Full Stack" and "full stack " count as one)
  const domainOptions = useMemo(() => {
    const found = new Map();
    tests.forEach((t) =>
      (t.students || []).forEach((s) => {
        const key = norm(s.domain);
        if (key && !found.has(key)) found.set(key, String(s.domain).trim().replace(/\s+/g, ' '));
      })
    );
    return [...found]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [tests]);

  // ---------- The query itself ----------

  const { results, matched, testCount, tiedAtCutoff } = useMemo(() => {
    const included = filters.test ? tests.filter((t) => t.id === filters.test) : tests;

    // group every score by person
    const people = new Map();
    included.forEach((t) =>
      (t.students || []).forEach((s) => {
        if (filters.domain && norm(s.domain) !== filters.domain) return;
        const key = studentKey(s);
        const pct = Number(s.percentage);
        if (!key || !Number.isFinite(pct)) return;

        if (!people.has(key)) {
          people.set(key, { key, name: s.name || '', email: s.email || '', domain: s.domain || '', scores: [] });
        }
        people.get(key).scores.push(pct);
      })
    );

    let list = [...people.values()].map((p) => {
      const best = Math.max(...p.scores);
      const average = p.scores.reduce((a, b) => a + b, 0) / p.scores.length;
      return { ...p, tests: p.scores.length, value: operation === 'average' ? average : best };
    });

    // for averages, optionally drop anyone who missed one of the included tests
    if (operation === 'average' && fullAttendanceOnly) {
      list = list.filter((p) => p.tests === included.length);
    }

    list.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

    return {
      results: validN ? list.slice(0, n).map((p) => ({ ...p, score: round2(p.value) })) : [],
      matched: list.length,
      testCount: included.length,
      // someone just outside the cut has exactly the same score as the last one shown
      tiedAtCutoff: validN && list.length > n && list[n].value === list[n - 1].value,
    };
  }, [tests, filters.domain, filters.test, operation, n, validN, fullAttendanceOnly]);

  // ---------- Export ----------

  const handleExport = () => {
    const scoreLabel = operation === 'average' ? 'Average %' : 'Best %';
    const rows = results.map((r, i) => ({
      'Sr. no.': i + 1,
      Name: r.name,
      Email: r.email,
      Domain: r.domain,
      'Tests taken': r.tests,
      [scoreLabel]: r.score,
    }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Shortlist');
    XLSX.writeFile(workbook, `Shortlist - Top ${n}.xlsx`);
  };

  const scoreHeader = operation === 'average' ? 'Average %' : 'Best %';

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-4 md:mb-6">Shortlist</h2>

      {/* Filters */}
      <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
          <select
            value={filters.project}
            onChange={(e) => handleFilterChange('project', e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Select Project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Campus</label>
          <select
            value={filters.campus}
            onChange={(e) => handleFilterChange('campus', e.target.value)}
            disabled={!filters.project || campuses.length === 0}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="">
              {!filters.project ? 'Select Project First' : campuses.length === 0 ? 'No Campuses' : 'All Campuses'}
            </option>
            {campuses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Domain</label>
          <select
            value={filters.domain}
            onChange={(e) => handleFilterChange('domain', e.target.value)}
            disabled={domainOptions.length === 0}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="">All Domains</option>
            {domainOptions.map((d) => (
              <option key={d.key} value={d.key}>{d.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Test</label>
          <select
            value={filters.test}
            onChange={(e) => handleFilterChange('test', e.target.value)}
            disabled={tests.length === 0}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="">All Tests</option>
            {tests.map((t) => (
              <option key={t.id} value={t.id}>
                {t.testName}{!filters.campus && t.campusName ? ` (${t.campusName})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Query */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Query</label>
          <select
            value={operation}
            onChange={(e) => setOperation(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="top">Top scorers</option>
            <option value="average">Top average</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Number of students</label>
          <input
            type="number"
            min="1"
            value={nInput}
            onChange={(e) => setNInput(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          />
          {!validN && <p className="mt-1 text-xs text-red-600">Enter a number of 1 or more.</p>}
        </div>

        {operation === 'average' && testCount > 1 && (
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={fullAttendanceOnly}
                onChange={(e) => setFullAttendanceOnly(e.target.checked)}
              />
              Only students who took every test
            </label>
          </div>
        )}

        <div className='flex flex-col justify-end lg:col-start-4'>
            <button
             type="button"
            //  onClick={handleUpload}
             className='px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium transition-colors disabled:opacity-60'
             >
            Upload Test
            </button>
        </div>

        <div className="flex flex-col justify-end lg:col-start-4">
          <button
            type="button"
            onClick={handleExport}
            disabled={results.length === 0}
            className="px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium transition-colors disabled:opacity-60"
          >
            Excel
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {/* Results */}
      {filters.project && !loading && matched > 0 && (
        <p className="mb-2 text-sm text-gray-500">
          Showing {results.length} of {matched} students across {testCount} test{testCount === 1 ? '' : 's'}.
          {tiedAtCutoff && ' Others are tied with the last student shown.'}
        </p>
      )}

      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-blue-900">
            <tr>
              <th className={THC}>Rank</th>
              <th className={TH}>Name</th>
              <th className={TH}>Email</th>
              <th className={TH}>Domain</th>
              <th className={THC}>Tests</th>
              <th className={THC}>{scoreHeader}</th>
            </tr>
          </thead>

          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-sm text-gray-500">Loading...</td>
              </tr>
            ) : !filters.project ? (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-sm text-gray-500">
                  Select a project to build a shortlist.
                </td>
              </tr>
            ) : results.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-sm text-gray-500">
                  {tests.length === 0 ? 'No evaluation data found for this selection.' : 'No students match.'}
                </td>
              </tr>
            ) : (
              results.map((r, i) => (
                <tr key={r.key} className="hover:bg-gray-50">
                  <td className={TDC}>{i + 1}</td>
                  <td className={TD}>{r.name || '—'}</td>
                  <td className={TD}>{r.email || '—'}</td>
                  <td className={TD}>{r.domain || '—'}</td>
                  <td className={TDC}>{r.tests}</td>
                  <td className={TDC}>{r.score}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Shortlist;