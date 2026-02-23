// Minimal rasterizer using Puppeteer
// Usage: node rasterizer-server.js
// POST /rasterize with JSON { type: 'svg'|'html', data: '<svg...>' or '<html>..', width?, height? }

const express = require('express');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');
const app = express();
let cors;
try { cors = require('cors'); } catch (e) { console.warn('Optional dependency "cors" not installed — continuing without it.'); }
if (cors) app.use(cors());
app.use(bodyParser.json({ limit: '30mb' }));

// Simple permissive CORS middleware so browser tests can call /rasterize
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Optional API key protection. Set RASTER_API_KEY in env to require a key.
const API_KEY = process.env.RASTER_API_KEY || null;
if(API_KEY){
  console.log('Rasterizer API key enabled');
}

// Keep a single browser instance for better performance and stability.
let _browser = null;
const MAX_DIM = 4000; // safety cap

async function ensureBrowser() {
  if (_browser) return _browser;
  _browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  console.log('Launched Puppeteer browser');
  return _browser;
}

app.post('/rasterize', async (req, res) => {
  // verify API key when configured
  if (API_KEY) {
    const incoming = req.get('x-api-key') || req.headers['x-api-key'];
    if (!incoming || incoming !== API_KEY) {
      return res.status(401).json({ error: 'Unauthorized: invalid API key' });
    }
  }

  const body = req.body || {};
  let { type, data, width = 1200, height = 800 } = body;
  if (!type || !data) return res.status(400).json({ error: 'type and data required' });

  // coerce numeric and enforce caps
  width = Number(width) || 1200;
  height = Number(height) || 800;
  if (width <= 0 || height <= 0) return res.status(400).json({ error: 'width and height must be positive numbers' });
  width = Math.min(width, MAX_DIM);
  height = Math.min(height, MAX_DIM);

  // Basic logging for diagnostics
  console.log(`[rasterize] type=${type} width=${width} height=${height} payloadBytes=${Buffer.byteLength(JSON.stringify(body))}`);

  let browser;
  let page;
  try {
    browser = await ensureBrowser();
    page = await browser.newPage();
    await page.setViewport({ width, height });

    if (type === 'svg') {
      // Wrap SVG in a minimal HTML. Ensure svg is displayed full-size.
      const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#fff;">
        <div id="__rroot" style="display:inline-block;line-height:0">${data}</div>
        </body></html>`;

      await page.setContent(html, { waitUntil: 'networkidle0' });

      // Try to locate an SVG element; if found, screenshot that element, otherwise screenshot body
      const svgHandle = await page.$('svg');
      let buf;
      if (svgHandle) {
        // give the browser a moment to render
        await page.evaluate(() => new Promise(r => setTimeout(r, 20)));
        buf = await svgHandle.screenshot({ type: 'png' });
      } else {
        const bodyHandle = await page.$('body');
        buf = await bodyHandle.screenshot({ type: 'png' });
      }

      res.set('Content-Type', 'image/png');
      return res.send(buf);

    } else if (type === 'html') {
      await page.setContent(data, { waitUntil: 'networkidle0' });
      const bodyHandle = await page.$('body');
      const buf = await bodyHandle.screenshot({ type: 'png' });
      res.set('Content-Type', 'image/png');
      return res.send(buf);
    } else {
      return res.status(400).json({ error: 'invalid type' });
    }

  } catch (err) {
    console.error('rasterize error', err && err.stack ? err.stack : err);
    // If browser becomes unusable, drop reference so a new one can be launched later.
    try { if (_browser && browser === _browser) { await _browser.close(); } } catch (e) {}
    _browser = null;
    return res.status(500).json({ error: String(err) });
  } finally {
    try { if (page) await page.close(); } catch (e) {}
  }
});

// Informational GET endpoints to make it easier to verify the server from a browser
app.get('/', (req, res) => {
  res.type('html').send('<h1>Rasterizer server</h1><p>POST /rasterize with JSON {type, data, width?, height?}</p>');
});

app.get('/rasterize', (req, res) => {
  res.status(405).type('html').send('<h1>Method Not Allowed</h1><p>The /rasterize endpoint accepts POST requests only. Send a POST with JSON body: { type: \"svg\"|\"html\", data: \"...\" }.</p>');
});

const port = process.env.PORT || 3000;
const server = app.listen(port, ()=>console.log('Rasterizer listening on', port));

async function shutdown(signal) {
  console.log('Shutting down rasterizer (signal=' + signal + ')');
  try {
    if (_browser) {
      await _browser.close();
      console.log('Closed Puppeteer browser');
    }
  } catch (e) {
    console.error('Error closing browser during shutdown', e);
  }
  try { server.close(); } catch (e) {}
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => { console.error('Uncaught exception', err && err.stack ? err.stack : err); shutdown('uncaughtException'); });
