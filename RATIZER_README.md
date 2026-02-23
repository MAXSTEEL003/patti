Server rasterizer (Puppeteer)

This repository includes a minimal Puppeteer-based rasterizer you can run locally to convert SVG/HTML to PNG when client-side canvas rasterization is blocked by cross-origin resources.

Files:
- rasterizer-server.js : minimal Express + Puppeteer server

Install and run locally:

1. Install dependencies (requires Node.js and npm):

```bash
cd "C:/Users/TEJAS M/Desktop/patti calculator"
npm init -y
npm install express body-parser puppeteer
```

2. Run the rasterizer server:

```bash
# Optionally set an API key to protect the endpoint
export RASTER_API_KEY=your_secret_key
node rasterizer-server.js
```

3. Configure your app to use the rasterizer by adding to `src/index.html` (before `firebase-init.js`/`app.js`):

```html
<script>
	// endpoint for rasterizer
	window.SVG_TO_PNG_FN_URL = 'http://localhost:3000/rasterize';
	// optional: set the API key to send with requests
	window.RASTER_API_KEY = 'your_secret_key';
</script>
```

4. Now, when client-side PNG export fails due to CORS/taint, the app will POST the SVG to the rasterizer and download the returned PNG.

Security & production notes:
- Protect the endpoint (API key or auth) before exposing publicly.
- Use rate limits and validation to prevent abuse.
- Deploy to Cloud Run / App Engine / DigitalOcean App Platform for easy hosting.
 
Client headers:
- The client integration will send the API key as the `X-API-KEY` header.

Example (set in `src/index.html`):

```html
<script>window.RASTER_API_KEY = 'your_secret_key';</script>
```

