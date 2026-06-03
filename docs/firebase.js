// ── Firebase module ──────────────────────────────────────────
// On GitHub Pages: config injected into window._firebaseConfig by CI/CD
// Locally:         falls back to ./firebase-config.js

import { initializeApp }                     from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, GoogleAuthProvider,
         signInWithPopup, signOut as fbSignOut,
         onAuthStateChanged }                from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc,
         onSnapshot }                        from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Try window global first (set by CI/CD), then fall back to local file
let firebaseConfig = window._firebaseConfig;

if (!firebaseConfig) {
  try {
    const mod = await import('./firebase-config.js');
    firebaseConfig = mod.firebaseConfig;
  } catch {
    console.warn('Firebase: no config found — running in localStorage mode.');
  }
}

const isConfigured = firebaseConfig?.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY';

if (!isConfigured) {
  window._fb = null;
  window.dispatchEvent(new CustomEvent('firebase-auth-changed', { detail: { user: null } }));
} else {
  const app      = initializeApp(firebaseConfig);
  const auth     = getAuth(app);
  const db       = getFirestore(app);
  const provider = new GoogleAuthProvider();
  let   unsubscribe = null;

  function startListening(uid) {
    if (unsubscribe) unsubscribe();
    unsubscribe = onSnapshot(
      doc(db, 'users', uid, 'data', 'state'),
      snap => {
        if (snap.exists()) {
          window.dispatchEvent(new CustomEvent('firebase-data-updated', {
            detail: { data: snap.data() }
          }));
        }
      },
      err => console.error('Firestore error:', err)
    );
  }

  async function saveData(uid, data) {
    await setDoc(doc(db, 'users', uid, 'data', 'state'), data);
  }

  async function loadData(uid) {
    const snap = await getDoc(doc(db, 'users', uid, 'data', 'state'));
    return snap.exists() ? snap.data() : null;
  }

  window._fb = {
    signIn:   () => signInWithPopup(auth, provider),
    signOut:  () => fbSignOut(auth),
    saveData,
    loadData,
    get user() { return auth.currentUser; },
  };

  onAuthStateChanged(auth, user => {
    if (user) {
      startListening(user.uid);
    } else {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    }
    window.dispatchEvent(new CustomEvent('firebase-auth-changed', { detail: { user } }));
  });
}
