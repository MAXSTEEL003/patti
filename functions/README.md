This folder contains a Firebase Cloud Function to rasterize an SVG into a PNG and upload it to Firebase Storage.

Setup & deploy:

1. Install Firebase CLI and login:
   npm install -g firebase-tools
   firebase login

2. From this functions folder, install dependencies:
   npm install

3. Deploy the function (from the project root where firebase.json lives):
   firebase deploy --only functions:api

4. After deploy, note the function URL and set it in your client app as:
   window.SVG_TO_PNG_FN_URL = 'https://us-central1-<PROJECT>.cloudfunctions.net/api/rasterize'

Notes:
- This function uses sharp to rasterize SVGs. Sharp is included as a dependency in package.json.
- The function uploads the PNG to your project's default storage bucket and attempts to make it public. You may need to adjust bucket ACLs or security rules.
- Consider adding authentication to the endpoint if you don't want it public.
