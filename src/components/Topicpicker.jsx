import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';

export const normalize = (v) =>
  String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Loose match between a trainer's domain and a curriculum topic name
const matchesDomain = (topic, domain) => {
  const t = normalize(topic);
  const d = normalize(domain);
  return Boolean(t && d && (t.includes(d) || d.includes(t)));
};

// { topic: { module: [lessons] } } -> [{ topic, module, lessons }]
export const picksToTopics = (picks = {}) =>
  Object.entries(picks).flatMap(([topic, modules]) =>
    Object.entries(modules)
      .filter(([, lessons]) => lessons.length > 0)
      .map(([module, lessons]) => ({ topic, module, lessons }))
  );

/* ---------- Loads campuses, batches and curriculum for one project code ---------- */

const EMPTY = { project: null, campuses: [], batches: [], curriculum: [] };

export function useProjectCurriculum(projectCode) {
  const [state, setState] = useState({ status: 'idle', ...EMPTY });

  useEffect(() => {
    const code = normalize(projectCode);

    if (!code) {
      setState({ status: 'idle', ...EMPTY });
      return;
    }

    let cancelled = false;

    const timer = setTimeout(async () => {
      setState({ status: 'loading', ...EMPTY });

      try {
        // The sheet's Project Code is matched against projects.name.
        // The Firestore document id is the projectId used by the other collections.
        // Matching is case/space/punctuation-insensitive, so "ABC 101" matches "abc-101".
        const pSnap = await getDocs(collection(db, 'projects'));
        if (cancelled) return;

        const matches = pSnap.docs.filter((d) => normalize(d.data().name) === code);

        if (matches.length === 0) {
          setState({ status: 'not-found', ...EMPTY });
          return;
        }
        if (matches.length > 1) {
          setState({ status: 'ambiguous', ...EMPTY });
          return;
        }

        const project = { id: matches[0].id, ...matches[0].data() };

        const byProject = (name) =>
          getDocs(query(collection(db, name), where('projectId', '==', project.id)));

        const [cSnap, bSnap, curSnap] = await Promise.all([
          byProject('campuses'),
          byProject('batches'),
          byProject('curriculum'),
        ]);
        if (cancelled) return;

        const toList = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));

        setState({
          status: 'ready',
          project,
          campuses: toList(cSnap).sort(byName),
          batches: toList(bSnap).sort(byName),
          curriculum: toList(curSnap),
        });
      } catch (error) {
        if (cancelled) return;
        console.error('Error loading project curriculum:', error);
        setState({ status: 'error', ...EMPTY });
      }
    }, 400); // debounce while the project code is being typed

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectCode]);

  return state;
}

/* ---------- The picker UI ---------- */

const selectClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-800 focus:outline-none focus:ring-1 focus:ring-blue-800 disabled:bg-slate-100 disabled:text-slate-400';

/**
 * Props:
 *  - domain: the trainer's domain from the sheet
 *  - data:   result of useProjectCurriculum()
 *  - value:  { campusId, batchId, picks } for this trainer. Picks go into the mail live.
 *  - onChange(patch): merges the patch into this trainer's value
 */
export default function TopicPicker({ domain, data, value, onChange }) {
  const { status, campuses, batches, curriculum } = data;
  const { campusId = '', batchId = '', picks = {} } = value;

  const hasCampuses = campuses.length > 0;
  const [showAll, setShowAll] = useState(false);
  const [activeTopic, setActiveTopic] = useState('');

  const batchOptions = useMemo(
    () => (hasCampuses ? batches.filter((b) => b.campusId === campusId) : batches),
    [batches, campusId, hasCampuses]
  );

  // Merge every curriculum doc (one per sheet) linked to the chosen batch
  const merged = useMemo(() => {
    const out = {};
    if (!batchId) return out;

    curriculum
      .filter(
        (c) =>
          c.batch?.[batchId] &&
          (!hasCampuses || !c.campusId || c.campusId === campusId)
      )
      .forEach((c) => {
        Object.entries(c.data || {}).forEach(([topic, modules]) => {
          out[topic] = out[topic] || {};
          Object.entries(modules).forEach(([mod, lessons]) => {
            const existing = out[topic][mod] || [];
            out[topic][mod] = [...new Set([...existing, ...lessons])];
          });
        });
      });

    return out;
  }, [curriculum, batchId, campusId, hasCampuses]);

  const allTopics = useMemo(() => Object.keys(merged), [merged]);
  const matched = useMemo(
    () => allTopics.filter((t) => matchesDomain(t, domain)),
    [allTopics, domain]
  );
  const visibleTopics = matched.length && !showAll ? matched : allTopics;
  const visibleKey = visibleTopics.join('\u0000');

  useEffect(() => {
    setShowAll(false);
  }, [batchId, domain]);

  // Keep the selected topic valid when the list of visible topics changes
  useEffect(() => {
    if (!visibleTopics.includes(activeTopic)) {
      setActiveTopic(visibleTopics[0] || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, activeTopic]);

  const modules = activeTopic ? Object.keys(merged[activeTopic] || {}) : [];
  const addedModules = Object.keys(picks[activeTopic] || {});
  const selectedList = picksToTopics(picks);
  const totalLessons = selectedList.reduce((n, t) => n + t.lessons.length, 0);

  // `confirmed: true` is only kept so an older copy of the page that still checks it keeps working
  const setPicks = (next) => onChange({ picks: next, confirmed: true });

  const addModule = (mod) => {
    if (!mod || !activeTopic) return;
    setPicks({
      ...picks,
      [activeTopic]: {
        ...(picks[activeTopic] || {}),
        [mod]: [...merged[activeTopic][mod]],
      },
    });
  };

  // Add every module of the active topic that is not added yet
  const addAllModules = () => {
    if (!activeTopic) return;
    const topicPicks = { ...(picks[activeTopic] || {}) };
    modules.forEach((m) => {
      if (!topicPicks[m]) topicPicks[m] = [...merged[activeTopic][m]];
    });
    setPicks({ ...picks, [activeTopic]: topicPicks });
  };

  const removeModule = (mod, topic = activeTopic) => {
    const topicPicks = { ...(picks[topic] || {}) };
    delete topicPicks[mod];

    const next = { ...picks, [topic]: topicPicks };
    if (!Object.keys(topicPicks).length) delete next[topic];
    setPicks(next);
  };

  const toggleLesson = (mod, lesson) => {
    const current = picks[activeTopic]?.[mod] || [];
    const lessons = current.includes(lesson)
      ? current.filter((l) => l !== lesson)
      : [...current, lesson];

    setPicks({ ...picks, [activeTopic]: { ...picks[activeTopic], [mod]: lessons } });
  };

  const setAllLessons = (mod, all) =>
    setPicks({
      ...picks,
      [activeTopic]: {
        ...picks[activeTopic],
        [mod]: all ? [...merged[activeTopic][mod]] : [],
      },
    });

  if (status === 'loading')
    return <p className="text-sm text-slate-600">Loading curriculum…</p>;
  if (status === 'not-found')
    return (
      <p className="text-sm text-red-700">
        No project in the database matches this project code.
      </p>
    );
  if (status === 'ambiguous')
    return (
      <p className="text-sm text-red-700">
        More than one project matches this project code. Make the project names unique.
      </p>
    );
  if (status === 'error')
    return <p className="text-sm text-red-700">Could not load the curriculum.</p>;
  if (status !== 'ready')
    return (
      <p className="text-sm text-slate-600">
        Enter the project code to load campuses and batches.
      </p>
    );

  return (
    <div className="space-y-5">
      {/* Step 1: campus and batch */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {hasCampuses && (
          <label className="text-xs font-semibold text-slate-600">
            Campus
            <select
              value={campusId}
              onChange={(e) =>
                onChange({ campusId: e.target.value, batchId: '', picks: {} })
              }
              className={`${selectClass} mt-1`}
            >
              <option value="">Select campus</option>
              {campuses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="text-xs font-semibold text-slate-600">
          Batch
          <select
            value={batchId}
            disabled={hasCampuses && !campusId}
            onChange={(e) => onChange({ batchId: e.target.value, picks: {} })}
            className={`${selectClass} mt-1`}
          >
            <option value="">
              {hasCampuses && !campusId ? 'Select campus first' : 'Select batch'}
            </option>
            {batchOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Step 2: topic, modules and lessons */}
      {batchId && allTopics.length === 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          No curriculum is linked to this batch yet.
        </p>
      )}

      {allTopics.length > 0 && (
        <>
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            {matched.length ? (
              <>
                Domain <strong>{domain || '—'}</strong> matched {matched.length}{' '}
                topic(s).{' '}
                <button
                  type="button"
                  className="font-semibold text-blue-900 underline"
                  onClick={() => setShowAll((v) => !v)}
                >
                  {showAll ? 'Show matching only' : 'Show all topics'}
                </button>
              </>
            ) : (
              <>
                No topic matches the domain <strong>{domain || '—'}</strong>. Showing
                all topics.
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">
              Topic
              <select
                value={activeTopic}
                onChange={(e) => setActiveTopic(e.target.value)}
                className={`${selectClass} mt-1`}
              >
                {visibleTopics.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-semibold text-slate-600">
              Add module
              <select
                value=""
                onChange={(e) => addModule(e.target.value)}
                className={`${selectClass} mt-1`}
              >
                <option value="">Choose a module to add</option>
                {modules
                  .filter((m) => !addedModules.includes(m))
                  .map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          {modules.length > addedModules.length && (
            <button
              type="button"
              onClick={addAllModules}
              className="text-xs font-semibold text-blue-900 underline"
            >
              Add all {modules.length} modules of this topic
            </button>
          )}

          {/* Added modules with their lessons */}
          <div className="space-y-3">
            {addedModules.map((mod) => {
              const lessons = merged[activeTopic]?.[mod] || [];
              const chosen = picks[activeTopic]?.[mod] || [];

              return (
                <div key={mod} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{mod}</p>
                    <div className="flex items-center gap-3 text-xs font-semibold">
                      <button
                        type="button"
                        className="text-blue-900"
                        onClick={() =>
                          setAllLessons(mod, chosen.length !== lessons.length)
                        }
                      >
                        {chosen.length === lessons.length ? 'Clear all' : 'Select all'}
                      </button>
                      <button
                        type="button"
                        className="text-red-700"
                        onClick={() => removeModule(mod)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {lessons.map((lesson) => (
                      <label
                        key={lesson}
                        className="flex items-start gap-2 rounded px-2 py-1 text-sm text-slate-800 hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={chosen.includes(lesson)}
                          onChange={() => toggleLesson(mod, lesson)}
                        />
                        <span>{lesson}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Everything that goes into the mail, across all topics and modules */}
      <div className="border-t border-slate-200 pt-4">
        <p className="mb-2 text-xs font-semibold text-slate-600">
          In the mail · {selectedList.length} module(s), {totalLessons} lesson(s)
        </p>

        {selectedList.length === 0 ? (
          <p className="text-xs text-slate-500">
            Nothing selected yet. Add modules and tick lessons; the Preview tab
            updates as you go.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {selectedList.map(({ topic, module, lessons }) => (
              <li
                key={`${topic}\u0000${module}`}
                className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-800"
              >
                <span>
                  <strong>{topic}</strong> – {module} ({lessons.length})
                </span>
                <button
                  type="button"
                  className="shrink-0 font-semibold text-red-700"
                  onClick={() => removeModule(module, topic)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}