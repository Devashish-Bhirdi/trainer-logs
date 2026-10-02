import { useEffect, useMemo, useState } from 'react';
import { HIGH_CONFIDENCE, fileLabel, rankFiles } from '../services/InvoiceMatching';

/**
 * Props
 *  - rows           : [{ key, name, count }]       trainers that need an invoice
 *  - files          : File[]                       invoice PDFs from the uploaded folder
 *  - autoMatches    : { [key]: { idx, score } }    automatic matches (idx -1 = none)
 *  - initialMatches : { [key]: idx } | null        earlier choices (when the modal is reopened)
 *  - onConfirm      : (matches) => void            matches = { [key]: file index, -1 = skip }
 *  - onCancel       : () => void
 */
const InvoiceMatchModal = ({ rows, files, autoMatches, initialMatches, onConfirm, onCancel }) => {
  const [matches, setMatches] = useState(() => {
    const m = {};
    rows.forEach((r) => {
      m[r.key] = initialMatches?.[r.key] ?? autoMatches[r.key]?.idx ?? -1;
    });
    return m;
  });

  // Row order is fixed when the modal opens (unmatched first, then "check", then confident),
  // so rows don't jump around while the user edits.
  const [order] = useState(() => {
    const rank = (r) => {
      const a = autoMatches[r.key];
      if (!a || a.idx < 0) return 0;
      return a.score >= HIGH_CONFIDENCE ? 2 : 1;
    };
    return [...rows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map((r) => r.key);
  });

  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);

  // files ranked by similarity, for each trainer
  const ranked = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => m.set(r.key, rankFiles(r.name, files)));
    return m;
  }, [rows, files]);

  // file index -> trainer keys that currently use it
  const usedBy = useMemo(() => {
    const m = new Map();
    Object.entries(matches).forEach(([key, idx]) => {
      if (idx < 0) return;
      if (!m.has(idx)) m.set(idx, []);
      m.get(idx).push(key);
    });
    return m;
  }, [matches]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const statusFor = (key) => {
    const idx = matches[key];
    const auto = autoMatches[key];
    const hadAuto = auto && auto.idx >= 0;
    if (idx < 0) {
      return hadAuto
        ? { label: 'Skip', cls: 'bg-gray-100 text-gray-700' }
        : { label: 'No match', cls: 'bg-orange-100 text-orange-800' };
    }
    if (hadAuto && idx === auto.idx) {
      return auto.score >= HIGH_CONFIDENCE
        ? { label: 'Matched', cls: 'bg-green-100 text-green-800' }
        : { label: 'Check', cls: 'bg-yellow-100 text-yellow-800' };
    }
    return { label: 'Manual', cls: 'bg-blue-100 text-blue-800' };
  };

  const matchedCount = Object.values(matches).filter((i) => i >= 0).length;
  const skippedCount = rows.length - matchedCount;
  const autoCount = rows.filter((r) => (autoMatches[r.key]?.idx ?? -1) >= 0).length;
  const unusedFiles = files.map((_, i) => i).filter((i) => !usedBy.has(i));

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 p-4" style={{ zIndex: 60 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Match invoices"
        className="flex flex-col rounded-lg bg-white shadow-xl"
        style={{ width: '80vw', maxWidth: 1000, height: '78vh', minWidth: 320 }}
      >
        <div className="border-b border-gray-200 px-5 py-4">
          <h3 className="text-lg font-semibold text-gray-900">Match invoices to trainers</h3>
          <p className="text-sm text-gray-500">
            {autoCount} of {rows.length} matched automatically. Check the highlighted rows, fix any wrong match, and
            for trainers with no match pick their file or leave them on Skip.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-blue-900 text-xs text-white">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Trainer</th>
                <th className="px-3 py-2 text-left font-semibold">Invoice file</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {order.map((key) => {
                const row = rowByKey.get(key);
                if (!row) return null;
                const idx = matches[key];
                const status = statusFor(key);
                const others = idx >= 0 ? (usedBy.get(idx) || []).filter((k) => k !== key) : [];
                const rowBg =
                  status.label === 'No match' ? 'bg-orange-50' : status.label === 'Check' ? 'bg-yellow-50' : '';
                return (
                  <tr key={key} className={rowBg}>
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-gray-900">{row.name}</div>
                      <div className="text-xs text-gray-500">
                        {row.count} entr{row.count === 1 ? 'y' : 'ies'}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <select
                        value={idx}
                        onChange={(e) => setMatches((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                        className="w-full max-w-md rounded-md border border-gray-300 bg-white p-1.5 text-xs"
                      >
                        <option value={-1}>— Skip (no invoice) —</option>
                        {ranked.get(key).map(({ i, s }) => (
                          <option key={i} value={i}>
                            {fileLabel(files[i])}
                            {s >= 0.4 ? ` (${Math.round(s * 100)}%)` : ''}
                          </option>
                        ))}
                      </select>
                      {others.length > 0 && (
                        <p className="mt-1 text-xs text-red-600">
                          This file is also chosen for {others.map((k) => rowByKey.get(k)?.name).join(', ')}.
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>
                        {status.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {unusedFiles.length > 0 && (
            <details className="mt-5 rounded-md border border-gray-200 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-gray-700">
                {unusedFiles.length} invoice file{unusedFiles.length === 1 ? '' : 's'} not used by any trainer
              </summary>
              <ul className="mt-2 space-y-1 text-sm text-gray-600">
                {unusedFiles.map((i) => (
                  <li key={i} className="truncate">
                    {fileLabel(files[i])}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-3">
          <span className="text-sm text-gray-600">
            {matchedCount} to merge, {skippedCount} skipped
          </span>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(matches)}
              className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Confirm and generate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceMatchModal;