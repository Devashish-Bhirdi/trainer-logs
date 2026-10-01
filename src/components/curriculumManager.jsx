import { useEffect, useState } from 'react';
import { collection, getDocs, query, where, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../services/firebase';

// shared table styling (same look as the Mapping page)
const TH = 'px-4 py-3 text-left text-xs font-semibold text-white';
const TD = 'px-4 py-3 text-sm text-gray-900';

/**
 * Lists the documents in the `curriculum` collection, narrowed by the Project / Campus filters,
 * and lets an admin delete them.
 *
 * Props:
 *  - refreshKey: number. Pass your `curriculumRefresh` state so the list reloads after an upload.
 */
export default function CurriculumManager({ refreshKey = 0 }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null); // { type: 'success' | 'error', text }
  const [confirmId, setConfirmId] = useState(null); // id of the document awaiting delete confirmation
  const [deleting, setDeleting] = useState(false);

  const [projects, setProjects] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [projectHasCampuses, setProjectHasCampuses] = useState(true);

  const [filters, setFilters] = useState({
    project: '',
    campus: '',
  });

  // ---------- Projects and campuses (for the filter dropdowns) ----------

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

  // Reloads whenever a filter changes (or the parent bumps refreshKey after an upload).
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
  }, [filters.project, filters.campus, refreshKey]);

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

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-4 md:mb-6">
        Curriculum Management
      </h2>

      {/* Filters */}
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

      {/* Confirm dialog */}
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
    </div>
  );
}