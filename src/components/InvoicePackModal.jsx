import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../services/firebase';
import { buildTrainerEntriesPdf, mergePdfs, downloadZip, safeName } from '../services/InvoicePackService';
import { autoMatchAll } from '../services/InvoiceMatching';
import InvoiceMatchModal from './InvoiceMatchModal';

const trainerKey = (t) => t.uid || t.id;
const trainerName = (t) => t.name || (t.email || '').split('@')[0] || 'Trainer';

// "2026-09-01" -> 1 Sep 2026, 00:00 in the user's own time zone.
// (new Date('2026-09-01') would be midnight UTC, which cuts off the first hours of the day in e.g. India.)
const parseLocalDate = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(y, m - 1, d);
};

const statusStyle = {
  merged: 'text-green-700',
  skipped: 'text-orange-700',
  failed: 'text-red-700',
};

/**
 * Props
 *  - trainers     : [{ id, uid, name, email }]
 *  - filters      : { project, campus, batch, startDate, endDate }
 *                   project, startDate and endDate are COMPULSORY (campus and batch are optional).
 *                   The page's trainer filter is NOT used: the pack covers all trainers.
 *  - filterLabels : { companyName, projectName, campusName, batchName, startDate, endDate }
 *  - onClose      : () => void
 */
const InvoicePackModal = ({ trainers, filters, filterLabels, onClose }) => {
  const [entries, setEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [files, setFiles] = useState([]);           // invoice PDFs from the chosen folder
  const [matches, setMatches] = useState(null);     // trainerKey -> file index (-1 = skip); null until confirmed
  const [showMatch, setShowMatch] = useState(false);
  const [runToken, setRunToken] = useState(0);      // bumped when matches are confirmed -> (re)generate all
  const [results, setResults] = useState({});       // trainerKey -> { status, message, mergedBytes, entriesBytes }
  const [include, setInclude] = useState(() => new Set()); // trainerKeys to put in the ZIP
  const [includeEntries, setIncludeEntries] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const runRef = useRef(0);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && !showMatch && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy, showMatch]);

  // Fetch every entry matching the page's filters (project / campus / batch / dates), for ALL trainers
  useEffect(() => {
    let cancelled = false;

    // project, start date and end date are compulsory: never run an open-ended query
    if (!filters.project || !filters.startDate || !filters.endDate) {
      setEntries([]);
      setLoadError('Project, start date and end date are required to build an invoice pack.');
      setLoadingEntries(false);
      return undefined;
    }

    const load = async () => {
      setLoadingEntries(true);
      setLoadError(null);
      try {
        const start = parseLocalDate(filters.startDate);
        const end = parseLocalDate(filters.endDate);
        end.setHours(23, 59, 59, 999);

        const constraints = [
          where('projectId', '==', filters.project),
          where('date', '>=', start),
          where('date', '<=', end),
        ];
        if (filters.campus) constraints.push(where('campusId', '==', filters.campus));
        if (filters.batch) constraints.push(where('batchId', '==', filters.batch));

        const q = query(collection(db, 'entries'), ...constraints, orderBy('date', 'desc'));
        const snap = await getDocs(q);
        if (cancelled) return;
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Error fetching entries for invoice pack:', err);
        if (!cancelled) setLoadError(err.message || 'Could not load entries.');
      }
      if (!cancelled) setLoadingEntries(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [filters.project, filters.campus, filters.batch, filters.startDate, filters.endDate]);

  // Split trainers into those with entries (get a PDF) and those without (skipped)
  const { eligible, noEntries, entriesByTrainer, unassignedCount } = useMemo(() => {
    const byId = new Map();
    entries.forEach((e) => {
      if (!byId.has(e.trainerId)) byId.set(e.trainerId, []);
      byId.get(e.trainerId).push(e);
    });

    const map = new Map();
    const withEntries = [];
    const without = [];
    let assigned = 0;

    trainers.forEach((t) => {
      // an entry stores either the trainer's uid or their document id
      const list = [];
      if (t.uid && byId.has(t.uid)) list.push(...byId.get(t.uid));
      if (t.id && t.id !== t.uid && byId.has(t.id)) list.push(...byId.get(t.id));
      if (list.length > 0) {
        map.set(trainerKey(t), list);
        withEntries.push(t);
        assigned += list.length;
      } else {
        without.push(t);
      }
    });

    return {
      eligible: withEntries,
      noEntries: without,
      entriesByTrainer: map,
      unassignedCount: entries.length - assigned,
    };
  }, [entries, trainers]);

  // what the match modal needs for each trainer
  const matchRows = useMemo(
    () =>
      eligible.map((t) => ({
        key: trainerKey(t),
        name: trainerName(t),
        count: (entriesByTrainer.get(trainerKey(t)) || []).length,
      })),
    [eligible, entriesByTrainer]
  );

  const autoMatches = useMemo(() => autoMatchAll(matchRows, files), [matchRows, files]);

  const fileIndexFor = (t) => matches?.[trainerKey(t)] ?? -1;

  // Builds the entries PDF for one trainer and merges it after their invoice
  const buildOne = async (t, idx) => {
    const key = trainerKey(t);
    const name = trainerName(t);
    const list = entriesByTrainer.get(key) || [];

    if (idx < 0 || !files[idx]) {
      return { key, name, status: 'skipped', message: 'No invoice chosen - pick one from the list' };
    }

    try {
      const entriesBytes = buildTrainerEntriesPdf(list, { ...filterLabels, trainerName: name });
      const invoiceBytes = new Uint8Array(await files[idx].arrayBuffer());
      const mergedBytes = await mergePdfs([invoiceBytes, entriesBytes]); // invoice first, then entries
      return {
        key,
        name,
        status: 'merged',
        message: `${list.length} entr${list.length === 1 ? 'y' : 'ies'} + ${files[idx].name}`,
        mergedBytes,
        entriesBytes,
      };
    } catch (err) {
      console.error(`Error building the PDF for ${name}:`, err);
      return { key, name, status: 'failed', message: err.message || 'Could not build this PDF' };
    }
  };

  // Builds every trainer's pack, one after another, so the table fills in as it goes
  const generateAll = async () => {
    const run = ++runRef.current;
    setBusy(true);
    setError(null);
    setResults({});
    setInclude(new Set());

    const nextInclude = new Set();
    for (const t of eligible) {
      const r = await buildOne(t, fileIndexFor(t));
      if (run !== runRef.current) return; // a newer run took over
      setResults((prev) => ({ ...prev, [r.key]: r }));
      if (r.status === 'merged') nextInclude.add(r.key);
      await new Promise((res) => setTimeout(res, 0)); // let the UI repaint
    }
    setInclude(nextInclude);
    setBusy(false);
  };

  // Start once the user has confirmed the matches
  useEffect(() => {
    if (runToken > 0 && !loadingEntries) generateAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runToken, loadingEntries]);

  const handleFolder = (e) => {
    const pdfs = Array.from(e.target.files || [])
      .filter((f) => /\.pdf$/i.test(f.name))
      .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
    e.target.value = ''; // lets the same folder be picked again
    setMatches(null);
    setResults({});
    setInclude(new Set());
    setFiles(pdfs);
    if (pdfs.length === 0) {
      setError('No PDF files were found in that folder.');
      return;
    }
    setError(null);
    setShowMatch(eligible.length > 0); // open the match review
  };

  const handleConfirmMatches = (m) => {
    setMatches(m);
    setShowMatch(false);
    setRunToken((n) => n + 1); // triggers generation
  };

  // The user picked a different invoice for one trainer in the table: rebuild just that row
  const handleOverride = async (t, value) => {
    const idx = Number(value);
    const key = trainerKey(t);
    setMatches((prev) => ({ ...(prev || {}), [key]: idx }));
    setBusy(true);
    setError(null);
    const r = await buildOne(t, idx);
    setResults((prev) => ({ ...prev, [key]: r }));
    setInclude((prev) => {
      const next = new Set(prev);
      if (r.status === 'merged') next.add(key);
      else next.delete(key);
      return next;
    });
    setBusy(false);
  };

  const toggleInclude = (key) => {
    setInclude((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const mergedKeys = eligible.map(trainerKey).filter((k) => results[k]?.status === 'merged');
  const selectedCount = mergedKeys.filter((k) => include.has(k)).length;
  const doneCount = eligible.filter((t) => results[trainerKey(t)]).length;

  const handleDownload = async () => {
    setError(null);
    try {
      const used = new Set();
      const zipFiles = [];
      eligible.forEach((t) => {
        const r = results[trainerKey(t)];
        if (!r || r.status !== 'merged' || !include.has(r.key)) return;

        // keep file names unique if two trainers share a name
        const base = safeName(r.name);
        let n = 1;
        let suffix = '';
        while (used.has(`${base}${suffix}`)) {
          n += 1;
          suffix = `_${n}`;
        }
        used.add(`${base}${suffix}`);

        zipFiles.push({ name: `${base}${suffix}_merged.pdf`, bytes: r.mergedBytes });
        if (includeEntries) zipFiles.push({ name: `${base}${suffix}_entries.pdf`, bytes: r.entriesBytes });
      });

      if (zipFiles.length === 0) {
        setError('Tick at least one merged PDF to download.');
        return;
      }
      await downloadZip(zipFiles, `${safeName(filterLabels.projectName || 'project')}_trainer_invoices.zip`);
    } catch (err) {
      console.error('Error creating zip:', err);
      setError(err.message || 'Could not create the ZIP.');
    }
  };

  const renderResult = (t) => {
    const result = results[trainerKey(t)];
    if (result) {
      return (
        <span className={statusStyle[result.status]}>
          <span className="font-semibold capitalize">{result.status}</span>: {result.message}
        </span>
      );
    }
    if (files.length === 0) return <span className="text-gray-500">Waiting for the invoice folder</span>;
    if (!matches) return <span className="text-gray-500">Confirm the matches to continue</span>;
    return <span className="text-gray-500">{busy ? 'Working...' : 'Waiting'}</span>;
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onMouseDown={(e) => e.target === e.currentTarget && !busy && !showMatch && onClose()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Invoice pack"
          className="flex flex-col rounded-lg bg-white shadow-xl"
          style={{ width: '85vw', maxWidth: 1100, height: '80vh', minWidth: 320 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Invoice pack{filterLabels.projectName ? ` - ${filterLabels.projectName}` : ''}
              </h3>
              <p className="text-sm text-gray-500">
                Upload the invoice folder, check the matches, and each trainer with entries gets their invoice
                (first) merged with their entries PDF.
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-md px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Upload bar */}
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-5 py-3">
            <label
              className={`rounded-md bg-blue-900 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 ${
                busy || loadingEntries || loadError ? 'pointer-events-none opacity-50' : 'cursor-pointer'
              }`}
            >
              Upload invoice folder
              <input
                type="file"
                className="hidden"
                webkitdirectory=""
                directory=""
                multiple
                onChange={handleFolder}
                disabled={busy || loadingEntries || Boolean(loadError)}
              />
            </label>
            {files.length > 0 && eligible.length > 0 && (
              <button
                onClick={() => setShowMatch(true)}
                disabled={busy}
                className="rounded-md border border-blue-900 px-3 py-2 text-sm font-medium text-blue-900 hover:bg-blue-50 disabled:opacity-40"
              >
                Review matches
              </button>
            )}
            <span className="text-sm text-gray-600">
              {files.length === 0 ? 'No folder chosen yet.' : `${files.length} PDF${files.length === 1 ? '' : 's'} found`}
            </span>
            {!loadingEntries && !loadError && (
              <span className="ml-auto text-sm text-gray-600">
                {eligible.length} trainer{eligible.length === 1 ? '' : 's'} with entries ({entries.length} entries)
              </span>
            )}
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {loadingEntries ? (
              <p className="text-sm text-gray-500">Loading entries...</p>
            ) : loadError ? (
              <p className="text-sm text-red-600">{loadError}</p>
            ) : (
              <>
                {unassignedCount > 0 && (
                  <p className="mb-3 rounded-md bg-orange-50 px-3 py-2 text-xs text-orange-800">
                    {unassignedCount} entr{unassignedCount === 1 ? 'y belongs' : 'ies belong'} to a trainer who isn't
                    in the trainers list, so {unassignedCount === 1 ? 'it' : 'they'} won't be in any PDF.
                  </p>
                )}

                {eligible.length === 0 ? (
                  <p className="text-sm text-gray-500">No trainer has entries for the current filters.</p>
                ) : (
                  <>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-600">
                        {matches && `${doneCount} of ${eligible.length} processed`}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setInclude(new Set(mergedKeys))}
                          disabled={busy || mergedKeys.length === 0}
                          className="rounded-md border border-blue-900 px-2 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50 disabled:opacity-40"
                        >
                          Select all
                        </button>
                        <button
                          onClick={() => setInclude(new Set())}
                          disabled={busy || selectedCount === 0}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-blue-900 text-xs text-white">
                        <tr>
                          <th className="w-10 px-3 py-2 text-left font-semibold">Use</th>
                          <th className="px-3 py-2 text-left font-semibold">Trainer</th>
                          <th className="px-3 py-2 text-left font-semibold">Entries</th>
                          <th className="px-3 py-2 text-left font-semibold">Invoice file</th>
                          <th className="px-3 py-2 text-left font-semibold">Result</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {eligible.map((t) => {
                          const key = trainerKey(t);
                          const idx = fileIndexFor(t);
                          const result = results[key];
                          const count = (entriesByTrainer.get(key) || []).length;
                          return (
                            <tr key={key}>
                              <td className="px-3 py-2 align-top">
                                <input
                                  type="checkbox"
                                  checked={include.has(key)}
                                  disabled={busy || result?.status !== 'merged'}
                                  onChange={() => toggleInclude(key)}
                                />
                              </td>
                              <td className="px-3 py-2 align-top">{trainerName(t)}</td>
                              <td className="px-3 py-2 align-top text-gray-600">{count}</td>
                              <td className="px-3 py-2 align-top">
                                <select
                                  value={idx}
                                  onChange={(e) => handleOverride(t, e.target.value)}
                                  disabled={busy || files.length === 0 || !matches}
                                  className="w-full max-w-xs rounded-md border border-gray-300 p-1.5 text-xs disabled:bg-gray-100"
                                >
                                  <option value={-1}>
                                    {files.length === 0 ? 'Upload a folder first' : '— none —'}
                                  </option>
                                  {files.map((f, i) => (
                                    <option key={i} value={i}>
                                      {f.webkitRelativePath || f.name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2 align-top text-xs">{renderResult(t)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                )}

                {noEntries.length > 0 && (
                  <details className="mt-5 rounded-md border border-gray-200 px-3 py-2">
                    <summary className="cursor-pointer text-sm font-medium text-gray-700">
                      Skipped: {noEntries.length} trainer{noEntries.length === 1 ? '' : 's'} with no entries for these
                      filters
                    </summary>
                    <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm text-gray-600 sm:grid-cols-2">
                      {noEntries.map((t) => (
                        <li key={trainerKey(t)} className="truncate">
                          {trainerName(t)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-3">
            <div className="text-sm">
              {error && <span className="text-red-600">{error}</span>}
              {!error && files.length > 0 && !matches && !showMatch && (
                <span className="text-orange-700">Matches not confirmed yet. Use "Review matches".</span>
              )}
              {!error && mergedKeys.length > 0 && !busy && (
                <span className="text-gray-600">
                  {selectedCount} of {mergedKeys.length} merged PDF{mergedKeys.length === 1 ? '' : 's'} selected for
                  the ZIP.
                </span>
              )}
              {!error && busy && <span className="text-gray-600">Working...</span>}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {mergedKeys.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={includeEntries}
                    onChange={(e) => setIncludeEntries(e.target.checked)}
                  />
                  Also include the _entries PDFs
                </label>
              )}
              <button
                onClick={handleDownload}
                disabled={busy || selectedCount === 0}
                className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
              >
                Download ZIP{selectedCount > 0 ? ` (${selectedCount})` : ''}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showMatch && (
        <InvoiceMatchModal
          rows={matchRows}
          files={files}
          autoMatches={autoMatches}
          initialMatches={matches}
          onConfirm={handleConfirmMatches}
          onCancel={() => setShowMatch(false)}
        />
      )}
    </>
  );
};

export default InvoicePackModal;