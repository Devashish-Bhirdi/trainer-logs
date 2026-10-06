import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../services/firebase';
import {
  exportToPDF,
  exportToExcel,
  exportToWord,
  exportClosureReport,
  entryDateToJS,
  parseInputDate
} from '../services/exportService';

// TODO: fill in your company name
const COMPANY_NAME = 'Company Name';

const EntryListForAdmin = () => {
  const [entries, setEntries] = useState([]);
  const [projects, setProjects] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [filters, setFilters] = useState({
  project: '',
  campus: '',
  batch: '',
  trainer: '',
  startDate: '',
  endDate: ''
  });
  const [projectHasCampuses, setProjectHasCampuses] = useState(true);

  // Closure report needs: project, (campus if the project has campuses), start date and end date
  const canGenerateClosureReport = Boolean(
    filters.project &&
    (!projectHasCampuses || filters.campus) &&
    filters.startDate &&
    filters.endDate
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

  const handleClosureReport = async () => {
    if (!canGenerateClosureReport || generatingReport) return;

    const start = parseInputDate(filters.startDate);
    const end = parseInputDate(filters.endDate);
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

      await exportClosureReport(reportEntries, {
        companyName: COMPANY_NAME,
        projectName: project ? project.name : '',
        campusName: campus && projectHasCampuses ? campus.name : '',
        startDate: filters.startDate,
        endDate: filters.endDate
      });
    } catch (error) {
      console.error('Error generating closure report:', error);
      alert('Could not generate the closure report. Please check the console for details.');
    } finally {
      setGeneratingReport(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-600">Loading entries...</div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-4 md:mb-6">All Training Entries</h2>
      
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
          <select
            value={filters.project || ''}
            onChange={(e) => handleFilterChange('project', e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Projects</option>
            {projects.map(project => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </div>
        
        {filters.project && projectHasCampuses && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Campus</label>
            <select
              value={filters.campus || ''}
              onChange={(e) => handleFilterChange('campus', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Campuses</option>
              {campuses.map(campus => (
                <option key={campus.id} value={campus.id}>{campus.name}</option>
              ))}
            </select>
          </div>
        )}
        
        {filters.project && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Batch</label>
            <select
              value={filters.batch || ''}
              onChange={(e) => handleFilterChange('batch', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              disabled={projectHasCampuses && !filters.campus}
            >
              <option value="">All Batches</option>
              {batches.map(batch => (
                <option key={batch.id} value={batch.id}>{batch.name}</option>
              ))}
            </select>
          </div>
        )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
            <input
              type="date"
              value={filters.startDate || ''}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
            <input
              type="date"
              value={filters.endDate || ''}
              onChange={(e) => handleFilterChange('endDate', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Trainer</label>
          <select
            value={filters.trainer || ''}
            onChange={(e) => handleFilterChange('trainer', e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Trainers</option>
            {trainers.map(trainer => (
              <option key={trainer.uid || trainer.id} value={trainer.uid || trainer.id || ''}>
                {trainer.name || trainer.email}
              </option>
            ))}
          </select>
        </div>
        
        <div className={`flex flex-col justify-end ${showClosureReport ? 'lg:col-span-2' : ''}`}>
          <label className="block text-sm font-medium text-gray-700 mb-1 invisible">Export</label>
          <div className="flex space-x-2">
            <button 
              onClick={() => handleExport('pdf')} 
              className="flex-1 px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
            >
              PDF
            </button>
            <button 
              onClick={() => handleExport('excel')} 
              className="flex-1 px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm"
            >
              Excel
            </button>
            <button 
              onClick={() => handleExport('word')} 
              className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
            >
              Word
            </button>
            {showClosureReport && (
            <button
              onClick={handleClosureReport}
              disabled={generatingReport || !canGenerateClosureReport}
              className="flex-[1.5] px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {generatingReport ? 'Generating...' : 'Closure Report'}
            </button>
            )}
          </div>
        </div>
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
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-4 text-center text-gray-500">
                  No entries found
                </td>
              </tr>
            ) : (
              entries.map(entry => (
                <tr key={entry.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(entry.date.seconds * 1000).toLocaleDateString()}
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default EntryListForAdmin;