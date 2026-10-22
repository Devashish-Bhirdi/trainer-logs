import { useState, useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom'; // Import BrowserRouter
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './services/firebase';
import Login from './components/Login';
import AdminDashboard from './components/AdminDashboard';
import TrainerDashboard from './components/TrainerDashboard';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      
      if (user) {
        // Check user role from Firestore
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            setUserRole(userDoc.data().role);
          } else {
            // If no user document, check if it's the admin (you need to set this up manually)
            if (user.email === 'admin@example.com') {
              setUserRole('admin');
            } else {
              setUserRole('trainer');
            }
          }
        } catch (error) {
          console.error('Error getting user role:', error);
          setUserRole('trainer');
        }
      } else {
        setUserRole(null);
      }
      
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <BrowserRouter> {/* Add BrowserRouter with basename here */}
      <div className="App">
        {!user ? (
          <Login />
        ) : userRole === 'admin' ? (
          <AdminDashboard />
        ) : (
          <TrainerDashboard />
        )}
      </div>
    </BrowserRouter>
  );
}

export default App;