import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Your web app's Firebase configuration
export const firebaseConfig = {
  apiKey: "AIzaSyDsx7vWi12fgOQWwnSNb12ltaueMvxO6dc",
  authDomain: "closure-report.firebaseapp.com",
  projectId: "closure-report",
  storageBucket: "closure-report.firebasestorage.app",
  messagingSenderId: "2720838408",
  appId: "1:2720838408:web:a496187cce00710b0472bd",
  measurementId: "G-5PZ4Y2R58R"
};
// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;