// Firebase initialization module (optional)
// Usage: set window.FIREBASE_CONFIG = { apiKey:..., authDomain:..., projectId:..., ... } before loading this module
// Collections expected: 'millers' and 'parties' with documents that have a 'name' field.

let firebaseEnabled = false;
let db = null;
window.firebaseNames = { enabled: false, init: null, status: 'not-initialized' };

async function initFirebase() {
  console.log('firebase-init: initFirebase called');
  if (!window.FIREBASE_CONFIG) {
    console.warn('firebase-init: no window.FIREBASE_CONFIG found');
    window.firebaseNames.status = 'no-config';
    window.firebaseNames.enabled = false;
    return false;
  }
  try {
    console.log('firebase-init: loading SDK...');
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js');
    const { getFirestore, collection, query, orderBy, startAt, endAt, limit, getDocs, addDoc, onSnapshot } = await import('https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js');
    const { getAuth, signInAnonymously, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js');
    console.log('firebase-init: SDK loaded');
    const app = initializeApp(window.FIREBASE_CONFIG);
    // initialize services
    db = getFirestore(app);
    const auth = getAuth(app);

    // Attempt anonymous sign-in so client has request.auth for secure rules
    let anonOk = false;
    try {
      await signInAnonymously(auth);
      anonOk = true;
      console.log('firebase-init: anonymous sign-in requested');
    } catch (e) {
      console.warn('firebase-init: anonymous sign-in failed', e);
      // continue — functions may still be usable depending on rules
    }

    // monitor auth state
    onAuthStateChanged(auth, user => {
      if (user) {
        console.log('firebase-init: auth state -> signed in:', user.uid);
        window.firebaseNames.authUser = { uid: user.uid, anon: user.isAnonymous };
        firebaseEnabled = true;
        window.firebaseNames.enabled = true;
        window.firebaseNames.status = 'connected';
      } else {
        console.log('firebase-init: auth state -> signed out');
        window.firebaseNames.authUser = null;
        // still set enabled true if DB exists — writes may be blocked by rules
        firebaseEnabled = true;
        window.firebaseNames.enabled = true;
        window.firebaseNames.status = anonOk ? 'connected' : 'connected-no-auth';
      }
    });

    // expose search function
    // search for prefix (used by the live suggestion code)
    window.firebaseNames.searchNames = async function (collName, prefix, max = 12) {
      if (!firebaseEnabled || !db) return [];
      if (!prefix) return [];
      try {
        const q = query(collection(db, collName), orderBy('name'), startAt(prefix), endAt(prefix + '\uf8ff'), limit(max));
        const snap = await getDocs(q);
        const list = snap.docs.map(d => (d.data() && d.data().name) ? String(d.data().name) : '').filter(Boolean);
        return list;
      } catch (e) { console.warn('firebase search error', e); return []; }
    };

    // get all names from a collection (for dropdowns)
    window.firebaseNames.getAllNames = async function (collName, max = 500) {
      if (!firebaseEnabled || !db) return [];
      try {
        const q = query(collection(db, collName), orderBy('name'), limit(max));
        const snap = await getDocs(q);
        const list = snap.docs.map(d => (d.data() && d.data().name) ? String(d.data().name) : '').filter(Boolean);
        console.log('Firebase getAllNames for', collName, ':', list);
        return list;
      } catch (e) { console.warn('firebase getAllNames error', e); return []; }
    };

    // add a new name document to a collection
    window.firebaseNames.addName = async function (collName, name) {
      if (!firebaseEnabled || !db) {
        throw new Error('Firebase not initialized');
      }
      if (typeof addDoc !== 'function') {
        throw new Error('addDoc not available');
      }
      try {
        const docRef = await addDoc(collection(db, collName), { name: String(name) });
        return { id: docRef.id };
      } catch (e) { console.warn('firebase add error', e); throw e; }
    };

    // listen for realtime changes in a collection and call back with ordered list of names
    // returns an unsubscribe function
    window.firebaseNames.listenNames = function (collName, onChange, limitTo = 500) {
      if (!firebaseEnabled || !db) return () => { };
      if (typeof onSnapshot !== 'function') {
        console.warn('onSnapshot not available');
        return () => { };
      }
      try {
        const qRef = query(collection(db, collName), orderBy('name'), limit(limitTo));
        const unsub = onSnapshot(qRef, snap => {
          const arr = snap.docs.map(d => (d.data() && d.data().name) ? String(d.data().name) : '').filter(Boolean);
          try { onChange(arr); } catch (e) { console.warn('onChange cb error', e); }
        }, err => { console.warn('listenNames snapshot error', err); });
        return unsub;
      } catch (e) { console.warn('listenNames error', e); return () => { }; }
    };

    // Listen for real-time pattis gallery updates.
    // Calls onChange(docs[]) every time the pattis collection changes.
    // Each doc has: { id, url, created, bill_no, miller, party }
    // Returns an unsubscribe function.
    window.firebaseNames.listenPattis = function (onChange, limitTo = 100) {
      if (!firebaseEnabled || !db) { console.warn('listenPattis: firebase not ready'); return () => { }; }
      if (typeof onSnapshot !== 'function') { console.warn('listenPattis: onSnapshot not available'); return () => { }; }
      try {
        const qRef = query(collection(db, 'pattis'), orderBy('created', 'desc'), limit(limitTo));
        const unsub = onSnapshot(qRef, snap => {
          const docs = snap.docs.map(d => {
            const data = d.data() || {};
            return {
              firestoreId: d.id,
              id: data.id || d.id,
              remoteUrl: data.url || '',
              // thumbDataUrl stored in Firestore works cross-device without Storage CORS
              pngDataUrl: data.thumbDataUrl || '',
              created: data.created || 0,
              bill_no: data.bill_no || '',
              miller: data.miller || '',
              party: data.party || ''
            };
          });
          try { onChange(docs); } catch (e) { console.warn('listenPattis onChange error', e); }
        }, err => { console.warn('listenPattis snapshot error', err); });
        return unsub;
      } catch (e) { console.warn('listenPattis error', e); return () => { }; }
    };

    console.log('Firebase names search enabled');
    return true;
  } catch (err) {
    console.warn('Failed to load Firebase SDK or init:', err);
    window.firebaseNames.enabled = false;
    window.firebaseNames.status = 'init-failed';
    window.firebaseNames.lastError = (err && err.message) ? err.message : String(err);
    return false;
  }
}

// initialize (best-effort)
window.firebaseNames.init = initFirebase;
// try initial auto-init but allow retry from UI
initFirebase().catch(e => { console.warn('initFirebase failed', e); });
