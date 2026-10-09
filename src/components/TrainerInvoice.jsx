import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import InvoicePackModal from './InvoicePackModal';

const EMPTY_FILTERS = {
  project: '',
  campus: '',
  batch: '',
  trainer: '',
  startDate: '',
  endDate: '',
};

const byName = (a, b) => (a.name || '').toString().localeCompare((b.name || '').toString());

const inputClass =
  'w-full h-11 px-3 border border-gray-300 rounded-lg text-sm bg-white focus:ring-blue-500 focus:border-blue-500 ' +
  'disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed';

const Field = ({ id, label, required, children }) => (
  <div>
    <label htmlFor={id} className="block text-xs font-semibold text-gray-700 mb-1.5">
      {label}
      {required && (
        <span className="text-red-600" aria-hidden="true"> *</span>
      )}
    </label>
    {children}
  </div>
);

const TrainerInvoice = () => {
  const [projects, setProjects] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [projectHasCampuses, setProjectHasCampuses] = useState(true);
  const [showPack, setShowPack] = useState(false);

  // ---------- data for the dropdowns (entries are NOT fetched on this page) ----------

  const fetchProjects = async () => {
    try {
      const snap = await getDocs(collection(db, 'projects'));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      data.sort(byName);
      setProjects(data);
    } catch (error) {
      console.error('Error fetching projects:', error);
    }
  };

  const fetchTrainers = async () => {
    try {
      const q = query(collection(db, 'users'), where('role', '==', 'trainer'));
      const snap = await getDocs(q);
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      data.sort((a, b) =>
        ((a.name || a.email) || '').toString().localeCompare(((b.name || b.email) || '').toString())
      );
      setTrainers(data);
    } catch (error) {
      console.error('Error fetching trainers:', error);
    }
  };

  const fetchCampuses = async (projectId) => {
    try {
      const q = query(collection(db, 'campuses'), where('projectId', '==', projectId));
      const snap = await getDocs(q);
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      data.sort(byName);
      setCampuses(data);
      setProjectHasCampuses(data.length > 0);
    } catch (error) {
      console.error('Error fetching campuses:', error);
      setProjectHasCampuses(true);
    }
  };

  const fetchBatches = async (field, value) => {
    try {
      const q = query(collection(db, 'batches'), where(field, '==', value));
      const snap = await getDocs(q);
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      data.sort(byName);
      setBatches(data);
    } catch (error) {
      console.error(`Error fetching batches by ${field}:`, error);
      setBatches([]);
    }
    // batch list changed, so the old selection is no longer valid
    setFilters((prev) => ({ ...prev, batch: '' }));
  };

  useEffect(() => {
    fetchProjects();
    fetchTrainers();
  }, []);

  // project changed -> load its campuses and batches (or clear everything)
  useEffect(() => {
    if (filters.project) {
      fetchCampuses(filters.project);
      fetchBatches('projectId', filters.project);
    } else {
      setCampuses([]);
      setBatches([]);
      setProjectHasCampuses(true);
      setShowPack(false);
    }
  }, [filters.project]);

  // campus changed -> load that campus's batches
  useEffect(() => {
    if (filters.campus && projectHasCampuses) {
      fetchBatches('campusId', filters.campus);
    }
  }, [filters.campus, projectHasCampuses]);

  // ---------- handlers ----------

  const handleFilterChange = (name, value) => {
    // changing a parent filter resets the ones that depend on it
    if (name === 'project') {
      setFilters((prev) => ({ ...prev, project: value, campus: '', batch: '' }));
    } else if (name === 'campus') {
      setFilters((prev) => ({ ...prev, campus: value, batch: '' }));
    } else {
      setFilters((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleReset = () => {
    setFilters(EMPTY_FILTERS);
    setShowPack(false);
  };

  const hasProject = Boolean(filters.project);
  const hasDates = Boolean(filters.startDate && filters.endDate);
  const dateOrderOk = !hasDates || filters.endDate >= filters.startDate; // yyyy-mm-dd strings compare correctly
  // project, start date and end date are all compulsory
  const canCreate = hasProject && hasDates && dateOrderOk;

  const missing = [];
  if (!hasProject) missing.push('a project');
  if (!filters.startDate) missing.push('a start date');
  if (!filters.endDate) missing.push('an end date');
  const hintText = !dateOrderOk
    ? 'The end date must be on or after the start date.'
    : missing.length > 0
    ? `Select ${missing.join(', ').replace(/, ([^,]*)$/, ' and $1')} to enable the invoice pack.`
    : 'Entries are loaded only when you create the pack.';
  const batchDisabled = !hasProject || (projectHasCampuses && !filters.campus);

  // ---------- render ----------

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Trainer Invoices</h2>
        <p className="mt-1 text-sm text-gray-600">
          Pick a project and period, then build the invoice pack for your trainers.
        </p>
      </div>

      <div className="max-w-4xl bg-white border border-gray-200 rounded-xl p-5 md:p-7">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          <Field id="inv-project" label="Project" required>
            <select
              id="inv-project"
              required
              aria-required="true"
              value={filters.project}
              onChange={(e) => handleFilterChange('project', e.target.value)}
              className={inputClass}
            >
              <option value="">Select a project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>

          {/* hidden only when the chosen project really has no campuses */}
          {(!hasProject || projectHasCampuses) && (
            <Field id="inv-campus" label="Campus">
              <select
                id="inv-campus"
                value={filters.campus}
                onChange={(e) => handleFilterChange('campus', e.target.value)}
                disabled={!hasProject}
                className={inputClass}
              >
                <option value="">{hasProject ? 'All campuses' : 'Select a project first'}</option>
                {campuses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
          )}

          <Field id="inv-batch" label="Batch">
            <select
              id="inv-batch"
              value={filters.batch}
              onChange={(e) => handleFilterChange('batch', e.target.value)}
              disabled={batchDisabled}
              className={inputClass}
            >
              <option value="">{hasProject ? 'All batches' : 'Select a project first'}</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>

          <Field id="inv-trainer" label="Trainer">
            <select
              id="inv-trainer"
              value={filters.trainer}
              onChange={(e) => handleFilterChange('trainer', e.target.value)}
              className={inputClass}
            >
              <option value="">All trainers</option>
              {trainers.map((t) => (
                <option key={t.uid || t.id} value={t.uid || t.id || ''}>
                  {t.name || t.email}
                </option>
              ))}
            </select>
          </Field>

          <Field id="inv-start" label="Start date" required>
            <input
              id="inv-start"
              type="date"
              required
              aria-required="true"
              value={filters.startDate}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field id="inv-end" label="End date" required>
            <input
              id="inv-end"
              type="date"
              required
              aria-required="true"
              aria-invalid={!dateOrderOk}
              value={filters.endDate}
              min={filters.startDate || undefined}
              onChange={(e) => handleFilterChange('endDate', e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-7 pt-5 border-t border-gray-200 flex flex-wrap items-center gap-3 md:gap-4">
          <button
            type="button"
            onClick={() => canCreate && setShowPack(true)}
            disabled={!canCreate}
            className="min-h-11 px-6 bg-blue-900 text-white rounded-lg text-sm font-semibold hover:bg-blue-800
                       disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed"
          >
            Create Invoice Pack
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="min-h-11 px-3 text-sm font-semibold text-gray-600 hover:text-gray-800"
          >
            Reset filters
          </button>
          <span className={`text-sm ${dateOrderOk ? 'text-gray-600' : 'text-red-600'}`}>{hintText}</span>
        </div>
      </div>

      {showPack && canCreate && (
        <InvoicePackModal
          trainers={trainers}
          filters={{
            project: filters.project,
            campus: filters.campus,
            batch: filters.batch,
            trainer: filters.trainer,
            startDate: filters.startDate,
            endDate: filters.endDate,
          }}
          filterLabels={{
            companyName: 'Training Management System',
            projectName: projects.find((p) => p.id === filters.project)?.name,
            campusName: campuses.find((c) => c.id === filters.campus)?.name,
            batchName: batches.find((b) => b.id === filters.batch)?.name,
            startDate: filters.startDate,
            endDate: filters.endDate,
          }}
          onClose={() => setShowPack(false)}
        />
      )}
    </div>
  );
};

export default TrainerInvoice;