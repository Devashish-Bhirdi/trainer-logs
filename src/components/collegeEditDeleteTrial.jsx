import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase'; 

const CollegesDebug = () => {
  const [colleges, setColleges] = useState([]);
  const [error, setError] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'colleges'),
      (snap) => setColleges(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => setError(err.message)
    );
    return () => unsub();
  }, []);

  return (
    <div className="bg-yellow-50 p-6 rounded-xl border border-yellow-300 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-800">
          Colleges (debug) <span className="text-sm text-gray-500">({colleges.length})</span>
        </h3>
        <button
          type="button"
          onClick={() => setShowRaw(!showRaw)}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
        >
          {showRaw ? 'Show formatted' : 'Show raw JSON'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-2">Error: {error}</p>}

      {showRaw ? (
        <pre className="text-xs bg-white p-3 rounded-lg border border-gray-200 overflow-auto max-h-96">
          {JSON.stringify(colleges, null, 2)}
        </pre>
      ) : (
        <div className="space-y-3 max-h-96 overflow-auto">
          {colleges.map((c) => {
            const projects = Object.entries(c.projects || {});
            return (
              <div key={c.id} className="bg-white p-3 rounded-lg border border-gray-200">
                <p className="font-medium text-gray-800">{c.collegeName}</p>
                <p className="text-xs text-gray-400 mb-2">id: {c.id}</p>
                {projects.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">No projects</p>
                ) : (
                  <ul className="text-sm text-gray-700 space-y-1">
                    {projects.map(([pid, pname]) => (
                      <li key={pid}>
                        <span className="font-medium">{String(pname)}</span>
                        <span className="text-xs text-gray-400"> ({pid})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CollegesDebug;