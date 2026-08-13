import { useState } from 'react';
import EntryForm from './EntryForm';
import EntryListForTrainer from './EntryListForTrainer';
import ChangePasswordForm from './ChangePasswordForm';
import { useAuth } from '../hooks/useAuth';

const TrainerDashboard = () => {
  const { logout, currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState('entryForm');
  const [editEntry, setEditEntry] = useState(null);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Failed to log out', error);
    }
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
              <h1 className="text-2xl font-bold text-gray-900">Trainer Dashboard</h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="hidden md:flex items-center space-x-2 bg-blue-50 px-3 py-1 rounded-full">
                <div className="h-8 w-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-medium">
                  {currentUser?.displayName ? currentUser.displayName.charAt(0).toUpperCase() : currentUser?.email?.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm text-gray-700">
                  {currentUser?.name || currentUser?.email}
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
        <div className="bg-white rounded-xl shadow-sm p-1 mb-8 border border-gray-200 w-max mx-auto">
          <nav className="flex space-x-2 overflow-x-auto" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('entryForm')}
              className={`py-3 px-6 rounded-lg font-medium text-sm flex items-center transition-all duration-200 ${
                activeTab === 'entryForm'
                  ? 'bg-blue-100 text-blue-700 shadow-inner'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className={`w-5 h-5 mr-2 ${activeTab === 'entryForm' ? 'text-blue-600' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Add New Entry
            </button>
            <button
              onClick={() => setActiveTab('entryList')}
              className={`py-3 px-6 rounded-lg font-medium text-sm flex items-center transition-all duration-200 ${
                activeTab === 'entryList'
                  ? 'bg-blue-100 text-blue-700 shadow-inner'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className={`w-5 h-5 mr-2 ${activeTab === 'entryList' ? 'text-blue-600' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              View My Entries
            </button>
            <button
              onClick={() => setActiveTab('changePassword')}
              className={`py-3 px-6 rounded-lg font-medium text-sm flex items-center transition-all duration-200 ${
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
          {activeTab === 'entryForm' && (
            <EntryForm
              initialEntry={editEntry}
              onSaved={() => {
                // after save, clear edit and switch to list
                setEditEntry(null);
                setActiveTab('entryList');
              }}
              onCancel={() => {
                setEditEntry(null);
              }}
            />
          )}
          {activeTab === 'entryList' && (
            <EntryListForTrainer onEditEntry={(entry) => { setEditEntry(entry); setActiveTab('entryForm'); }} />
          )}
          {activeTab === 'changePassword' && (
            <ChangePasswordForm />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 mt-8 border-t border-gray-200">
      </div>
    </div>
  );
};

export default TrainerDashboard;