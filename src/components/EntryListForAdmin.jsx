import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, getDoc,doc, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import {
  exportToPDF,
  exportToExcel,
  exportToWord,
  exportClosureReport,
  entryDateToJS,
  parseInputDate,
  CLOSURE_FORMATS
} from '../services/exportService';
import EntryForm from './EntryForm';

// TODO: fill in your company name
const COMPANY_NAME = 'Company Name';

// Options shown in the closure report format dropdown
const CLOSURE_FORMAT_OPTIONS = [
  { value: CLOSURE_FORMATS.BATCH, label: 'By Batch' },
  { value: CLOSURE_FORMATS.TRAINER, label: 'By Trainer' },
  { value: CLOSURE_FORMATS.DATE, label: 'By Date' }
];

// Always dd/mm/yyyy, regardless of the browser's locale
const formatDMY = (value) => {
  const d = entryDateToJS(value);
  if (!d || isNaN(d.getTime())) return 'N/A';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
};

const EntryListForAdmin = () => {
  const [entries, setEntries] = useState([]);
  const [projects, setProjects] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [closureFormat, setClosureFormat] = useState(CLOSURE_FORMATS.BATCH);
  const [filters, setFilters] = useState({
  project: '',
  campus: '',
  batch: '',
  trainer: '',
  startDate: '',
  endDate: ''
  });
  // Dates being edited in the inputs. They only reach `filters` (and trigger a fetch) on Apply.
  const [dateDraft, setDateDraft] = useState({ startDate: '', endDate: '' });
  const [projectHasCampuses, setProjectHasCampuses] = useState(true);
  const [editingEntry,setEditingEntry] = useState(null);
  const [showPhaseModal,setShowPhaseModal] = useState(false);
  const [phaseInput,setPhaseInput] = useState('');

  const handleEdit = (entry) => setEditingEntry(entry);

  const handleEditSaved = () => {
    setEditingEntry(null);
    fetchEntries();
  }

  const datesDirty =
    dateDraft.startDate !== filters.startDate || dateDraft.endDate !== filters.endDate;
  const hasAnyDate = Boolean(
    dateDraft.startDate || dateDraft.endDate || filters.startDate || filters.endDate
  );

  const applyDates = () => {
    if (!datesDirty) return;
    // yyyy-mm-dd strings compare correctly as text
    if (dateDraft.startDate && dateDraft.endDate && dateDraft.startDate > dateDraft.endDate) {
      alert('Start date cannot be after end date.');
      return;
    }
    setFilters(prev => ({
      ...prev,
      startDate: dateDraft.startDate,
      endDate: dateDraft.endDate
    }));
  };

  const clearDates = () => {
    setDateDraft({ startDate: '', endDate: '' });
    setFilters(prev => ({ ...prev, startDate: '', endDate: '' }));
  };

  const handleDateKeyDown = (e) => {
    if (e.key === 'Enter') applyDates();
  };

  // Closure report needs: project, (campus if the project has campuses), start date and end date.
  // It does its own fetch, so it uses the draft dates and doesn't require clicking Apply.
  const canGenerateClosureReport = Boolean(
    filters.project &&
    (!projectHasCampuses || filters.campus) &&
    dateDraft.startDate &&
    dateDraft.endDate
  );
  
  const showClosureReport = Boolean(filters.project)

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      let q = query(collection(db, 'entries'), orderBy('date', 'desc'));
      
      const constraints = [];
      
  if (filters.project) {
        constraints.push(where('projectId', '==', filters.project));
      }
      
      if (filters.campus) {
        constraints.push(where('campusId', '==', filters.campus));
      }
      
      if (filters.batch) {
        constraints.push(where('batchId', '==', filters.batch));
      }
      
      if (filters.trainer) {
        constraints.push(where('trainerId', '==', filters.trainer));
      }

      // date range filters
      if (filters.startDate) {
        constraints.push(where('date', '>=', new Date(filters.startDate)));
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23,59,59,999);
        constraints.push(where('date', '<=', end));
      }
      
      if (constraints.length > 0) {
        q = query(collection(db, 'entries'), ...constraints, orderBy('date', 'desc'));
      }
      
      const querySnapshot = await getDocs(q);
      const entriesData = [];
      querySnapshot.forEach((doc) => {
        entriesData.push({ id: doc.id, ...doc.data() });
      });
      
      setEntries(entriesData);
    } catch (error) {
      console.error('Error fetching entries:', error);
    }
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    fetchProjects();
    fetchTrainers();
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    if (filters.project) {
      fetchCampuses(filters.project);
      fetchBatchesForProject(filters.project);
    } else {
      setCampuses([]);
      setBatches([]);
      setFilters(prev => ({ ...prev, campus: '', batch: '' }));
      setProjectHasCampuses(true);
    }
  }, [filters.project]);

  useEffect(() => {
    if (filters.campus && projectHasCampuses) {
      fetchBatchesForCampus(filters.campus);
    }
  }, [filters.campus, projectHasCampuses]);

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
    }
  };

  const fetchTrainers = async () => {
    try {
      const q = query(collection(db, 'users'), where('role', '==', 'trainer'));
      const querySnapshot = await getDocs(q);
      const trainersData = [];
      querySnapshot.forEach((doc) => {
        trainersData.push({ id: doc.id, ...doc.data() });
      });
  // sort trainers alphabetically by display name or email
  trainersData.sort((a, b) => ((a.name || a.email) || '').toString().localeCompare(((b.name || b.email) || '').toString()));
  setTrainers(trainersData);
    } catch (error) {
      console.error('Error fetching trainers:', error);
    }
  };

  const unsub = onSnapshot(collection(db, 'projects'), (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'removed') {
        console.log('Deleted:', change.doc.id)
      }
    })
  })

  const getTrainerDisplay = (trainerId, entry) => {
    const t = trainers.find(tr => tr.id === trainerId || tr.uid === trainerId);
    if (t) return t.name || t.email || t.uid || 'N/A';
    // fallback to entry fields
    return (entry && (entry.trainerName || entry.trainerEmail)) || 'N/A';
  };

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
    } catch (error) {
      console.error('Error fetching campuses:', error);
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
      // If project doesn't have campuses, set batches directly
      if (batchesData.length > 0) {
        setBatches(batchesData);
      } else {
        setBatches([]);
      }
      
      // Reset batch filter when batches change
      setFilters(prev => ({ ...prev, batch: '' }));
    } catch (error) {
      console.error('Error fetching batches for project:', error);
      setBatches([]);
      setFilters(prev => ({ ...prev, batch: '' }));
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
      
      // Reset batch filter when batches change
      setFilters(prev => ({ ...prev, batch: '' }));
    } catch (error) {
      console.error('Error fetching batches for campus:', error);
      setBatches([]);
      setFilters(prev => ({ ...prev, batch: '' }));
    }
  };

  const handleFilterChange = (filterName, value) => {
    // Reset dependent filters when parent filter changes
    if (filterName === 'project') {
      setFilters(prev => ({
        ...prev,
        project: value,
        campus: '',
        batch: ''
      }));
    } else if (filterName === 'campus') {
      setFilters(prev => ({
        ...prev,
        campus: value,
        batch: ''
      }));
    } else {
      setFilters(prev => ({
        ...prev,
        [filterName]: value
      }));
    }
  };

  const handleExport = (format) => {
    if (format === 'pdf') {
      exportToPDF(entries, filters, 'Training Management System');
    } else if (format === 'excel') {
      exportToExcel(entries, filters);
    } else if (format === 'word') {
      exportToWord(entries, filters, 'Training Management System');
    }
  };

  const handleClosureReport = async (phase) => {
    if (!canGenerateClosureReport || generatingReport) return;

    const start = parseInputDate(dateDraft.startDate);
    const end = parseInputDate(dateDraft.endDate);
    end.setHours(23, 59, 59, 999);

    if (start > end) {
      alert('Start date cannot be after end date.');
      return;
    }

    setGeneratingReport(true);
    try {
      // Dedicated fetch: only project + campus + dates (ignores batch/trainer filters).
      // Dates are filtered in JS so no Firestore composite index is needed.
      const constraints = [where('projectId', '==', filters.project)];
      if (filters.campus && projectHasCampuses) {
        constraints.push(where('campusId', '==', filters.campus));
      }
      const snap = await getDocs(query(collection(db, 'entries'), ...constraints));

      const reportEntries = [];
      snap.forEach((d) => {
        const entry = { id: d.id, ...d.data() };
        const entryDate = entryDateToJS(entry.date);
        if (entryDate && entryDate >= start && entryDate <= end) {
          reportEntries.push(entry);
        }
      });

      if (reportEntries.length === 0) {
        alert('No entries found for the selected project, campus and date range.');
        return;
      }

      const project = projects.find(p => p.id === filters.project);
      const campus = campuses.find(c => c.id === filters.campus);
      let collegeName = '';
      if (project.college) {
        const collegeSnap = await getDoc(doc(db,'colleges',project.college));
        collegeName = collegeSnap.exists() ? collegeSnap.data().collegeName : '';
      }

      await exportClosureReport(reportEntries, {
        companyName: COMPANY_NAME,
        collegeName: collegeName,
        projectName: project ? project.name : '',
        phase,
        campusName: campus && projectHasCampuses ? campus.name : '',
        startDate: dateDraft.startDate,
        endDate: dateDraft.endDate,
        format: closureFormat // 'batch' | 'trainer' | 'date'
      });
    } catch (error) {
      console.error('Error generating closure report:', error);
      alert('Could not generate the closure report. Please check the console for details.');
    } finally {
      setGeneratingReport(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-4 md:mb-6">All Training Entries</h2>
      
            <div className="mb-4 flex flex-wrap items-end gap-x-3 gap-y-3">
        {/* Dropdown filters */}
        <div className="w-44">
          <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
          <select
            value={filters.project || ''}
            onChange={(e) => handleFilterChange('project', e.target.value)}
            className="w-full h-10 px-2 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Projects</option>
            {projects.map(project => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </div>

        {filters.project && projectHasCampuses && (
          <div className="w-44">
            <label className="block text-sm font-medium text-gray-700 mb-1">Campus</label>
            <select
              value={filters.campus || ''}
              onChange={(e) => handleFilterChange('campus', e.target.value)}
              className="w-full h-10 px-2 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Campuses</option>
              {campuses.map(campus => (
                <option key={campus.id} value={campus.id}>{campus.name}</option>
              ))}
            </select>
          </div>
        )}

        {filters.project && (
          <div className="w-44">
            <label className="block text-sm font-medium text-gray-700 mb-1">Batch</label>
            <select
              value={filters.batch || ''}
              onChange={(e) => handleFilterChange('batch', e.target.value)}
              className="w-full h-10 px-2 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              disabled={projectHasCampuses && !filters.campus}
            >
              <option value="">All Batches</option>
              {batches.map(batch => (
                <option key={batch.id} value={batch.id}>{batch.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="w-44">
          <label className="block text-sm font-medium text-gray-700 mb-1">Trainer</label>
          <select
            value={filters.trainer || ''}
            onChange={(e) => handleFilterChange('trainer', e.target.value)}
            className="w-full h-10 px-2 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Trainers</option>
            {trainers.map(trainer => (
              <option key={trainer.uid || trainer.id} value={trainer.uid || trainer.id || ''}>
                {trainer.name || trainer.email}
              </option>
            ))}
          </select>
        </div>

        {/* Date range: same row, no card */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
          <input
            type="date"
            value={dateDraft.startDate}
            onChange={(e) => setDateDraft(prev => ({ ...prev, startDate: e.target.value }))}
            onKeyDown={handleDateKeyDown}
            className="h-10 px-2 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
          <input
            type="date"
            value={dateDraft.endDate}
            onChange={(e) => setDateDraft(prev => ({ ...prev, endDate: e.target.value }))}
            onKeyDown={handleDateKeyDown}
            className="h-10 px-2 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <button
          onClick={applyDates}
          disabled={!datesDirty}
          className="h-10 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
        >
          Filter by dates
        </button>
        {hasAnyDate && (
          <button
            onClick={clearDates}
            className="h-10 px-4 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 text-sm"
          >
            Clear
          </button>
        )}

        {/* Exports */}
        <div className="flex gap-2">
          <button
            onClick={() => handleExport('pdf')}
            className="h-10 px-4 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
          >
            PDF
          </button>
          <button
            onClick={() => handleExport('excel')}
            className="h-10 px-4 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm"
          >
            Excel
          </button>
          <button
            onClick={() => handleExport('word')}
            className="h-10 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
          >
            Word
          </button>
        </div>

        {/* Closure report (only once a project is selected) */}
        {showClosureReport && (
          <>
            <div className="w-36">
              <label className="block text-sm font-medium text-gray-700 mb-1">Report Format</label>
              <select
                value={closureFormat}
                onChange={(e) => setClosureFormat(e.target.value)}
                className="w-full h-10 px-2 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                {CLOSURE_FORMAT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => {
                setPhaseInput('');
                setShowPhaseModal(true);
              }}
              disabled={generatingReport || !canGenerateClosureReport}
              className="h-10 px-4 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {generatingReport ? 'Generating...' : 'Closure Report'}
            </button>
          </>
        )}
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campus</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Batch</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Trainer</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Topic</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hours</th>
              <th className='px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-width'>Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-600">
                  Loading entries...
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-4 text-center text-gray-500">
                  No entries found
                </td>
              </tr>
            ) : (
              entries.map(entry => (
                <tr key={entry.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDMY(entry.date)}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">{entry.projectName}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">{entry.campusName || 'N/A'}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">{entry.batchName}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">{getTrainerDisplay(entry.trainerId, entry)}</td>
                  <td className="px-4 py-4 text-sm text-gray-900">
                    <div className="font-medium">{entry.topic}</div>
                    {(entry.subtopic || entry.description) && (
                      <div className="text-gray-500 text-xs">{entry.subtopic || entry.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                    <span className="font-medium">{entry.hours}</span> hrs
                    {entry.studentCount && (
                      <div className="text-gray-500 text-xs">{entry.studentCount} students</div>
                    )}
                  </td>
                  <td className='px-4 py-4 whitespace-nowrap text-sm'>
                    <button
                      onClick={() => handleEdit(entry)}
                      className='px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-xs'
                      >
                      Edit  
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {editingEntry && (
        <div className='fixed inset-0 z-50 bg-black/50 overflow-y-auto p-4'>
          <div className='bg-white rounded-xl shadow-xl max-w-4xl mx-auto my-8 p-6'>
            <EntryForm
              key={editingEntry.id}
              initialEntry={editingEntry}
              onSaved={handleEditSaved}
              onCancel={() => setEditingEntry(null)}
              />
          </div>
        </div>
      )}
      {showPhaseModal && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const phase = phaseInput.trim();
              if (!phase) return;
              setShowPhaseModal(false);
              handleClosureReport(phase);
            }}
            className='w-full max-w-sm bg-white rounded-lg shadow-xl p-5 space-y-4'>
            <h3 className='text-lg font-semibold text-gray-800'>Closure Report</h3> 
            <div>
              <label className='block text-sm font-medium text-gray-700 mb-1'>Phase Number</label>
              <input 
                type="number"
                min="1"
                autoFocus
                value={phaseInput}
                onChange={(e) => setPhaseInput(e.target.value)}
                placeholder='e.g. 1'
                className='w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500'
                required
              />
            </div>
            <div className='flex justify-end gap-2'>
              <button
                type='button'
                onClick={() => setShowPhaseModal(false)}
                className='px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200'>
                  Cancel
              </button>
              <button
                type='submit'
                disabled={!phaseInput.trim()}
                className='px-4 py-2 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-60'
              >
                Generate
              </button>
            </div> 
          </form>
        </div>
      )}
    </div>
  );
};

export default EntryListForAdmin;