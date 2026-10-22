import React, { useState } from 'react'
import {
  collection,
  query,
  where,
  limit,
  getDocs,
  getDoc,
  getCountFromServer,
  writeBatch,
  doc,
} from 'firebase/firestore'
// Adjust this path to wherever your firebase config file exports `db`
import { db } from '../services/firebase'

const BATCH_SIZE = 500 // Firestore's max writes per batch

/*
  Re-points entries from a deleted project (projectA) to its replacement (projecta).
  Entries are matched on the OLD projectId (or old projectName), then updated with
  the NEW projectId + projectName.

  Re-running is safe: updated entries no longer match the old value, so the
  query only returns what is still left. If the daily quota runs out halfway,
  run it again after the quota resets and it continues where it stopped.
*/
const FixEntriesProject = () => {
  const [matchBy, setMatchBy] = useState('projectId')
  const [oldValue, setOldValue] = useState('')
  const [newProjectId, setNewProjectId] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [count, setCount] = useState(null)
  const [updated, setUpdated] = useState(0)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const buildQuery = (extra = []) =>
    query(collection(db, 'entries'), where(matchBy, '==', oldValue.trim()), ...extra)

  // Step 1: count how many entries will be changed (cheap: not one read per document)
  const handlePreview = async () => {
    setLoading(true)
    setMessage('')
    setCount(null)
    setUpdated(0)
    try {
      const snap = await getCountFromServer(buildQuery())
      setCount(snap.data().count)
      if (snap.data().count === 0) {
        setMessage(`No entries found with ${matchBy} = "${oldValue.trim()}".`)
      }
    } catch (err) {
      console.error(err)
      setMessage('Error checking entries: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // Step 2: update the entries in batches of 500
  const handleUpdate = async () => {
    const newId = newProjectId.trim()
    const newName = newProjectName.trim()

    if (!newId || !newName) {
      setMessage('Error: enter the new project ID and name.')
      return
    }
    if (matchBy === 'projectId' && oldValue.trim() === newId) {
      setMessage('Error: the old and new project ID are the same.')
      return
    }

    setLoading(true)
    setMessage('')
    let done = 0

    try {
      // Safety check: the new project should exist in `projects`
      const projectSnap = await getDoc(doc(db, 'projects', newId))
      if (!projectSnap.exists()) {
        const proceed = window.confirm(
          `No project with ID "${newId}" exists in the projects collection. Update the entries anyway?`
        )
        if (!proceed) {
          setLoading(false)
          return
        }
      } else if (projectSnap.data().name !== newName) {
        const proceed = window.confirm(
          `The project name in Firestore is "${projectSnap.data().name}", but you typed "${newName}". Continue with what you typed?`
        )
        if (!proceed) {
          setLoading(false)
          return
        }
      }

      const confirmed = window.confirm(
        `Update ${count ?? 'all matching'} entries to projectId "${newId}" and projectName "${newName}"?`
      )
      if (!confirmed) {
        setLoading(false)
        return
      }

      // Each loop fetches up to 500 entries that still match the old value,
      // updates them, and commits. Updated entries drop out of the next query.
      while (true) {
        const snap = await getDocs(buildQuery([limit(BATCH_SIZE)]))
        if (snap.empty) break

        const batch = writeBatch(db)
        snap.docs.forEach((d) => {
          batch.update(d.ref, { projectId: newId, projectName: newName })
        })
        await batch.commit()

        done += snap.size
        setUpdated(done)
      }

      setMessage(`Done. ${done} entries updated.`)
      setCount(0)
    } catch (err) {
      console.error(err)
      setUpdated(done)
      setMessage(
        `Error after updating ${done} entries: ${err.message}. ` +
          'If this is a quota error, run it again after the quota resets. It will continue with the remaining entries.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-800 mb-2">Re-link Entries to a New Project</h2>

      {message && (
        <div
          className={`p-4 rounded-md text-sm ${
            message.includes('Error')
              ? 'bg-red-100 text-red-700 border border-red-200'
              : 'bg-green-100 text-green-700 border border-green-200'
          }`}
        >
          {message}
        </div>
      )}

      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4 max-w-xl">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Find entries by</label>
          <select
            value={matchBy}
            onChange={(e) => {
              setMatchBy(e.target.value)
              setCount(null)
            }}
            className="w-full p-2 sm:p-3 border border-gray-300 rounded-lg"
          >
            <option value="projectId">Old project ID</option>
            <option value="projectName">Old project name</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {matchBy === 'projectId' ? 'Old project ID (projectA)' : 'Old project name (projectA)'}
          </label>
          <input
            type="text"
            value={oldValue}
            onChange={(e) => {
              setOldValue(e.target.value)
              setCount(null)
            }}
            className="w-full p-2 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <button
          type="button"
          onClick={handlePreview}
          disabled={loading || !oldValue.trim()}
          className="w-full px-4 py-2 sm:py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? 'Working...' : 'Find entries'}
        </button>

        {count !== null && count > 0 && (
          <>
            <p className="text-sm text-gray-700">
              Found <span className="font-semibold">{count}</span> entries to update.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                New project ID (projecta)
              </label>
              <input
                type="text"
                value={newProjectId}
                onChange={(e) => setNewProjectId(e.target.value)}
                className="w-full p-2 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                New project name (projecta)
              </label>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                className="w-full p-2 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <button
              type="button"
              onClick={handleUpdate}
              disabled={loading}
              className="w-full px-4 py-2 sm:py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 disabled:opacity-50"
            >
              {loading ? `Updating... (${updated} done)` : 'Update entries'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default FixEntriesProject