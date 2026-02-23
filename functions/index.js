const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const bodyParser = require('body-parser');
const sharp = require('sharp');
const cors = require('cors');

// Initialize Firebase Admin SDK
try {
  admin.initializeApp();
} catch (e) {
  // Already initialized in some environments
}

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
// Allow CORS for all origins (adjust in production to restrict origins)
app.use(cors({ origin: true }));

const archiver = require('archiver');

// POST /rasterize
// Expects JSON: { id, svgBase64, fileName, contentType }
// Returns: { url }
app.post('/rasterize', async (req, res) => {
  try {
    const { id, svgBase64, fileName = `${id}.png`, contentType = 'image/png' } = req.body;
    if (!svgBase64) return res.status(400).json({ error: 'missing svgBase64' });

    // Decode base64
    const svgBuffer = Buffer.from(svgBase64, 'base64');

    // Rasterize to PNG with sharp
    const pngBuffer = await sharp(svgBuffer)
      .png()
      .toBuffer();

    // Upload to Firebase Storage
    const bucket = admin.storage().bucket();
    const destPath = `pattis/${fileName}`;
    const file = bucket.file(destPath);
    await file.save(pngBuffer, { contentType: 'image/png', public: true });

    // Compose public URL (note: depending on your bucket settings, this may not be publicly readable)
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${destPath}`;

    return res.json({ url: publicUrl });
  } catch (err) {
    console.error('rasterize error', err);
    return res.status(500).json({ error: String(err) });
  }
});

exports.api = functions.https.onRequest(app);

// List endpoint: returns signed URLs for files under pattis/
app.get('/list', async (req, res) => {
  try {
    const bucket = admin.storage().bucket();
    // list files in pattis/ prefix
    const [files] = await bucket.getFiles({ prefix: 'pattis/' });
    const entries = await Promise.all(files.map(async file => {
      try{
        const [meta] = await file.getMetadata();
        const options = { action: 'read', expires: Date.now() + 1000 * 60 * 60 * 24 }; // 24 hours
        const [signedUrl] = await file.getSignedUrl(options);
        return { name: file.name, url: signedUrl, size: meta.size, updated: meta.updated };
      }catch(e){
        console.warn('file list item error', file.name, e);
        return null;
      }
    }));
    res.json({ ok: true, files: entries.filter(Boolean) });
  } catch (err) {
    console.error('list error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// POST /zip
// Accepts JSON { dateKey: 'YYYY-MM-DD' } or { files: ['pattis/id.png', ...] }
// Streams a ZIP file of the requested files.
app.post('/zip', async (req, res) => {
  try {
    const { dateKey, files } = req.body || {};
    const bucket = admin.storage().bucket();
    let targetFiles = [];
    if(Array.isArray(files) && files.length) targetFiles = files.map(f=>String(f));
    else if(dateKey){
      // list files under pattis/ and filter by dateKey in filename or metadata
      const [all] = await bucket.getFiles({ prefix: 'pattis/' });
      for(const file of all){
        // try to match by metadata updated or filename containing dateKey
        if(file.name.includes(dateKey) || file.name.includes(dateKey.replace(/-/g,''))){ targetFiles.push(file.name); }
        else {
          const [meta] = await file.getMetadata().catch(()=>[{}]);
          if(meta && meta.updated && meta.updated.startsWith(dateKey)) targetFiles.push(file.name);
        }
      }
    }else{
      return res.status(400).json({ error: 'Provide dateKey or files' });
    }

    if(!targetFiles.length) return res.status(404).json({ error: 'No files found' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="pattis_${dateKey || 'files'}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => { console.error('archive err', err); res.status(500).end(); });
    archive.on('end', ()=>{ console.log('archive finalize finished'); });

    // pipe archive to response
    archive.pipe(res);

    // append each file stream
    for(const name of targetFiles){
      try{
        const remoteFile = bucket.file(name);
        const stream = remoteFile.createReadStream();
        // use the basename for the entry name
        const entryName = name.split('/').pop();
        archive.append(stream, { name: entryName });
      }catch(e){ console.warn('zip append failed for', name, e); }
    }

    archive.finalize();
  } catch (err) {
    console.error('zip error', err);
    res.status(500).json({ error: String(err) });
  }
});
