// ── Firebase module ──────────────────────────────────────────
// On GitHub Pages: config injected into window._firebaseConfig by CI/CD
// Locally:         falls back to ./firebase-config.js

import { initializeApp }                          from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider,
         signInWithPopup, signOut as fbSignOut,
         onAuthStateChanged }                     from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, setDoc,
         onSnapshot }                             from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Try window global first (set by CI/CD), then fall back to local file
let firebaseConfig = window._firebaseConfig;

if (!firebaseConfig) {
  try {
    const mod = await import('./firebase-config.js');
    firebaseConfig = mod.firebaseConfig;
  } catch {
    console.warn('No firebase-config.js found — running in offline mode.');
  }
}

const isConfigured = firebaseConfig?.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY';

if (!isConfigured) {
  console.warn('Firebase: not configured. Using localStorage only.');
  window._fb = null;
  window.dispatchEvent(new CustomEvent('firebase-auth-changed', { detail: { user: null } }));
} else {
  const app      = initializeApp(firebaseConfig);
  const auth     = getAuth(app);
  const db       = getFirestore(app);
  const provider = new GoogleAuthProvider();
  let   unsubscribeSnapshot = null;

  function startListening(uid) {
    // Stop any previous listener
    if (unsubscribeSnapshot) unsubscribeSnapshot();

    unsubscribeSnapshot = onSnapshot(
      doc(db, 'users', uid, 'data', 'state'),
      snap => {
        if (snap.exists()) {
          // Fire event so app.js can update state + re-render
          window.dispatchEvent(new CustomEvent('firebase-data-updated', {
            detail: { data: snap.data() }
          }));
        }
      },
      err => console.warn('Firestore listener error:', err)
    );
  }

  async function saveData(uid, data) {
    await setDoc(doc(db, 'users', uid, 'data', 'state'), data);
  }

  window._fb = {
    signIn:         () => signInWithPopup(auth, provider),
    signOut:        () => fbSignOut(auth),
    saveData,
    startListening,
    get user()      { return auth.currentUser; },
  };

  onAuthStateChanged(auth, user => {
    if (user) {
      startListening(user.uid);
    } else {
      if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    }
    window.dispatchEvent(new CustomEvent('firebase-auth-changed', { detail: { user } }));
  });
}
