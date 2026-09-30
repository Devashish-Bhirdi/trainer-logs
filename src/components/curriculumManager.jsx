import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, deleteDoc, doc, writeBatch } from 'firebase/firestore';
import { db } from '../services/firebase'; // <-- adjust to wherever you export `db`

/**
 * Lists every document in the `curriculum` collection and lets an admin delete them.
 *
 * Props:
 *  - refreshKey: number. Pass your `curriculumRefresh` state so the list reloads after an upload.
 */
export default function CurriculumManager({ refreshKey = 0 }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null); // { type: 'success' | 'error', text }
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [confirming, setConfirming] = useState(null); // array of doc ids awaiting confirmation
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'curriculum'));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (a.projectName || '').localeCompare(b.projectName || ''));
      setItems(rows);
      setSelected(new Set());
    } catch (err) {
      console.error('Error loading curriculum:', err);
      setMessage({ type: 'error', text: 'Could not load the curriculum. Please refresh.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const batchNames = Object.values(it.batch || {}).join(' ');
      const topics = Object.keys(it.data || {}).join(' ');
      return [it.projectName, it.campusName, batchNames, topics]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [items, search]);

  const toggleOne = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allVisibleSelected = filtered.length > 0 && filtered.every((it) => selected.has(it.id));

  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(filtered.map((it) => it.id)));

  const handleDelete = async () => {
    if (!confirming || confirming.length === 0) return;
    setDeleting(true);
    try {
      if (confirming.length === 1) {
        await deleteDoc(doc(db, 'curriculum', confirming[0]));
      } else {
        // Firestore batches are limited to 500 writes; chunk to be safe.
        for (let i = 0; i < confirming.length; i += 400) {
          const wb = writeBatch(db);
          confirming.slice(i, i + 400).forEach((id) => wb.delete(doc(db, 'curriculum', id)));
          await wb.commit();
        }
      }
      const gone = new Set(confirming);
      setItems((prev) => prev.filter((it) => !gone.has(it.id)));
      setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
      setMessage({
        type: 'success',
        text: `Deleted ${confirming.length} curriculum entr${confirming.length === 1 ? 'y' : 'ies'}.`,
      });
    } catch (err) {
      console.error('Error deleting curriculum:', err);
      setMessage({ type: 'error', text: 'Could not delete. Please try again.' });
    } finally {
      setDeleting(false);
      setConfirming(null);
    }
  };

  return (
    <section style={styles.wrap}>
      <header style={styles.header}>
        <h2 style={styles.title}>Uploaded curriculum</h2>
        <input
          type="search"
          placeholder="Search by project, campus, batch or topic"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={styles.search}
          aria-label="Search curriculum"
        />
      </header>

      {message && (
        <div
          role="status"
          style={{ ...styles.banner, ...(message.type === 'error' ? styles.bannerError : styles.bannerOk) }}
        >
          <span>{message.text}</span>
          <button style={styles.linkBtn} onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div style={styles.bulkBar}>
          <span>{selected.size} selected</span>
          <button style={styles.dangerBtn} onClick={() => setConfirming([...selected])}>
            Delete selected
          </button>
        </div>
      )}

      {loading ? (
        <p style={styles.muted}>Loading curriculum…</p>
      ) : filtered.length === 0 ? (
        <p style={styles.muted}>
          {items.length === 0 ? 'No curriculum has been uploaded yet.' : 'Nothing matches your search.'}
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th style={styles.th}>Project</th>
                <th style={styles.th}>Campus</th>
                <th style={styles.th}>Batches</th>
                <th style={styles.th}>Topics</th>
                <th style={styles.th} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => {
                const batchNames = Object.values(it.batch || {});
                const topicNames = Object.keys(it.data || {});
                return (
                  <tr key={it.id} style={selected.has(it.id) ? styles.rowSelected : undefined}>
                    <td style={styles.td}>
                      <input
                        type="checkbox"
                        checked={selected.has(it.id)}
                        onChange={() => toggleOne(it.id)}
                        aria-label={`Select ${it.projectName}`}
                      />
                    </td>
                    <td style={styles.td}>{it.projectName || '—'}</td>
                    <td style={styles.td}>{it.campusName || '—'}</td>
                    <td style={styles.td}>
                      {batchNames.length ? batchNames.join(', ') : '—'}
                    </td>
                    <td style={styles.td} title={topicNames.join(', ')}>
                      {topicNames.length} topic{topicNames.length === 1 ? '' : 's'}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>
                      <button style={styles.dangerBtn} onClick={() => setConfirming([it.id])}>
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirming && (
        <div style={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="del-title">
          <div style={styles.modal}>
            <h3 id="del-title" style={{ margin: 0 }}>
              Delete {confirming.length === 1 ? 'this curriculum?' : `${confirming.length} curriculum entries?`}
            </h3>
            <p style={styles.muted}>
              This permanently removes the document{confirming.length === 1 ? '' : 's'} from the database. It
              can't be undone.
            </p>
            <div style={styles.modalActions}>
              <button style={styles.secondaryBtn} onClick={() => setConfirming(null)} disabled={deleting}>
                Cancel
              </button>
              <button style={styles.dangerBtnSolid} onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// Inline styles so the component works regardless of your CSS setup.
// Swap for your own classes / Tailwind / MUI as needed.
const styles = {
  wrap: { padding: 16 },
  header: { display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  title: { margin: 0, fontSize: 20 },
  search: { padding: '8px 10px', minWidth: 260, border: '1px solid #ccc', borderRadius: 6 },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 12 },
  th: { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #ddd', fontWeight: 600 },
  td: { padding: '8px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' },
  rowSelected: { background: 'rgba(220, 38, 38, 0.06)' },
  muted: { color: '#666' },
  banner: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 12px', borderRadius: 6, marginTop: 12 },
  bannerOk: { background: '#e7f6ec', color: '#14532d' },
  bannerError: { background: '#fdecec', color: '#7f1d1d' },
  bulkBar: { display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 },
  linkBtn: { background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer' },
  dangerBtn: { background: 'none', border: '1px solid #dc2626', color: '#dc2626', padding: '4px 10px', borderRadius: 6, cursor: 'pointer' },
  dangerBtnSolid: { background: '#dc2626', border: '1px solid #dc2626', color: '#fff', padding: '6px 14px', borderRadius: 6, cursor: 'pointer' },
  secondaryBtn: { background: '#fff', border: '1px solid #ccc', padding: '6px 14px', borderRadius: 6, cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 1000 },
  modal: { background: '#fff', color: '#111', padding: 20, borderRadius: 10, width: 'min(420px, 92vw)', display: 'grid', gap: 8 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
};