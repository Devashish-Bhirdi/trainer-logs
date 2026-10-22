import { useState, useEffect, useMemo } from 'react';

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const tKey = (t) => `${t.topic}||${t.module}||${t.lesson}`;

// trims separators left at the edges of a piece after cutting (numbers are kept)
const cleanPiece = (s) => s.replace(/^[\s,;:.\-–]+|[\s,;:.\-–]+$/g, '');

// a piece with no letters at all ("1.", "2)", "(3)", "-") can never be a lesson
const hasLetters = (s) => /\p{L}/u.test(s);

/**
 * Floating window (75% of the screen) for one entry.
 *
 * An extra (e.g. an old "subtopic" string holding many lessons) can be:
 *   - split into smaller pieces by highlighting text and clicking "Split selected text"
 *   - moved (a piece at a time) to SEVERAL curriculum lessons at once
 *
 * Props
 *  - row      : daily row { entryId, batchName, trainers, topics, module, taught, dateKey,
 *                           extra, rawExtras, mappings, splits, ignored }
 *               topics   = every topic taught in the session
 *               module   = every module taught, as one text ("Basics, Functions")
 *               taught   = [{ topic, module }] every topic / module pair taught in the session
 *               mappings = [{ extra, targets: [{ topic, module, lesson }] }]
 *               splits   = [{ source, parts: [string] }]
 *  - tree     : [{ topic, modules: [{ module, lessons: [] }] }]  (curriculum of this entry's batch)
 *  - saving   : boolean
 *  - error    : string | null
 *  - onSave   : (entryId, mappings, splits, ignored) => void
 *  - onClose  : () => void
 */
const ManageExtraModal = ({ row, tree, saving, error, onSave, onClose }) => {
  const [draft, setDraft] = useState(row.mappings || []);   // piece -> curriculum lessons
  const [splits, setSplits] = useState(row.splits || []);   // [{ source, parts }]
  const [ignored, setIgnored] = useState(row.ignored || []); // discarded pieces (plain strings)
  const [sel, setSel] = useState(null);                     // current text selection
  const [picked, setPicked] = useState(() => new Set());    // selected pieces (normalised text)
  const [targets, setTargets] = useState([]);               // selected curriculum lessons (several)
  const [search, setSearch] = useState('');

  // close on Escape
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  // every (topic, module) the session covered; a session can cover several modules
  const taught =
    row.taught && row.taught.length ? row.taught : [{ topic: (row.topics || [])[0], module: row.module }];

  // is this text exactly a lesson of one of the modules taught in this session? (then it needs no mapping)
  const isOwn = (text) =>
    taught.some((p) =>
      tree.some(
        (t) =>
          norm(t.topic) === norm(p.topic) &&
          t.modules.some(
            (m) => norm(m.module) === norm(p.module) && m.lessons.some((l) => norm(l) === norm(text))
          )
      )
    );

  // every piece of extra text: the original strings, cut up wherever the admin has split them
  const units = useMemo(() => {
    const out = [];
    const seen = new Set();
    (row.rawExtras || []).forEach((src) => {
      const sp = splits.find((s) => norm(s.source) === norm(src));
      (sp ? sp.parts : [src]).forEach((text) => {
        const k = norm(text);
        if (seen.has(k) || isOwn(text)) return;
        seen.add(k);
        out.push({ source: src, text });
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, splits, tree]);

  const movedKeys = new Set(draft.map((m) => norm(m.extra)));
  const ignoredKeys = new Set(ignored.map(norm));
  const stillExtra = units.filter((u) => !movedKeys.has(norm(u.text)) && !ignoredKeys.has(norm(u.text)));
  const ignoredUnits = units.filter((u) => ignoredKeys.has(norm(u.text)) && !movedKeys.has(norm(u.text)));

  const togglePick = (x) =>
    setPicked((prev) => {
      const next = new Set(prev);
      const k = norm(x);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const isTarget = (t) => targets.some((x) => tKey(x) === tKey(t));
  const toggleTarget = (t) =>
    setTargets((prev) => (isTarget(t) ? prev.filter((x) => tKey(x) !== tKey(t)) : [...prev, t]));

  // curriculum lessons whose name appears inside the text of the ticked pieces
  const suggested = useMemo(() => {
    const text = stillExtra
      .filter((u) => picked.has(norm(u.text)))
      .map((u) => norm(u.text))
      .join(' | ');
    if (!text) return [];
    const out = [];
    tree.forEach((t) =>
      t.modules.forEach((m) =>
        m.lessons.forEach((l) => {
          const n = norm(l);
          if (n.length >= 4 && text.includes(n)) out.push({ topic: t.topic, module: m.module, lesson: l });
        })
      )
    );
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, picked, units, draft]);

  const suggestedKeys = new Set(suggested.map(tKey));

  const selectSuggested = () =>
    setTargets((prev) => {
      const have = new Set(prev.map(tKey));
      return [...prev, ...suggested.filter((s) => !have.has(tKey(s)))];
    });

  // remember what is highlighted inside one piece's text
  const captureSelection = (e, unit) => {
    const s = window.getSelection();
    const node = e.currentTarget.firstChild;
    if (!s || s.isCollapsed || s.rangeCount === 0) return setSel(null);
    const r = s.getRangeAt(0);
    if (r.startContainer !== node || r.endContainer !== node) return setSel(null);
    setSel({ unit, start: r.startOffset, end: r.endOffset });
  };

  // cut the highlighted text out as its own extra (text before / after become their own pieces)
  const splitSelection = () => {
    if (!sel) return;
    const { unit, start, end } = sel;
    const t = unit.text;
    // junk like "1." or "2)" (no letters) is dropped instead of becoming an extra
    const pieces = [t.slice(0, start), t.slice(start, end), t.slice(end)]
      .map(cleanPiece)
      .filter((p) => p && hasLetters(p));
    if (pieces.length === 0) return;
    if (pieces.length === 1 && norm(pieces[0]) === norm(t)) return; // nothing would change

    setSplits((prev) => {
      const existing = prev.find((s) => norm(s.source) === norm(unit.source));
      const oldParts = existing ? existing.parts : [unit.source];
      const parts = oldParts.flatMap((p) => (norm(p) === norm(t) ? pieces : [p]));
      return [...prev.filter((s) => s !== existing), { source: unit.source, parts }];
    });
    setPicked(new Set());
    setSel(null);
    window.getSelection()?.removeAllRanges();
  };

  // put a split text back together (also drops moves made on its pieces)
  const mergeBack = (source) => {
    const sp = splits.find((s) => norm(s.source) === norm(source));
    if (!sp) return;
    const gone = new Set(sp.parts.map(norm));
    setSplits((prev) => prev.filter((s) => s !== sp));
    setDraft((prev) => prev.filter((m) => !gone.has(norm(m.extra))));
    setIgnored((prev) => prev.filter((x) => !gone.has(norm(x))));
    setPicked(new Set());
  };

  // throw the ticked pieces away: they stop counting as extra, without being mapped to a lesson
  const ignoreSelected = () => {
    if (picked.size === 0) return;
    const texts = stillExtra.filter((u) => picked.has(norm(u.text))).map((u) => u.text);
    setIgnored((prev) => [...prev, ...texts]);
    setPicked(new Set());
  };

  const unignore = (text) => setIgnored((prev) => prev.filter((x) => norm(x) !== norm(text)));

  const moveSelected = () => {
    if (targets.length === 0 || picked.size === 0) return;
    const additions = stillExtra
      .filter((u) => picked.has(norm(u.text)))
      .map((u) => ({ extra: u.text, targets }));
    setDraft((prev) => [...prev, ...additions]);
    setPicked(new Set());
    setTargets([]);
  };

  const undo = (extra) => setDraft((prev) => prev.filter((m) => norm(m.extra) !== norm(extra)));

  const q = norm(search);
  const filteredTree = useMemo(() => {
    if (!q) return tree;
    return tree
      .map((t) => ({
        ...t,
        modules: t.modules
          .map((m) => ({
            ...m,
            lessons:
              norm(t.topic).includes(q) || norm(m.module).includes(q)
                ? m.lessons
                : m.lessons.filter((l) => norm(l).includes(q)),
          }))
          .filter((m) => m.lessons.length),
      }))
      .filter((t) => t.modules.length);
  }, [tree, q]);

  const dirty =
    JSON.stringify(draft) !== JSON.stringify(row.mappings || []) ||
    JSON.stringify(splits) !== JSON.stringify(row.splits || []) ||
    JSON.stringify(ignored) !== JSON.stringify(row.ignored || []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manage extra lessons"
        className="flex flex-col rounded-lg bg-white shadow-xl"
        style={{ width: '75vw', height: '75vh', minWidth: 320 }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Manage extra</h3>
            <p className="text-sm text-gray-500">
              {row.batchName || 'N/A'} · {row.trainers.join(', ')} · {row.dateKey}
              {row.topics && row.topics.length > 0 && ` · ${row.topics.join(', ')}`}
              {row.module && ` › ${row.module}`}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-2 py-1 text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-5">
          {/* Left: the trainer's extras */}
          <div className="min-h-0 overflow-y-auto border-b border-gray-200 p-4 md:col-span-2 md:border-b-0 md:border-r">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-gray-800">
                Extra entered by trainer ({stillExtra.length})
              </h4>
              <button
                onClick={splitSelection}
                disabled={!sel}
                className="rounded-md border border-blue-900 px-2 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50 disabled:opacity-40"
              >
                Split selected text
              </button>
            </div>
            <p className="mb-2 text-xs text-gray-500">
              To separate a lesson from the rest: highlight it with the mouse, then click "Split selected text".
            </p>

            {stillExtra.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing left as extra.</p>
            ) : (
              <ul className="space-y-1">
                {stillExtra.map((u) => (
                  <li key={norm(u.text)}>
                    <div className="flex items-start gap-2 rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-900">
                      <input
                        type="checkbox"
                        className="mt-1 shrink-0"
                        checked={picked.has(norm(u.text))}
                        onChange={() => togglePick(u.text)}
                        aria-label="Select this extra"
                      />
                      <span
                        className="cursor-text select-text break-words"
                        onMouseUp={(e) => captureSelection(e, u)}
                      >
                        {u.text}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {splits.length > 0 && (
              <div className="mt-4 space-y-1">
                {splits.map((s) => (
                  <div key={s.source} className="flex items-center justify-between gap-2 text-xs text-gray-600">
                    <span className="truncate" title={s.source}>Split: {s.source}</span>
                    <button
                      onClick={() => mergeBack(s.source)}
                      className="shrink-0 font-medium text-red-600 hover:underline"
                    >
                      Merge back
                    </button>
                  </div>
                ))}
              </div>
            )}

            {ignoredUnits.length > 0 && (
              <>
                <h4 className="mb-2 mt-6 text-sm font-semibold text-gray-800">
                  Ignored ({ignoredUnits.length})
                </h4>
                <ul className="space-y-1">
                  {ignoredUnits.map((u) => (
                    <li
                      key={norm(u.text)}
                      className="flex items-start justify-between gap-2 rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-600"
                    >
                      <span className="min-w-0 break-words line-through">{u.text}</span>
                      <button
                        onClick={() => unignore(u.text)}
                        className="shrink-0 text-xs font-medium text-red-600 hover:underline"
                      >
                        Undo
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {draft.length > 0 && (
              <>
                <h4 className="mb-2 mt-6 text-sm font-semibold text-gray-800">
                  Moved to the curriculum ({draft.length})
                </h4>
                <ul className="space-y-1">
                  {draft.map((m) => (
                    <li
                      key={norm(m.extra)}
                      className="flex items-start justify-between gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-900"
                    >
                      <span className="min-w-0">
                        <span className="block break-words font-medium">{m.extra}</span>
                        <span className="mt-1 block text-xs text-green-700">
                          → {m.targets.length} lesson{m.targets.length === 1 ? '' : 's'}:{' '}
                          {m.targets.map((t) => t.lesson).join(', ')}
                        </span>
                      </span>
                      <button
                        onClick={() => undo(m.extra)}
                        className="shrink-0 text-xs font-medium text-red-600 hover:underline"
                      >
                        Undo
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* Right: curriculum for this batch */}
          <div className="flex min-h-0 flex-col md:col-span-3">
            <div className="border-b border-gray-200 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-gray-800">
                  Curriculum for {row.batchName || 'this batch'}
                </h4>
                <div className="flex gap-2">
                  <button
                    onClick={selectSuggested}
                    disabled={suggested.length === 0}
                    className="rounded-md border border-blue-900 px-2 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50 disabled:opacity-40"
                    title="Lessons whose name appears in the ticked extra text"
                  >
                    Select suggested ({suggested.length})
                  </button>
                  <button
                    onClick={() => setTargets([])}
                    disabled={targets.length === 0}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Clear ({targets.length})
                  </button>
                </div>
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search topic, module or lesson"
                className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {tree.length === 0 ? (
                <p className="text-sm text-gray-500">No curriculum found for this batch.</p>
              ) : filteredTree.length === 0 ? (
                <p className="text-sm text-gray-500">No matches.</p>
              ) : (
                filteredTree.map((t) => (
                  <div key={t.topic} className="mb-5">
                    <div className="mb-1 text-sm font-semibold text-blue-900">{t.topic}</div>
                    {t.modules.map((m) => (
                      <div key={m.module} className="mb-3 pl-3">
                        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                          {m.module}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {m.lessons.map((l) => {
                            const t2 = { topic: t.topic, module: m.module, lesson: l };
                            const active = isTarget(t2);
                            const hint = !active && suggestedKeys.has(tKey(t2));
                            return (
                              <button
                                key={l}
                                type="button"
                                onClick={() => toggleTarget(t2)}
                                aria-pressed={active}
                                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                  active
                                    ? 'border-blue-900 bg-blue-900 text-white'
                                    : hint
                                      ? 'border-dashed border-blue-600 bg-blue-50 text-blue-900 hover:bg-blue-100'
                                      : 'border-gray-300 bg-white text-gray-800 hover:bg-blue-50'
                                }`}
                              >
                                {l}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-3">
          <div className="text-sm text-gray-600">
            {picked.size === 0
              ? 'Tick the extra on the left, then pick every curriculum lesson it covers.'
              : targets.length === 0
                ? `${picked.size} extra selected: now pick one or more lessons on the right.`
                : `${picked.size} extra → ${targets.length} lesson${targets.length === 1 ? '' : 's'}`}
            {error && <span className="ml-3 text-red-600">{error}</span>}
          </div>

          <div className="flex gap-2">
            <button
              onClick={ignoreSelected}
              disabled={picked.size === 0}
              title="Discard the ticked pieces (leftovers like '1.' or stray words)"
              className="rounded-md border border-gray-400 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Ignore selected
            </button>
            <button
              onClick={moveSelected}
              disabled={targets.length === 0 || picked.size === 0}
              className="rounded-md border border-blue-900 px-3 py-2 text-sm font-medium text-blue-900 hover:bg-blue-50 disabled:opacity-40"
            >
              Move to lessons
            </button>
            <button
              onClick={onClose}
              disabled={saving}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(row.entryId, draft, splits, ignored)}
              disabled={!dirty || saving}
              className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManageExtraModal;