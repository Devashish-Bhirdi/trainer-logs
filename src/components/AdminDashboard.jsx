import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, query, where, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { initializeApp, getApps } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { auth, db, firebaseConfig } from '../services/firebase';
import { useAuth } from '../hooks/useAuth';
import EntryListForAdmin from './EntryListForAdmin';
import ChangePasswordForm from './ChangePasswordForm';

const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState('entries');
  const [trainerEmail, setTrainerEmail] = useState('');
  const [trainerName, setTrainerName] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [projectName, setProjectName] = useState('');
  const [campusName, setCampusName] = useState('');
  const [batchName, setBatchName] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedCampus, setSelectedCampus] = useState('');
  const [projects, setProjects] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const { logout, currentUser } = useAuth();


  const [existingTrainers, setExistingTrainers] = useState([]);
  const [trainerSearchTerm, setTrainerSearchTerm] = useState('');

  // Load data from Firestore
  useEffect(() => {
    fetchProjects();
    fetchExistingTrainers();
  }, []);

  const fetchExistingTrainers = async () => {
    try {
      const q = query(collection(db, 'users'), where('role', '==', 'trainer'));
      const querySnapshot = await getDocs(q);
      
      // Also fetch all entries to calculate entry counts per trainer and capture legacy/entry-only trainers
      const entriesSnapshot = await getDocs(collection(db, 'entries'));
      const entryCounts = {};
      const entryTrainersMap = {};

      entriesSnapshot.forEach((doc) => {
        const data = doc.data();
        const tid = data.trainerId || data.trainerEmail;
        if (tid) {
          entryCounts[tid] = (entryCounts[tid] || 0) + 1;
          if (data.trainerEmail && !entryTrainersMap[data.trainerEmail.toLowerCase()]) {
            entryTrainersMap[data.trainerEmail.toLowerCase()] = {
              id: data.trainerId || data.trainerEmail,
              email: data.trainerEmail,
              name: data.trainerName || '',
              role: 'trainer'
            };
          }
        }
      });

      const trainersMap = {};

      // 1. Add trainers registered in users collection
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const trainerId = doc.id;
        const uid = data.uid || trainerId;
        const emailKey = (data.email || '').toLowerCase();
        
        const countByDoc = entryCounts[trainerId] || 0;
        const countByUid = uid !== trainerId ? (entryCounts[uid] || 0) : 0;
        const countByEmail = emailKey ? (entryCounts[emailKey] || 0) : 0;
        const count = countByDoc + countByUid + countByEmail;

        const record = { id: doc.id, ...data, entryCount: count };
        trainersMap[doc.id] = record;
        if (emailKey) trainersMap[emailKey] = record;
      });

      // 2. Add trainers found in entries collection who might not be in users collection
      Object.keys(entryTrainersMap).forEach((emailKey) => {
        if (!trainersMap[emailKey]) {
          const info = entryTrainersMap[emailKey];
          const count = entryCounts[info.id] || entryCounts[emailKey] || 0;
          const record = { ...info, entryCount: count };
          trainersMap[emailKey] = record;
        }
      });

      // Convert map values to array (removing duplicate keys mapping to same record)
      const uniqueTrainers = Array.from(new Set(Object.values(trainersMap)));
      uniqueTrainers.sort((a, b) => ((a.name || a.email) || '').toString().localeCompare(((b.name || b.email) || '').toString()));
      setExistingTrainers(uniqueTrainers);
    } catch (error) {
      console.error('Error fetching existing trainers:', error);
    }
  };

  useEffect(() => {
    if (selectedProject) {
      fetchCampuses(selectedProject);
    } else {
      setCampuses([]);
    }
  }, [selectedProject]);

  useEffect(() => {
    if (selectedProject && selectedCampus) {
      fetchBatches(selectedProject, selectedCampus);
    } else {
      setBatches([]);
    }
  }, [selectedProject, selectedCampus]);

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
    } catch (error) {
      console.error('Error fetching campuses:', error);
    }
  };

  const fetchBatches = async (projectId, campusId) => {
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
      console.error('Error fetching batches:', error);
    }
  };

  const handleCreateTrainer = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      let uidToUse = null;

      try {
        // Create a secondary Firebase app instance so current admin auth state is preserved
        let secondaryApp = getApps().find(app => app.name === 'SecondaryAuthApp');
        if (!secondaryApp) {
          secondaryApp = initializeApp(firebaseConfig, 'SecondaryAuthApp');
        }
        const secondaryAuth = getAuth(secondaryApp);

        const defaultPassword = 'password123';
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, trainerEmail, defaultPassword);
        uidToUse = userCredential.user.uid;
        
        // Sign out from secondary instance immediately
        await secondaryAuth.signOut();
      } catch (authErr) {
        if (authErr.code === 'auth/email-already-in-use') {
          // If email exists in Firebase Auth, fetch existing user doc or use email as identifier
          const qExist = query(collection(db, 'users'), where('email', '==', trainerEmail));
          const snapExist = await getDocs(qExist);
          if (!snapExist.empty) {
            uidToUse = snapExist.docs[0].id;
          } else {
            uidToUse = trainerEmail;
          }
        } else {
          throw authErr;
        }
      }
      
      // Add or update in users collection
      await setDoc(doc(db, 'users', uidToUse), {
        uid: uidToUse,
        email: trainerEmail,
        name: trainerName,
        role: 'trainer',
        createdAt: new Date()
      }, { merge: true });
      
      setMessage(`Trainer account created/updated successfully! Default password is set to: password123`);
      
      // Reset form
      setTrainerEmail('');
      setTrainerName('');
      fetchExistingTrainers();
    } catch (error) {
      setMessage('Error creating trainer: ' + error.message);
    }
    
    setLoading(false);
    setTimeout(() => setMessage(''), 5000);
  };

  const handleDeleteTrainer = async (trainer) => {
    const nameOrEmail = trainer.name || trainer.email || 'this trainer';
    const ok = window.confirm(`Are you sure you want to delete trainer "${nameOrEmail}"?`);
    if (!ok) return;

    setLoading(true);
    try {
      if (trainer.id) {
        await deleteDoc(doc(db, 'users', trainer.id));
      }
      setMessage(`Trainer "${nameOrEmail}" deleted successfully.`);
      fetchExistingTrainers();
    } catch (error) {
      console.error('Error deleting trainer:', error);
      setMessage('Error deleting trainer: ' + (error.message || error));
    }
    setLoading(false);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleCreateProject = async (e) => {
    e.preventDefault();
    if (!projectName) {
      setMessage('Please enter a project name');
      setTimeout(() => setMessage(''), 3000);
      return;
    }

    setLoading(true);
    try {
      await addDoc(collection(db, 'projects'), {
        name: projectName,
        createdAt: new Date()
      });
      setMessage('Project created successfully!');
      setProjectName('');
      fetchProjects(); // Refresh the list
    } catch (error) {
      setMessage('Error creating project: ' + error.message);
    }
    setLoading(false);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleCreateCampus = async (e) => {
    e.preventDefault();
    if (!selectedProject || !campusName) {
      setMessage('Please select a project and enter a campus name');
      setTimeout(() => setMessage(''), 3000);
      return;
    }

    setLoading(true);
    try {
      await addDoc(collection(db, 'campuses'), {
        name: campusName,
        projectId: selectedProject,
        projectName: projects.find(p => p.id === selectedProject)?.name || '',
        createdAt: new Date()
      });
      setMessage('Campus created successfully!');
      setCampusName('');
      fetchCampuses(selectedProject); // Refresh the list
    } catch (error) {
      setMessage('Error creating campus: ' + error.message);
    }
    setLoading(false);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleCreateBatch = async (e) => {
    e.preventDefault();
    if (!selectedProject || !batchName) {
      setMessage('Please select a project and enter a batch name');
      setTimeout(() => setMessage(''), 3000);
      return;
    }

    // If no campus is selected but the project has exactly one campus, use that
    let campusIdToUse = selectedCampus;
    let campusNameToUse = campuses.find(c => c.id === selectedCampus)?.name || '';
    
    if (!selectedCampus && campuses.length === 1) {
      campusIdToUse = campuses[0].id;
      campusNameToUse = campuses[0].name;
    } else if (!selectedCampus) {
      setMessage('Please select a campus or create one first');
      setTimeout(() => setMessage(''), 3000);
      return;
    }

    setLoading(true);
    try {
      await addDoc(collection(db, 'batches'), {
        name: batchName,
        projectId: selectedProject,
        projectName: projects.find(p => p.id === selectedProject)?.name || '',
        campusId: campusIdToUse,
        campusName: campusNameToUse,
        createdAt: new Date()
      });
      setMessage('Batch created successfully!');
      setBatchName('');
      if (campusIdToUse) {
        fetchBatches(selectedProject, campusIdToUse); // Refresh the list
      }
    } catch (error) {
      setMessage('Error creating batch: ' + error.message);
    }
    setLoading(false);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Failed to log out', error);
    }
  };

  // Edit and Delete handlers for projects, campuses and batches
  const handleEditProject = async (project) => {
    const newName = window.prompt('Enter new project name', project.name);
    if (!newName || newName.trim() === '' || newName === project.name) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'projects', project.id), { name: newName });
      // update projectName on campuses and batches
      const qCamp = query(collection(db, 'campuses'), where('projectId', '==', project.id));
      const camps = await getDocs(qCamp);
      for (const c of camps.docs) {
        await updateDoc(doc(db, 'campuses', c.id), { projectName: newName });
      }
      const qBatch = query(collection(db, 'batches'), where('projectId', '==', project.id));
      const bs = await getDocs(qBatch);
      for (const b of bs.docs) {
        await updateDoc(doc(db, 'batches', b.id), { projectName: newName });
      }
      setMessage('Project renamed successfully');
      fetchProjects();
      if (selectedProject === project.id) setSelectedProject(project.id); // trigger campus refetch
    } catch (error) {
      setMessage('Error renaming project: ' + (error.message || error));
    }
    setLoading(false);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleDeleteProject = async (project) => {
    const ok = window.confirm(`Delete project "${project.name}" and all its campuses and batches? This cannot be undone.`);
    if (!ok) return;
    setLoading(true);
    try {
      // delete batches under project
      const qBatch = query(collection(db, 'batches'), where('projectId', '==', project.id));
      const bs = await getDocs(qBatch);
      for (const b of bs.docs) {
        await deleteDoc(doc(db, 'batches', b.id));
      }
      // delete campuses under project
      const qCamp = query(collection(db, 'campuses'), where('projectId', '==', project.id));
      const camps = await getDocs(qCamp);
      for (const c of camps.docs) {
        await deleteDoc(doc(db, 'campuses', c.id));
      }
      // delete project
      await deleteDoc(doc(db, 'projects', project.id));
      setMessage('Project and its children deleted');
      fetchProjects();
      setSelectedProject('');
      setCampuses([]);
      setBatches([]);
    } catch (error) {
      setMessage('Error deleting project: ' + (error.message || error));
    }
    setLoading(false);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleEditCampus = async (campus) => {
    const newName = window.prompt('Enter new campus name', campus.name);
    if (!newName || newName.trim() === '' || newName === campus.name) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'campuses', campus.id), { name: newName });
      // update campusName on batches
      const qBatch = query(collection(db, 'batches'), where('campusId', '==', campus.id));
      const bs = await getDocs(qBatch);
      for (const b of bs.docs) {
        await updateDoc(doc(db, 'batches', b.id), { campusName: newName });
      }
      setMessage('Campus renamed successfully');
      if (selectedProject) fetchCampuses(selectedProject);
      if (selectedCampus === campus.id) setSelectedCampus(campus.id);
    } catch (error) {
      setMessage('Error renaming campus: ' + (error.message || error));
    }
    setLoading(false);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleDeleteCampus = async (campus) => {
    const ok = window.confirm(`Delete campus "${campus.name}" and all its batches? This cannot be undone.`);
    if (!ok) return;
    setLoading(true);
    try {
      // delete batches under campus
      const qBatch = query(collection(db, 'batches'), where('campusId', '==', campus.id));
      const bs = await getDocs(qBatch);
      for (const b of bs.docs) {
        await deleteDoc(doc(db, 'batches', b.id));
      }
      // delete campus
      await deleteDoc(doc(db, 'campuses', campus.id));
      setMessage('Campus and its batches deleted');
      if (selectedProject) fetchCampuses(selectedProject);
      setSelectedCampus('');
      setBatches([]);
    } catch (error) {
      setMessage('Error deleting campus: ' + (error.message || error));
    }
    setLoading(false);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleEditBatch = async (batch) => {
    const newName = window.prompt('Enter new batch name', batch.name);
    if (!newName || newName.trim() === '' || newName === batch.name) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'batches', batch.id), { name: newName });
      setMessage('Batch renamed successfully');
      if (selectedProject && selectedCampus) fetchBatches(selectedProject, selectedCampus);
    } catch (error) {
      setMessage('Error renaming batch: ' + (error.message || error));
    }
    setLoading(false);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleDeleteBatch = async (batch) => {
    const ok = window.confirm(`Delete batch "${batch.name}"? This cannot be undone.`);
    if (!ok) return;
    setLoading(true);
    try {
      await deleteDoc(doc(db, 'batches', batch.id));
      setMessage('Batch deleted');
      if (selectedProject && selectedCampus) fetchBatches(selectedProject, selectedCampus);
    } catch (error) {
      setMessage('Error deleting batch: ' + (error.message || error));
    }
    setLoading(false);
    setTimeout(() => setMessage(''), 3000);
  };

  // ...existing code...

  const handleSendPasswordReset = async (e) => {
    e && e.preventDefault && e.preventDefault();
    if (!resetEmail) {
      setMessage('Please enter an email to send the reset link');
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      setMessage(`Password reset link sent to ${resetEmail}`);
      setResetEmail('');
    } catch (error) {
      setMessage('Error sending reset email: ' + (error.message || error));
    }
    setLoading(false);
    setTimeout(() => setMessage(''), 3000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      {/* Header */}
      <div className="bg-white shadow-lg border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <div className="mr-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-800 via-indigo-700 to-blue-700 flex items-center justify-center overflow-hidden shadow-md ring-1 ring-blue-900/20">
                  <img
                    src="https://res.cloudinary.com/dcjmaapvi/image/upload/v1730120218/Gryphon_Academy_Bird_Logo_yzzl3q.png"
                    alt="Bird logo"
                    className="h-7 w-7 object-contain"
                  />
                </div>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
            </div>
            <div className="flex items-center space-x-4">
              {/* small avatar for mobile */}
              <div className="md:hidden flex items-center mr-2">
                <div className="h-8 w-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-medium text-sm">
                  {currentUser?.displayName ? currentUser.displayName.charAt(0).toUpperCase() : currentUser?.email?.charAt(0).toUpperCase()}
                </div>
              </div>
              <div className="hidden md:flex items-center space-x-2 bg-blue-50 px-3 py-1 rounded-full">
                <div className="h-8 w-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-medium">
                  {currentUser?.displayName ? currentUser.displayName.charAt(0).toUpperCase() : currentUser?.email?.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm text-gray-700">
                  {currentUser?.displayName || currentUser?.email}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center space-x-1 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-md hover:from-red-600 hover:to-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-all duration-200 shadow-sm hover:shadow-md"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-xl shadow-sm p-1 mb-8 border border-gray-200 w-full">
          <nav className="flex space-x-2 px-2 overflow-x-auto" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('entries')}
              className={`py-2 px-4 sm:py-3 sm:px-6 rounded-lg font-medium text-sm flex items-center transition-all duration-200 ${
                activeTab === 'entries'
                  ? 'bg-blue-100 text-blue-700 shadow-inner'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className={`w-5 h-5 mr-2 ${activeTab === 'entries' ? 'text-blue-600' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              View All Entries
            </button>
            <button
              onClick={() => setActiveTab('addTrainer')}
              className={`py-2 px-4 sm:py-3 sm:px-6 rounded-lg font-medium text-sm flex items-center transition-all duration-200 ${
                activeTab === 'addTrainer'
                  ? 'bg-blue-100 text-blue-700 shadow-inner'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className={`w-5 h-5 mr-2 ${activeTab === 'addTrainer' ? 'text-blue-600' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              Add Trainer
            </button>
            <button
              onClick={() => setActiveTab('manageProjects')}
              className={`py-2 px-4 sm:py-3 sm:px-6 rounded-lg font-medium text-sm flex items-center transition-all duration-200 ${
                activeTab === 'manageProjects'
                  ? 'bg-blue-100 text-blue-700 shadow-inner'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className={`w-5 h-5 mr-2 ${activeTab === 'manageProjects' ? 'text-blue-600' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
              </svg>
              Manage Projects
            </button>
            <button
              onClick={() => setActiveTab('changePassword')}
              className={`py-2 px-4 sm:py-3 sm:px-6 rounded-lg font-medium text-sm flex items-center transition-all duration-200 ${
                activeTab === 'changePassword'
                  ? 'bg-blue-100 text-blue-700 shadow-inner'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className={`w-5 h-5 mr-2 ${activeTab === 'changePassword' ? 'text-blue-600' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Change Password
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          {activeTab === 'entries' && <EntryListForAdmin />}
          
          {activeTab === 'changePassword' && <ChangePasswordForm />}
          
          {activeTab === 'addTrainer' && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-2">Add New Trainer</h2>
              {message && (
                <div className={`p-4 rounded-md text-sm ${
                  message.includes('Error') 
                    ? 'bg-red-100 text-red-700 border border-red-200' 
                    : 'bg-green-100 text-green-700 border border-green-200'
                }`}>
                  {message}
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-blue-50 p-6 rounded-xl border border-blue-100">
                  <h3 className="text-lg font-medium text-blue-800 mb-4 flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                    Manual Registration
                  </h3>
                  <form onSubmit={handleCreateTrainer} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Trainer Name</label>
                      <input
                        type="text"
                        value={trainerName}
                        onChange={(e) => setTrainerName(e.target.value)}
                        className="w-full p-2 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        required
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Trainer Email</label>
                      <input
                        type="email"
                        value={trainerEmail}
                        onChange={(e) => setTrainerEmail(e.target.value)}
                        className="w-full p-2 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        required
                      />
                    </div>
                    
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full px-4 py-2 sm:py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 transition-all duration-200 shadow-sm hover:shadow-md"
                    >
                      {loading ? 'Creating...' : 'Create Trainer Account'}
                    </button>
                  </form>
                </div>
                
                <div className="bg-green-50 p-6 rounded-xl border border-green-100">
                  <h3 className="text-lg font-medium text-green-800 mb-4 flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 8a6 6 0 11-12 0 6 6 0 0112 0zM12 14v4" />
                    </svg>
                    Send Password Reset
                  </h3>

                  <p className="text-sm text-gray-600 mb-4">
                    Enter an existing trainer's email and send a password reset link. This will not create a new user.
                  </p>

                  <form onSubmit={handleSendPasswordReset} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Trainer Email</label>
                      <input
                        type="email"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder="trainer@example.com"
                        className="w-full p-2 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full px-4 py-2 sm:py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg hover:from-green-700 hover:to-green-800 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 transition-all duration-200 shadow-sm hover:shadow-md"
                    >
                      {loading ? 'Sending...' : 'Send Reset Link'}
                    </button>
                  </form>
                </div>
              </div>

              {/* Existing Trainers List */}
              <div className="mt-8 bg-gray-50 p-6 rounded-xl border border-gray-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <h3 className="text-lg font-medium text-gray-800 flex items-center">
                    <svg className="w-5 h-5 mr-2 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    Existing Trainers ({existingTrainers.length})
                  </h3>

                  {/* Search Bar */}
                  <div className="relative w-full sm:w-72">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <input
                      type="text"
                      value={trainerSearchTerm}
                      onChange={(e) => setTrainerSearchTerm(e.target.value)}
                      placeholder="Search by name or email..."
                      className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-colors"
                    />
                  </div>
                </div>

                {(() => {
                  const filteredTrainers = existingTrainers.filter((trainer) => {
                    if (!trainerSearchTerm.trim()) return true;
                    const term = trainerSearchTerm.toLowerCase();
                    const nameMatch = (trainer.name || '').toLowerCase().includes(term);
                    const emailMatch = (trainer.email || '').toLowerCase().includes(term);
                    return nameMatch || emailMatch;
                  });

                  if (existingTrainers.length === 0) {
                    return <p className="text-sm text-gray-500 italic">No existing trainers found.</p>;
                  }

                  if (filteredTrainers.length === 0) {
                    return (
                      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                        <svg className="w-12 h-12 mx-auto text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <p className="text-base font-medium text-gray-700">No trainers found</p>
                        <p className="text-sm text-gray-500 mt-1">
                          No results matching "<span className="font-semibold text-gray-700">{trainerSearchTerm}</span>". Try searching with a different name or email.
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div>
                      {trainerSearchTerm.trim() && (
                        <p className="text-xs text-gray-500 mb-2 font-medium">
                          Showing {filteredTrainers.length} of {existingTrainers.length} trainers
                        </p>
                      )}
                      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-100">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">#</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Trainer Name</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Trainer Email</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Total Entries</th>
                              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {filteredTrainers.map((trainer, index) => (
                              <tr key={trainer.id || index} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-3 text-sm text-gray-500">{index + 1}</td>
                                <td className="px-4 py-3 text-sm font-medium text-gray-900 flex items-center space-x-2">
                                  <span>{trainer.name || 'N/A'}</span>
                                  {trainer.entryCount === 0 && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                      NEW
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600">{trainer.email || 'N/A'}</td>
                                <td className="px-4 py-3 text-sm font-semibold text-blue-700">
                                  {trainer.entryCount || 0} {trainer.entryCount === 1 ? 'entry' : 'entries'}
                                </td>
                                <td className="px-4 py-3 text-sm text-right">
                                  <button
                                    onClick={() => handleDeleteTrainer(trainer)}
                                    title="Delete Trainer"
                                    className="inline-flex items-center px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition-colors shadow-sm"
                                  >
                                    <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
          
          {activeTab === 'manageProjects' && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-2">Manage Projects, Campuses, and Batches</h2>
              {message && (
                <div className={`p-4 rounded-md text-sm ${
                  message.includes('Error') 
                    ? 'bg-red-100 text-red-700 border border-red-200' 
                    : 'bg-green-100 text-green-700 border border-green-200'
                }`}>
                  {message}
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                  <h3 className="text-lg font-medium text-gray-800 mb-4 flex items-center">
                    <svg className="w-5 h-5 mr-2 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    Add Project
                  </h3>
                  <form onSubmit={handleCreateProject} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Project Name</label>
                      <input
                        type="text"
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        className="w-full p-2 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full px-4 py-2 sm:py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 transition-all duration-200 shadow-sm hover:shadow-md"
                    >
                      {loading ? 'Creating...' : 'Create Project'}
                    </button>
                  </form>
                </div>
                
                <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                  <h3 className="text-lg font-medium text-gray-800 mb-4 flex items-center">
                    <svg className="w-5 h-5 mr-2 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    Add Campus
                  </h3>
                  <form onSubmit={handleCreateCampus} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Select Project</label>
                      <select
                        value={selectedProject}
                        onChange={(e) => setSelectedProject(e.target.value)}
                        className="w-full p-2 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        required
                      >
                        <option value="">Select Project</option>
                        {projects.map(project => (
                          <option key={project.id} value={project.id}>{project.name}</option>
                        ))}
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Campus Name</label>
                      <input
                        type="text"
                        value={campusName}
                        onChange={(e) => setCampusName(e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        required
                      />
                    </div>
                    
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full px-4 py-2 sm:py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg hover:from-green-700 hover:to-green-800 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 transition-all duration-200 shadow-sm hover:shadow-md"
                    >
                      {loading ? 'Creating...' : 'Create Campus'}
                    </button>
                  </form>
                </div>
                
                <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                  <h3 className="text-lg font-medium text-gray-800 mb-4 flex items-center">
                    <svg className="w-5 h-5 mr-2 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    Add Batch
                  </h3>
                  <form onSubmit={handleCreateBatch} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Select Project</label>
                      <select
                        value={selectedProject}
                        onChange={(e) => setSelectedProject(e.target.value)}
                        className="w-full p-2 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        required
                      >
                        <option value="">Select Project</option>
                        {projects.map(project => (
                          <option key={project.id} value={project.id}>{project.name}</option>
                        ))}
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Select Campus</label>
                      <select
                        value={selectedCampus}
                        onChange={(e) => setSelectedCampus(e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 transition-colors"
                        required={campuses.length > 1}
                        disabled={!selectedProject || campuses.length <= 1}
                      >
                        <option value="">{campuses.length === 1 ? campuses[0].name : "Select Campus"}</option>
                        {campuses.length > 1 && campuses.map(campus => (
                          <option key={campus.id} value={campus.id}>{campus.name}</option>
                        ))}
                      </select>
                      {campuses.length <= 1 && selectedProject && (
                        <p className="text-xs text-gray-500 mt-1">
                          {campuses.length === 0 
                            ? "No campuses available. Create a campus first." 
                            : "Only one campus available. It will be used automatically."}
                        </p>
                      )}
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Batch Name</label>
                      <input
                        type="text"
                        value={batchName}
                        onChange={(e) => setBatchName(e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        required
                      />
                    </div>
                    
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full px-4 py-2 sm:py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-lg hover:from-purple-700 hover:to-purple-800 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 transition-all duration-200 shadow-sm hover:shadow-md"
                    >
                      {loading ? 'Creating...' : 'Create Batch'}
                    </button>
                  </form>
                </div>
              </div>
              
              {/* Display current hierarchy */}
              <div className="mt-8 bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                <h3 className="text-lg font-medium text-gray-800 mb-4 flex items-center">
                  <svg className="w-5 h-5 mr-2 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  Current Hierarchy
                </h3>
                
                {projects.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <p>No projects found. Create your first project to get started.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {projects.map(project => (
                      <div key={project.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-gray-800 flex items-center">
                            <svg className="w-4 h-4 mr-2 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                            {project.name}
                          </h4>
                          <div className="space-x-2">
                            <button onClick={() => handleEditProject(project)} className="text-sm text-blue-600 hover:underline">Edit</button>
                            <button onClick={() => handleDeleteProject(project)} className="text-sm text-red-600 hover:underline">Delete</button>
                          </div>
                        </div>
                        
                        <div className="mt-3 ml-6 space-y-3 border-l-2 border-blue-200 pl-4">
                          {campuses.filter(c => c.projectId === project.id).length === 0 ? (
                            <div className="text-gray-400 text-sm bg-gray-50 p-2 rounded">
                              
                            </div>
                          ) : (
                            campuses.filter(c => c.projectId === project.id).map(campus => (
                              <div key={campus.id} className="border-l-2 border-green-200 pl-3">
                                <div className="flex items-center justify-between">
                                  <h5 className="font-medium text-gray-700 flex items-center">
                                    <svg className="w-4 h-4 mr-2 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                    </svg>
                                    {campus.name}
                                  </h5>
                                  <div className="space-x-2">
                                    <button onClick={() => handleEditCampus(campus)} className="text-sm text-blue-600 hover:underline">Edit</button>
                                    <button onClick={() => handleDeleteCampus(campus)} className="text-sm text-red-600 hover:underline">Delete</button>
                                  </div>
                                </div>
                                
                                <div className="mt-2 ml-4 space-y-2 border-l-2 border-purple-200 pl-3">
                                  {batches.filter(b => b.campusId === campus.id).length === 0 ? (
                                    <div className="text-gray-400 text-sm bg-gray-50 p-2 rounded">
                                      
                                    </div>
                                  ) : (
                                    batches.filter(b => b.campusId === campus.id).map(batch => (
                                      <div key={batch.id} className="text-gray-600 flex items-center justify-between">
                                        <div className="flex items-center">
                                          <svg className="w-4 h-4 mr-2 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                          </svg>
                                          {batch.name}
                                        </div>
                                        <div className="space-x-2">
                                          <button onClick={() => handleEditBatch(batch)} className="text-sm text-blue-600 hover:underline">Edit</button>
                                          <button onClick={() => handleDeleteBatch(batch)} className="text-sm text-red-600 hover:underline">Delete</button>
                                        </div>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;