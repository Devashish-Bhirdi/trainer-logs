import { useState, useEffect } from 'react';
import { addDoc, collection, getDocs, query, where, doc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../hooks/useAuth';

// Removes repeats (case-insensitive) but keeps the original order
const dedupe = (list) => {
  const seen = new Set();
  return list.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const EntryForm = ({ initialEntry = null, onSaved = () => {}, onCancel = () => {} }) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [project, setProject] = useState('');
  const [campus, setCampus] = useState('');
  const [batch, setBatch] = useState('');
  const [topic, setTopic] = useState('');                     // one topic per session
  const [selections, setSelections] = useState({});           // { moduleName: [ticked lessons] } for the chosen topic
  const [openModules, setOpenModules] = useState({});         // { moduleName: true } for expanded sections (all collapsed at start)
  const [extraLessons, setExtraLessons] = useState([]);       // typed under "Extra lessons", one chip each
  const [extraInput, setExtraInput] = useState('');           // text currently in the "Extra lessons" box
  const [description, setDescription] = useState('');         // free-text summary of the session
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [studentCount, setStudentCount] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');                   // heads-up shown when an edited entry can't be shown fully
  const [projects, setProjects] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [projectHasCampuses, setProjectHasCampuses] = useState(true);
  const [curriculumDocs, setCurriculumDocs] = useState([]);   // curriculum documents for the chosen batch
  const [curriculumLoading, setCurriculumLoading] = useState(false);

  const { currentUser } = useAuth();

  // Everything below is derived from the fetched curriculum documents - no extra fetching per dropdown.
  // Each document holds { topic: { module: [lessons] } }; merge all that apply to this batch into one map.
  const curriculumMap = {};
  curriculumDocs.forEach((d) => {
    Object.entries(d.data || {}).forEach(([topicName, mods]) => {
      if (!curriculumMap[topicName]) curriculumMap[topicName] = {};
      Object.entries(mods || {}).forEach(([mod, lessons]) => {
        curriculumMap[topicName][mod] = dedupe([...(curriculumMap[topicName][mod] || []), ...(lessons || [])]);
      });
    });
  });
  const topics = Object.keys(curriculumMap).sort((a, b) => a.localeCompare(b));

  // Modules of the chosen topic. Only these can ever be shown, so a topic/module mismatch is impossible.
  const modules = topic ? Object.keys(curriculumMap[topic] || {}) : [];

  // What was actually taught: every module of the topic that has at least one valid ticked lesson
  const coverage = modules
    .map((m) => {
      const options = curriculumMap[topic][m] || [];
      return { topic, module: m, lessons: (selections[m] || []).filter((l) => options.includes(l)) };
    })
    .filter((c) => c.lessons.length > 0);
  const totalTicked = coverage.reduce((n, c) => n + c.lessons.length, 0);

  // if editing, populate fields
  useEffect(() => {
    if (initialEntry) {
      const extras = initialEntry.extraLessons || [];
      setDate(new Date(initialEntry.date.seconds * 1000).toISOString().split('T')[0]);
      setProject(initialEntry.projectId || '');
      setCampus(initialEntry.campusId || '');
      setBatch(initialEntry.batchId || '');
      setExtraLessons(extras);
      setDescription(initialEntry.description || ''); // older entries have none
      setStartTime(initialEntry.startTime || '');
      setEndTime(initialEntry.endTime || '');
      setStudentCount(initialEntry.studentCount || '');
      setOpenModules({});
      setNotice('');

      if (Array.isArray(initialEntry.coverage) && initialEntry.coverage.length > 0) {
        // new-style entry: one item per module taught
        const entryTopics = [...new Set(initialEntry.coverage.map((c) => c.topic))];
        const firstTopic = entryTopics[0] || '';
        const selected = {};
        initialEntry.coverage
          .filter((c) => c.topic === firstTopic)
          .forEach((c) => { selected[c.module] = c.lessons || []; });
        setTopic(firstTopic);
        setSelections(selected);
        if (entryTopics.length > 1) {
          setNotice(
            `This entry covers more than one topic. Only "${firstTopic}" is shown here, and saving will remove the lessons from the other topics.`
          );
        }
      } else {
        // older entry: single topic/module with a flat lessons list
        const selected = {};
        if (initialEntry.module) {
          selected[initialEntry.module] = (initialEntry.lessons || []).filter((l) => !extras.includes(l));
        }
        setTopic(initialEntry.topic || '');
        setSelections(selected);
      }
    }
  }, [initialEntry]);

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    if (project) {
      fetchCampuses(project); // also loads the project's batches when the project has no campuses
    } else {
      // Don't clear campus/batch here: this branch also runs on the first render, after the
      // "Edit" effect has filled them in, and would wipe them. The dropdown onChange handlers
      // already clear campus/batch when the user changes the project.
      setCampuses([]);
      setBatches([]);
      setProjectHasCampuses(true);
    }
  }, [project]);

  useEffect(() => {
    if (campus && projectHasCampuses) {
      fetchBatchesForCampus(campus);
    }
  }, [campus, projectHasCampuses]);

  // Load the curriculum for the chosen batch (this is what feeds Topic -> Modules -> Lessons).
  // A curriculum document lists its batches in a `batch` map ({ batchId: batchName }), so fetch the
  // project's documents and keep the ones that include this batch.
  useEffect(() => {
    if (!batch || !project) {
      setCurriculumDocs([]);
      setCurriculumLoading(false);
      return;
    }

    let cancelled = false; // ignore the result if the batch changed while this was loading
    const loadCurriculum = async () => {
      setCurriculumLoading(true);
      try {
        const q = query(collection(db, 'curriculum'), where('projectId', '==', project));
        const snapshot = await getDocs(q);
        if (cancelled) return;
        setCurriculumDocs(
          snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((d) => d.batch && d.batch[batch])
        );
      } catch (error) {
        if (cancelled) return;
        console.error('Error fetching curriculum:', error);
        setCurriculumDocs([]);
        setMessage('Error loading curriculum');
      } finally {
        if (!cancelled) setCurriculumLoading(false);
      }
    };
    loadCurriculum();

    return () => { cancelled = true; };
  }, [batch, project]);

  const fetchProjects = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'projects'));
      const projectsData = [];
      querySnapshot.forEach((doc) => {
        projectsData.push({ id: doc.id, ...doc.data() });
      });
      // sort projects alphabetically by name
      projectsData.sort((a, b) => (a.name || '').toString().localeCompare((b.name || '').toString()));
      setProjects(projectsData);
    } catch (error) {
      console.error('Error fetching projects:', error);
      setMessage('Error loading projects');
    }
  };

  // NOTE: the fetch functions below don't reset campus/batch. That reset wiped the values
  // loaded by "Edit". The dropdown onChange handlers already clear them when the user changes a choice.
  const fetchCampuses = async (projectId) => {
    try {
      const q = query(collection(db, 'campuses'), where('projectId', '==', projectId));
      const querySnapshot = await getDocs(q);
      const campusesData = [];
      querySnapshot.forEach((doc) => {
        campusesData.push({ id: doc.id, ...doc.data() });
      });
      // sort campuses alphabetically by name
      campusesData.sort((a, b) => (a.name || '').toString().localeCompare((b.name || '').toString()));
      setCampuses(campusesData);
      setProjectHasCampuses(campusesData.length > 0);
      // Projects without campuses list their batches directly. Projects with campuses load batches
      // per campus, so the two fetches can't overwrite each other.
      if (campusesData.length === 0) fetchBatchesForProject(projectId);
    } catch (error) {
      console.error('Error fetching campuses:', error);
      setMessage('Error loading campuses');
      setProjectHasCampuses(true);
    }
  };

  const fetchBatchesForProject = async (projectId) => {
    try {
      const q = query(collection(db, 'batches'), where('projectId', '==', projectId));
      const querySnapshot = await getDocs(q);
      const batchesData = [];
      querySnapshot.forEach((doc) => {
        batchesData.push({ id: doc.id, ...doc.data() });
      });
      // sort batches alphabetically by name
      batchesData.sort((a, b) => (a.name || '').toString().localeCompare((b.name || '').toString()));
      setBatches(batchesData);
    } catch (error) {
      console.error('Error fetching batches for project:', error);
      setBatches([]);
      setBatch('');
    }
  };

  const fetchBatchesForCampus = async (campusId) => {
    try {
      const q = query(collection(db, 'batches'), where('campusId', '==', campusId));
      const querySnapshot = await getDocs(q);
      const batchesData = [];
      querySnapshot.forEach((doc) => {
        batchesData.push({ id: doc.id, ...doc.data() });
      });
      // sort batches alphabetically by name
      batchesData.sort((a, b) => (a.name || '').toString().localeCompare((b.name || '').toString()));
      setBatches(batchesData);
    } catch (error) {
      console.error('Error fetching batches for campus:', error);
      setMessage('Error loading batches');
      setBatches([]);
      setBatch('');
    }
  };

  const calculateHours = () => {
    if (startTime && endTime) {
      const start = new Date(`2000-01-01T${startTime}`);
      const end = new Date(`2000-01-01T${endTime}`);
      const diff = (end - start) / (1000 * 60 * 60);
      return diff > 0 ? diff.toFixed(2) : 0;
    }
    return 0;
  };

  // ---------- Validation: every field must be filled before the form can be submitted ----------

  const missingFields = [];
  if (!date) missingFields.push('Date');
  if (!project) missingFields.push('Project');
  if (projectHasCampuses && !campus) missingFields.push('Campus');
  if (!batch) missingFields.push('Batch');
  if (!topic) missingFields.push('Topic');
  // The module(s) are worked out from the ticked lessons, so at least one lesson from the list is needed
  if (topic && coverage.length === 0) missingFields.push('Lessons (tick at least one)');
  if (!description.trim()) missingFields.push('Description');
  if (!startTime) missingFields.push('Start time');
  if (!endTime) missingFields.push('End time');
  if (startTime && endTime && Number(calculateHours()) <= 0) missingFields.push('End time after start time');
  if (!(parseInt(studentCount, 10) >= 1)) missingFields.push('Student count');

  const isFormComplete = missingFields.length === 0;

  // ---------- Topic / module / lessons handlers ----------

  // Called whenever project, campus or batch changes - the old choices no longer apply
  const resetTopicSelection = () => {
    setTopic('');
    setSelections({});
    setOpenModules({});
    setNotice('');
  };

  const handleTopicChange = (value) => {
    // switching topic throws away the ticked lessons, so ask first if there are any
    const hasTicks = Object.values(selections).some((l) => l.length > 0);
    if (hasTicks && topic && value !== topic) {
      const ok = window.confirm('Changing the topic will clear the lessons you have ticked. Continue?');
      if (!ok) return;
    }
    setTopic(value);
    setSelections({});
    setOpenModules({});
    setNotice('');
  };

  const toggleModuleOpen = (moduleName) => {
    setOpenModules((prev) => ({ ...prev, [moduleName]: !prev[moduleName] }));
  };

  const toggleLesson = (moduleName, lesson) => {
    setSelections((prev) => {
      const current = prev[moduleName] || [];
      const next = current.includes(lesson)
        ? current.filter((l) => l !== lesson)
        : [...current, lesson];
      return { ...prev, [moduleName]: next };
    });
  };

  // "Extra lessons": each Add (or Enter) turns the text box into one chip, so any number can be added
  const addExtraLesson = () => {
    const text = extraInput.trim();
    if (!text) return;
    setExtraLessons((prev) => dedupe([...prev, text]));
    setExtraInput('');
  };

  const removeExtraLesson = (item) => {
    setExtraLessons((prev) => prev.filter((l) => l !== item));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Safety net: the button is already disabled until everything is filled, but never trust the UI alone
    if (!isFormComplete) {
      setMessage(`Error: please complete ${missingFields.join(', ')}.`);
      setTimeout(() => setMessage(''), 3000);
      return;
    }

    // Anything typed in the "Extra lessons" box but not yet added still counts
    const pending = extraInput.trim();
    const extras = dedupe(pending ? [...extraLessons, pending] : extraLessons);
    const lessons = dedupe([...coverage.flatMap((c) => c.lessons), ...extras]);

    setLoading(true);

    try {
      const hours = calculateHours();
      const selectedProjectData = projects.find(p => p.id === project);
      const selectedCampusData = campuses.find(c => c.id === campus);
      const selectedBatchData = batches.find(b => b.id === batch);
      const payload = {
        date: new Date(date),
        projectId: project,
        projectName: selectedProjectData?.name || '',
        campusId: projectHasCampuses ? campus : null,
        campusName: projectHasCampuses ? (selectedCampusData?.name || '') : '',
        batchId: batch,
        batchName: selectedBatchData?.name || '',
        coverage,                                   // [{ topic, module, lessons }] - one item per module taught
        moduleKeys: coverage.map((c) => `${c.topic}||${c.module}`), // lets you query with array-contains
        topic,                                      // the session's topic
        module: coverage[0].module,                 // first module, kept so existing screens don't break
        lessons,            // lessons from every module + extra lessons, combined
        extraLessons: extras, // just the extra ones, so they can be told apart later
        description: description.trim(), // the whole text as one string
        startTime,
        endTime,
        hours,              // the session's hours, stored once (not split per module)
        studentCount: parseInt(studentCount, 10),
        trainerId: currentUser.uid,
        trainerName: currentUser.displayName || currentUser.email,
      };

      if (initialEntry && initialEntry.id) {
        // update existing entry
        await updateDoc(doc(db, 'entries', initialEntry.id), payload);
        setMessage('Entry updated successfully!');
      } else {
        // create new entry
        await addDoc(collection(db, 'entries'), { ...payload, createdAt: new Date() });
        setMessage('Entry submitted successfully!');
      }
      // Reset form
      setDate(new Date().toISOString().split('T')[0]);
      setProject('');
      setCampus('');
      setBatch('');
      resetTopicSelection();
      setExtraLessons([]);
      setExtraInput('');
      setDescription('');
      setStartTime('');
      setEndTime('');
      setStudentCount('');
      onSaved();
    } catch (error) {
      setMessage('Error submitting entry: ' + error.message);
    }

    setLoading(false);
    setTimeout(() => setMessage(''), 3000);
  };

  return (
    <div >
      <h2 className="text-xl font-semibold text-gray-800 mb-4 md:mb-6">Add Work Entry</h2>

      {message && (
        <div className={`mb-4 p-3 rounded-md text-sm md:text-base ${
          message.includes('Error')
            ? 'bg-red-100 text-red-700'
            : 'bg-green-100 text-green-700'
        }`}>
          {message}
        </div>
      )}

      {notice && (
        <div className="mb-4 p-3 rounded-md text-sm text-amber-700 bg-amber-50 border border-amber-200">
          {notice}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 md:space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
            <select
              value={project}
              onChange={(e) => {
                setProject(e.target.value);
                setCampus('');
                setBatch('');
                resetTopicSelection();
              }}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              required
            >
              <option value="">Select Project</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {projectHasCampuses && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Campus</label>
              <select
                value={campus}
                onChange={(e) => {
                  setCampus(e.target.value);
                  setBatch('');
                  resetTopicSelection();
                }}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                required={projectHasCampuses}
                disabled={!project}
              >
                <option value="">Select Campus</option>
                {campuses.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Batch</label>
              <select
                value={batch}
                onChange={(e) => {
                  setBatch(e.target.value);
                  resetTopicSelection();
                }}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                required
                disabled={!campus}
              >
                <option value="">Select Batch</option>
                {batches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {!projectHasCampuses && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Batch</label>
              <select
                value={batch}
                onChange={(e) => {
                  setBatch(e.target.value);
                  resetTopicSelection();
                }}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                required
                disabled={!project}
              >
                <option value="">Select Batch</option>
                {batches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div></div> {/* Empty div for layout consistency */}
          </div>
        )}

        {batch && !curriculumLoading && curriculumDocs.length === 0 && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
            No curriculum has been added for this batch yet. Add it from the Mapping page first.
          </p>
        )}

        {/* Topic - chosen once for the whole session */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Topic</label>
            <select
              value={topic}
              onChange={(e) => handleTopicChange(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
              required
              disabled={!batch || topics.length === 0}
            >
              <option value="">{!batch ? 'Select Batch First' : 'Select Topic'}</option>
              {topics.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div></div> {/* Empty div for layout consistency */}
        </div>

        {/* Lessons - every module of the topic is a collapsible section; tick lessons in as many as were taught */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Lessons Covered
            {totalTicked > 0 && (
              <span className="ml-2 font-normal text-gray-500">({totalTicked} selected)</span>
            )}
          </label>

          {!topic ? (
            <p className="text-sm text-gray-500">Select a topic to see its modules and lessons.</p>
          ) : (
            <>
              <div className="border border-gray-300 rounded-md divide-y divide-gray-200 overflow-hidden">
                {modules.map((m) => {
                  const options = curriculumMap[topic][m] || [];
                  const ticked = (selections[m] || []).filter((l) => options.includes(l));
                  const isOpen = !!openModules[m];

                  return (
                    <div key={m}>
                      <button
                        type="button"
                        onClick={() => toggleModuleOpen(m)}
                        aria-expanded={isOpen}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left bg-gray-50 hover:bg-gray-100 transition-colors"
                      >
                        <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
                          <svg
                            className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          {m}
                        </span>
                        <span className={`text-sm whitespace-nowrap ${ticked.length > 0 ? 'text-blue-700 font-medium' : 'text-gray-500'}`}>
                          {ticked.length > 0 ? `${ticked.length} of ${options.length} selected` : 'None selected'}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="max-h-56 overflow-y-auto border-t border-gray-200 divide-y divide-gray-100">
                          {options.map((lesson) => (
                            <label
                              key={lesson}
                              className="flex items-start gap-2 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={ticked.includes(lesson)}
                                onChange={() => toggleLesson(m, lesson)}
                                className="mt-0.5"
                              />
                              <span>{lesson}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {coverage.length > 0 && (
                <p className="mt-2 text-sm text-gray-600">
                  Covered: {coverage.map((c) => `${c.module} (${c.lessons.length})`).join(', ')}
                </p>
              )}
            </>
          )}
        </div>

        {/* Description - free text about the session, saved as one string */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            required
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            placeholder="Briefly describe what was covered in this session"
          />
        </div>

        {/* Extra lessons - anything taught that isn't in the lists above */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Extra Lessons</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={extraInput}
              onChange={(e) => setExtraInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault(); // Enter would otherwise submit the whole form
                  addExtraLesson();
                }
              }}
              className="flex-1 p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="Taught something not listed? Type it and press Enter or the Add button"
            />
            <button
              type="button"
              onClick={addExtraLesson}
              disabled={!extraInput.trim()}
              className="px-4 py-2 rounded-md text-sm transition-colors bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-200"
            >
              Add
            </button>
          </div>

          {extraLessons.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {extraLessons.map(item => (
                <span
                  key={item}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-800 text-sm px-3 py-1"
                >
                  {item}
                  <button
                    type="button"
                    onClick={() => removeExtraLesson(item)}
                    aria-label={`Remove ${item}`}
                    className="text-blue-600 hover:text-blue-900 leading-none"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Hours</label>
            <input
              type="text"
              value={calculateHours()}
              readOnly
              className="w-full p-2 border border-gray-300 rounded-md bg-gray-100"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Student Count</label>
            <input
              type="number"
              min="1"
              value={studentCount}
              onChange={(e) => setStudentCount(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              required
              placeholder="Number of students"
            />
          </div>
        </div>

        {/* Tells the user why the button is disabled */}
        {!isFormComplete && (
          <p className="text-sm text-gray-500">
            Still needed: {missingFields.join(', ')}
          </p>
        )}

        <div className="flex space-x-3">
          <button
            type="submit"
            disabled={loading || !isFormComplete}
            className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm md:text-base"
          >
            {loading ? (initialEntry ? 'Saving...' : 'Submitting...') : (initialEntry ? 'Save Changes' : 'Submit Entry')}
          </button>
          {initialEntry && (
            <button
              type="button"
              onClick={() => { onCancel(); }}
              className="px-4 py-3 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm md:text-base"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

export default EntryForm;