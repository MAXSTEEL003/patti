Firebase Storage setup for Patti Calculator

This guide helps you configure Firebase so the app can upload images to Storage and optionally record metadata in Firestore.

Prerequisites
- You have a Firebase project. If not, create one at https://console.firebase.google.com
- The `window.FIREBASE_CONFIG` object in `src/index.html` must match your project's credentials (apiKey, projectId, storageBucket, etc.).

Steps

1) Enable Firebase Storage
- Open the Firebase Console > Storage > Get Started.
- Choose a location and click Create Bucket.

2) Enable Firestore (optional but useful)
- Console > Firestore Database > Create database.
- Choose test mode for initial development (see security note below).

3) Enable Authentication (Anonymous) — recommended for client uploads
- Console > Authentication > Get started.
- Under Sign-in method, enable "Anonymous".
- This lets the client sign in anonymously so storage rules can allow authenticated writes.

4) Temporary dev security rules (NOT for production)
- Storage > Rules: for quick testing you can use:

  rules_version = '2';
  service firebase.storage {
    match /b/{bucket}/o {
      match /pattis/{allPaths=**} {
        allow read, write: if true; // open access — only for testing
      }
    }
  }

  Firestore (test mode) will allow open access for development; change rules before going public.

5) Recommended secure rules (example)
- Allow uploads only for authenticated (including anonymous) users and restrict file size:

  rules_version = '2';
  service firebase.storage {
    match /b/{bucket}/o {
      match /pattis/{fileId} {
        allow read: if true;
        allow write: if request.auth != null && request.resource.size < 10 * 1024 * 1024; // max 10MB
      }
    }
  }

6) CORS is not required for uploads using Firebase JS SDK (client uses the SDK). However, if you later serve images from a different domain or transform them, ensure proper CORS headers.

7) Update `window.FIREBASE_CONFIG` in `src/index.html` with the project config from Project settings -> General.

8) Test upload flow
- Open `src/index.html` in a browser.
- Create a sample note and click "Save to Pattis". The app saves locally and attempts background upload to Storage. Check the console for upload logs.
- Open Firebase Console > Storage and verify `pattis/{id}.png` (or .svg) exists.
- Check Firestore `pattis` collection (if enabled) for metadata docs.

Notes
- If uploads fail, check browser console for errors. Common issues:
  - Authentication denied by security rules.
  - Quota or billing limits on the Firebase project (enable billing for larger usage).
  - Network blocked by CSP or offline browser environment.
- For production, tighten security rules. Consider requiring authenticated users and adding validation on metadata.

Server-side rasterization (optional)
- If client-side rasterization is blocked by CORS and you need a guaranteed PNG, you can implement a Cloud Function (Node) that accepts an SVG body (or a data URL) and uses a headless renderer (Puppeteer) or an image library (sharp, librsvg) to render a PNG, then upload to Storage and return the permanent URL. I can scaffold that if you want.

Contact me with which approach you'd like (client-only with anonymous auth, or server-side rasterization for guaranteed PNG uploads).