const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if(!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// On startup, scan existing uploads and rename files that appear to be SVG/XML
// but were saved with the wrong extension (for example, saved as .jpg). This
// ensures express.static will serve them with the correct Content-Type.
try{
  const existing = fs.readdirSync(UPLOAD_DIR).filter(f => !f.startsWith('.'));
  const renamed = [];
  existing.forEach(fn => {
    try{
      const p = path.join(UPLOAD_DIR, fn);
      // read the first few bytes as utf8 to detect XML/SVG signature
      const header = fs.readFileSync(p, { encoding: 'utf8', flag: 'r' }).slice(0, 128).trim();
      const isXml = header.startsWith('<') || header.startsWith('<?xml');
      const ext = path.extname(fn).toLowerCase();
      if(isXml && ext !== '.svg'){
        const base = fn.replace(/\.[^.]+$/, '');
        const newName = base + '.svg';
        fs.renameSync(p, path.join(UPLOAD_DIR, newName));
        renamed.push({ from: fn, to: newName });
      }
    }catch(e){ /* ignore per-file errors */ }
  });
  if(renamed.length) console.log('Renamed existing SVG-like uploads:', renamed);
}catch(e){ console.warn('Startup scan for SVGs failed:', e && e.message); }

const app = express();
app.use(cors());
app.use(express.json());

// Serve uploaded images statically
app.use('/images', express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // infer extension from the uploaded file's mimetype when possible
    const mime = (file && file.mimetype) ? file.mimetype.toLowerCase() : '';
    const mimeExt = (mime.includes('svg')) ? '.svg' : (mime.includes('png') ? '.png' : (mime.includes('jpeg') || mime.includes('jpg') ? '.jpg' : ''));
    const extFromName = path.extname(file.originalname) || '';
    const ext = mimeExt || extFromName || '.jpg';
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 1 * 1024 * 1024 } }); // limit 1MB thumbnails by default

// Upload endpoint: accepts 'file' and optional metadata fields
app.post('/upload', upload.single('file'), (req, res) => {
  try{
    if(!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `${req.protocol}://${req.get('host')}/images/${req.file.filename}`;
    const meta = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype,
      url
    };
    console.log('Upload received:', meta);
    // If any additional fields were provided, log them for debugging
    if(req.body && Object.keys(req.body).length) console.log('Upload body fields:', req.body);
    res.json(meta);
  }catch(e){ console.error('Upload handler error', e); res.status(500).json({ error: 'Upload failed' }); }
});

// Error handler to catch multer/file-size errors and show readable messages
app.use((err, req, res, next) => {
  if(err && err.code && err.code === 'LIMIT_FILE_SIZE'){
    console.warn('Upload rejected: file too large');
    return res.status(413).json({ error: 'File too large' });
  }
  // fallback
  if(err){ console.error('Server error', err); return res.status(500).json({ error: 'Server error' }); }
  next();
});

// List uploaded thumbnails (basic)
app.get('/list', (req, res) => {
  const files = fs.readdirSync(UPLOAD_DIR).filter(f => !f.startsWith('.'));
  const out = files.map(f => {
    const st = fs.statSync(path.join(UPLOAD_DIR, f));
    return { filename: f, url: `${req.protocol}://${req.get('host')}/images/${f}`, size: st.size, created: st.birthtimeMs };
  }).sort((a,b)=> b.created - a.created);
  res.json(out);
});

// Simple root page: small HTML gallery so visiting / displays thumbnails
app.get('/', (req, res) => {
  try{
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => !f.startsWith('.'));
    const items = files.map(f => ({ filename: f, url: `${req.protocol}://${req.get('host')}/images/${f}` }));
    const cardsHtml = items.map(it => `
      <div class="card">
        <a href="${it.url}" target="_blank"><img src="${it.url}" alt="${it.filename}"></a>
        <div style="font-size:12px;margin-top:6px">${it.filename}</div>
        <button class="del" data-fn="${it.filename}">Delete</button>
      </div>
    `).join('');

    const html = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Patti Thumbnails</title>
          <style>
            body{font-family:system-ui,Segoe UI,Roboto,Arial;background:#f9fafb;padding:20px}
            .grid{display:flex;flex-wrap:wrap;gap:12px}
            .card{background:#fff;border:1px solid #e5e7eb;padding:8px;border-radius:8px;width:220px;text-align:center}
            img{max-width:100%;height:auto;border-radius:4px}
            .del{margin-top:8px;background:#fee2e2;border:1px solid #fecaca;padding:6px;border-radius:4px;color:#b91c1c;cursor:pointer}
          </style>
        </head>
        <body>
          <h2>Patti Thumbnails</h2>
          <div class="grid">
            ${cardsHtml}
          </div>
          <hr>
          <div style="margin-top:12px;font-size:13px;color:#666">JSON list available at <code>/list</code>. Images served from <code>/images/&lt;filename&gt;</code></div>
          <script>
            document.querySelectorAll('.del').forEach(b => b.addEventListener('click', async () => {
              if(!confirm('Delete this file?')) return;
              const fn = b.dataset.fn;
              try{
                const res = await fetch(location.origin + '/images/' + fn, { method: 'DELETE' });
                const json = await res.json().catch(()=>null);
                if(res.ok){ b.closest('.card').remove(); } else alert('Delete failed: ' + (json && json.error ? json.error : res.status));
              }catch(e){ alert('Delete failed: ' + e.message); }
            }));
          </script>
        </body>
      </html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }catch(e){ res.status(500).send('Failed to render index'); }
});

// Delete endpoint
app.delete('/images/:filename', (req, res) => {
  const fn = req.params.filename;
  const p = path.join(UPLOAD_DIR, fn);
  if(!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
  try{ fs.unlinkSync(p); return res.json({ ok: true }); }catch(e){ return res.status(500).json({ error: 'Delete failed' }); }
});

const port = process.env.PORT || 4000;
app.listen(port, ()=> console.log('Patti thumbnail server listening on', port));
