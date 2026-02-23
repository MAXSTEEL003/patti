(function () {
  const PATTIS_KEY = window.PATTIS_KEY || 'pattis_images_v1';
  if (typeof window !== 'undefined' && typeof window.UPLOAD_KEEP_SVG === 'undefined') window.UPLOAD_KEEP_SVG = true;
  function q(sel, root = document) { return root.querySelector(sel); }
  function qAll(sel, root = document) { return Array.from((root || document).querySelectorAll(sel)); }

  function formatDate(ts) { if (!ts) return ''; const d = new Date(Number(ts)); if (isNaN(d)) return ''; return d.toLocaleString(); }

  function loadAll() { try { return JSON.parse(localStorage.getItem(PATTIS_KEY) || '[]'); } catch (e) { console.warn('Invalid pattis store', e); return []; } }
  function saveAll(arr) { localStorage.setItem(PATTIS_KEY, JSON.stringify(arr)); }

  // --------------- Real-time Firestore state ----------------------------
  // Remote items fetched via onSnapshot (not stored in localStorage)
  let _remoteItems = [];
  // IDs already seen so we can flash-highlight only genuinely new arrivals
  let _knownRemoteIds = new Set();
  let _liveConnected = false;

  // Detect mobile/touch device
  const isMobile = () => window.matchMedia('(hover:none) and (pointer:coarse)').matches
    || /android|iphone|ipad|ipod/i.test(navigator.userAgent);

  // Merge: localStorage items + remote items deduplicated by id (local wins for data, remote fills remoteUrl)
  function mergedItems() {
    const local = loadAll();
    const localIds = new Set(local.map(i => i.id));
    const localRemoteUrls = new Set(local.map(i => i.remoteUrl).filter(Boolean));
    // append remote-only items (those not in localStorage) from Firestore
    const remoteOnly = _remoteItems.filter(r =>
      !localIds.has(r.id) && (!r.remoteUrl || !localRemoteUrls.has(r.remoteUrl))
    );
    return [...local, ...remoteOnly].sort((a, b) => (b.created || 0) - (a.created || 0));
  }

  function buildCard(item, isNew = false) {
    const card = document.createElement('div');
    card.className = 'patti-card';
    card.dataset.id = item.id;
    if (isNew) card.style.animation = 'patti-new-flash 1.2s ease';

    // ── Thumbnail wrapper ──────────────────────────────────────
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'patti-thumb-wrap';
    thumbWrap.addEventListener('click', () => openModal(item));

    const img = document.createElement('img');
    img.className = 'patti-thumb';
    img.alt = item.bill_no || item.miller || item.id || 'Patti';
    try { img.crossOrigin = 'anonymous'; } catch (e) { }
    const srcToUse = item.pngDataUrl || item.dataUrl || item.originalDataUrl || item.remoteUrl || '';
    if (srcToUse) img.src = srcToUse;

    img.onerror = async function () {
      try {
        if (item.remoteUrl && !item.pngDataUrl) {
          try { await fetchAndCacheRemote(item); return; } catch (e) { }
        }
        const src = item.pngDataUrl || item.dataUrl || item.originalDataUrl || item.remoteUrl || '';
        if (!src) throw new Error('no src');
        const blob = await toBlobFromDataUrl(src);
        if (!blob) throw new Error('no blob');
        const obj = URL.createObjectURL(blob);
        img.src = obj;
        setTimeout(() => { try { URL.revokeObjectURL(obj); } catch (e) { } }, 30000);
      } catch (err) {
        const ph = document.createElement('div');
        ph.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--gray-400);font-size:12px;flex-direction:column;gap:6px';
        ph.innerHTML = '<span style="font-size:28px">🖼️</span>Preview unavailable';
        try { img.replaceWith(ph); } catch (e) { }
      }
    };

    thumbWrap.appendChild(img);
    card.appendChild(thumbWrap);

    // ── Card body ───────────────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'patti-body';

    // Meta row
    const meta = document.createElement('div');
    meta.className = 'patti-meta';

    const leftMeta = document.createElement('div');
    leftMeta.style.minWidth = '0';
    leftMeta.innerHTML = `
      <div class="patti-name">${escapeHtml(item.miller || item.party || 'Unknown')}</div>
      <div class="patti-bill">${escapeHtml(item.bill_no || '—')}</div>
      ${item.remoteUrl ? '<span class="cloud-badge">☁ Cloud</span>' : ''}
    `;

    const rightMeta = document.createElement('div');
    rightMeta.innerHTML = `<div class="patti-date">${formatDate(item.created)}</div>`;

    meta.appendChild(leftMeta);
    meta.appendChild(rightMeta);
    body.appendChild(meta);

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'patti-actions';

    if (isMobile()) {
      const shareBtn = document.createElement('button');
      shareBtn.className = 'patti-btn patti-btn-primary';
      shareBtn.innerHTML = '📤 Share';
      shareBtn.addEventListener('click', () => shareOrCopyImage(item));
      actions.appendChild(shareBtn);
    } else {
      const dlPng = document.createElement('button');
      dlPng.className = 'patti-btn patti-btn-primary';
      dlPng.innerHTML = '⬇ PNG';
      dlPng.addEventListener('click', () => downloadPng(item));

      const dlPdf = document.createElement('button');
      dlPdf.className = 'patti-btn';
      dlPdf.innerHTML = '📄 PDF';
      dlPdf.addEventListener('click', () => downloadPdf(item));

      actions.appendChild(dlPng);
      actions.appendChild(dlPdf);
    }

    const del = document.createElement('button');
    del.className = 'patti-btn patti-btn-danger';
    del.innerHTML = '🗑';
    del.title = 'Delete';
    del.style.flex = '0 0 36px';
    del.addEventListener('click', () => deleteItem(item.id));
    actions.appendChild(del);

    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  function render(newIds = new Set()) {
    const gallery = q('#gallery');
    const items = mergedItems();
    gallery.innerHTML = '';
    q('#countText').textContent = items.length + ' pattis';
    if (items.length === 0) {
      gallery.innerHTML = '<div style="color:#666;padding:20px">No pattis saved yet. Go back and save one.</div>';
      return;
    }
    items.forEach(item => {
      const isNew = newIds.has(item.id) || newIds.has(item.remoteUrl);
      gallery.appendChild(buildCard(item, isNew));
    });
  }

  function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // Utility: convert data URL to Blob (handles data: and http(s:) sources)
  async function toBlobFromDataUrl(dataUrl) {
    if (!dataUrl) throw new Error('No data');
    try {
      console.debug('toBlobFromDataUrl: fetching', String(dataUrl).slice(0, 120));
      // If it's already a data: URL, decode it
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
        const res = await fetch(dataUrl);
        return await res.blob();
      }
      // Otherwise assume it's a URL we can fetch
      const res = await fetch(dataUrl);
      if (!res.ok) throw new Error('Fetch failed: ' + res.status);
      let blob = await res.blob();
      // If SVG, try to convert to PNG using shared helper (app.js provides ensurePngBlob)
      try {
        const t = String(blob.type || '').toLowerCase();
        if (t.includes('svg')) {
          // prefer global helper
          if (window.ensurePngBlob) {
            try { const png = await window.ensurePngBlob(blob); if (png) { blob = png; return blob; } } catch (e) { console.warn('ensurePngBlob conversion failed', e); }
          }
          // fallback: try to rasterize SVG client-side by reading it and drawing to canvas
          try {
            const png = await convertSvgBlobToPng(blob);
            if (png) { blob = png; return blob; }
          } catch (e) { console.warn('convertSvgBlobToPng failed', e); }
        }
      } catch (e) { /* ignore */ }
      return blob;
    } catch (err) {
      console.error('toBlobFromDataUrl failed', err);
      throw err;
    }
  }

  // Convert Blob to data URL (base64)
  function blobToDataUrl(blob) {
    return new Promise((res, rej) => {
      try {
        const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob);
      } catch (e) { rej(e); }
    });
  }

  // Fetch remote thumbnail (item.remoteUrl), convert to PNG and cache into localStorage.
  // Uses an <img> element to load (avoids CORS restrictions for Firebase Storage URLs).
  async function fetchAndCacheRemote(item) {
    if (!item || !item.remoteUrl) throw new Error('No remoteUrl');
    try {
      // Load via <img> — works without CORS headers since the browser handles it
      const blob = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width || 800;
            canvas.height = img.naturalHeight || img.height || 600;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(b => {
              if (b) resolve(b);
              else reject(new Error('canvas.toBlob returned null'));
            }, 'image/png');
          } catch (e) { reject(e); }
        };
        img.onerror = () => reject(new Error('Image failed to load: ' + item.remoteUrl));
        img.src = item.remoteUrl;
      });

      const dataUrl = await blobToDataUrl(blob);
      // Merge into local store
      const store = loadAll(); let changed = false;
      for (let i = 0; i < store.length; i++) {
        if (store[i].id === item.id) { store[i].pngDataUrl = dataUrl; changed = true; break; }
      }
      if (!changed) { store.unshift(Object.assign({}, item, { pngDataUrl: dataUrl })); changed = true; }
      if (changed) {
        try { localStorage.setItem(PATTIS_KEY, JSON.stringify(store.slice(0, 200))); render(); } catch (e) { console.warn('Failed to save cached thumbnail', e); }
      }
      return true;
    } catch (err) { console.warn('fetchAndCacheRemote failed for', item.remoteUrl, err); throw err; }
  }


  // Fallback rasterizer: read SVG blob, create data URL, draw to canvas, return PNG blob
  async function convertSvgBlobToPng(svgBlob) {
    try {
      let text = await svgBlob.text();
      if (!text || !text.trim()) throw new Error('Empty SVG text');
      let svgText = text.trim();
      // Ensure the root svg has an xmlns so some renderers don't fail
      if (!/\<svg[^>]+xmlns=/.test(svgText)) {
        svgText = svgText.replace(/<svg(\s|>)/i, '<svg xmlns="http://www.w3.org/2000/svg" $1');
      }

      // parse viewBox or width/height
      let w = 0, h = 0;
      try {
        const vbMatch = svgText.match(/viewBox\s*=\s*"([0-9.\-+\s,]+)"/i);
        if (vbMatch && vbMatch[1]) {
          const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
          if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) { w = Math.round(parts[2]); h = Math.round(parts[3]); }
        }
        if (!w || !h) {
          const mw = svgText.match(/width\s*=\s*"([0-9.]+)(px)?"/i);
          const mh = svgText.match(/height\s*=\s*"([0-9.]+)(px)?"/i);
          if (mw && mw[1]) w = Math.round(Number(mw[1]));
          if (mh && mh[1]) h = Math.round(Number(mh[1]));
        }
      } catch (e) { console.warn('SVG size parsing failed', e); }
      if (!w || !h) { w = 1200; h = 800; }

      // Use a base64 data URL to avoid charset encoding issues in some engines
      const svgBase64 = btoa(unescape(encodeURIComponent(svgText)));
      const dataUrl = 'data:image/svg+xml;base64,' + svgBase64;

      const img = new Image(); img.crossOrigin = 'anonymous'; img.width = w; img.height = h; img.src = dataUrl;
      await new Promise((res, rej) => { let done = false; img.onload = () => { if (!done) { done = true; res(); } }; img.onerror = (e) => { if (!done) { done = true; rej(new Error('SVG image load error: ' + (e && e.message))); } }; setTimeout(() => { if (!done) { done = true; res(); } }, 1200); });

      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, w); canvas.height = Math.max(1, h);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      try { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); } catch (e) { console.warn('drawImage failed when rendering SVG', e); }
      const pngBlob = await new Promise((res, rej) => { try { canvas.toBlob(res, 'image/png', 0.92); } catch (e) { rej(e); } });
      if (!pngBlob) throw new Error('Canvas produced no PNG');
      return pngBlob;
    } catch (err) { console.warn('convertSvgBlobToPng error', err); throw err; }
  }

  // Convert any image Blob (PNG/SVG/etc) to a JPEG Blob using an offscreen canvas.
  // This is used before uploading to servers that expect raster images and avoid
  // saving raw SVGs with a .jpg extension which confuses clients.
  async function convertBlobToJpeg(blob, quality = 0.9) {
    try {
      // Fast path: try createImageBitmap for raster blobs
      let bitmap = null;
      try { if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(blob); } catch (e) { bitmap = null; }

      // If bitmap exists and has sensible dims, use it
      if (bitmap && (bitmap.width || bitmap.height)) {
        const w = Math.max(1, bitmap.width || 800);
        const h = Math.max(1, bitmap.height || 600);
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bitmap, 0, 0, w, h);
        const out = await new Promise((res, rej) => { try { canvas.toBlob(res, 'image/jpeg', quality); } catch (e) { rej(e); } });
        if (!out) throw new Error('Canvas produced no JPEG');
        return out;
      }

      // If we reach here, either blob is SVG or bitmap returned zero dims.
      // For SVGs, read text and parse viewBox/width/height to determine canvas size.
      const text = await blob.text().catch(() => null);
      if (text && text.trim().startsWith('<')) {
        // parse dimensions
        let w = 0, h = 0;
        try {
          const vb = text.match(/viewBox\s*=\s*"([0-9.\-+\s,]+)"/i);
          if (vb && vb[1]) {
            const parts = vb[1].trim().split(/[\s,]+/).map(Number);
            if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) { w = Math.round(parts[2]); h = Math.round(parts[3]); }
          }
          if (!w || !h) {
            const mw = text.match(/width\s*=\s*"([0-9.]+)(px)?"/i);
            const mh = text.match(/height\s*=\s*"([0-9.]+)(px)?"/i);
            if (mw && mw[1]) w = Math.round(Number(mw[1]));
            if (mh && mh[1]) h = Math.round(Number(mh[1]));
          }
        } catch (e) { /* best-effort */ }
        if (!w || !h) { w = 1200; h = 800; }

        const svg64 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
        const img = new Image(); img.crossOrigin = 'anonymous'; img.width = w; img.height = h; img.src = svg64;
        await new Promise((res, rej) => { let called = false; img.onload = () => { if (!called) { called = true; res(); } }; img.onerror = () => { if (!called) { called = true; rej(new Error('SVG image load error')); } }; setTimeout(() => { if (!called) { called = true; res(); } }, 800); });

        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, w); canvas.height = Math.max(1, h);
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        try { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); } catch (e) { console.warn('drawImage failed', e); }
        const out = await new Promise((res, rej) => { try { canvas.toBlob(res, 'image/jpeg', quality); } catch (e) { rej(e); } });
        if (!out) throw new Error('Canvas produced no JPEG from SVG');
        return out;
      }

      // Last resort: try to load blob as Image via object URL
      const url = URL.createObjectURL(blob);
      const img2 = new Image(); img2.crossOrigin = 'anonymous'; img2.src = url;
      await new Promise((res, rej) => { let timed = false; img2.onload = () => { if (!timed) res(); }; img2.onerror = (e) => { if (!timed) rej(e); }; setTimeout(() => { timed = true; res(); }, 800); });
      const w2 = Math.max(1, img2.naturalWidth || img2.width || 800); const h2 = Math.max(1, img2.naturalHeight || img2.height || 600);
      const canvas2 = document.createElement('canvas'); canvas2.width = w2; canvas2.height = h2; const ctx2 = canvas2.getContext('2d'); ctx2.fillStyle = '#fff'; ctx2.fillRect(0, 0, w2, h2); try { ctx2.drawImage(img2, 0, 0, w2, h2); } catch (e) { }
      URL.revokeObjectURL(url);
      const out2 = await new Promise((res, rej) => { try { canvas2.toBlob(res, 'image/jpeg', quality); } catch (e) { rej(e); } });
      if (!out2) throw new Error('Canvas produced no JPEG in fallback');
      return out2;
    } catch (err) { console.warn('convertBlobToJpeg failed', err); throw err; }
  }

  async function downloadPng(item) {
    try {
      // allow falling back to remoteUrl when cached png/dataUrl isn't present yet
      const dataUrl = item.pngDataUrl || item.dataUrl || item.originalDataUrl || item.remoteUrl;
      if (!dataUrl) throw new Error('No image data (missing png/dataUrl/remoteUrl)');
      console.debug('downloadPng: item=', item.id, 'using source=', String(dataUrl).slice(0, 120));
      const blob = await toBlobFromDataUrl(dataUrl);
      if (!blob) throw new Error('Failed to obtain blob for download');
      // Prefer PNG extension when possible
      const ext = (blob.type && String(blob.type).toLowerCase().includes('png')) ? 'png' : 'png';
      const filename = (item.bill_no || item.miller || item.id || 'patti') + '.' + ext;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      console.error('downloadPng error', e);
      alert('Failed to download PNG: ' + (e && e.message ? e.message : e) + '\nOpen the browser console for details.');
    }
  }

  async function downloadPdf(item) {
    try {
      const { jsPDF } = window.jspdf || {};
      // allow using remoteUrl as fallback
      const dataUrl = item.pngDataUrl || item.dataUrl || item.originalDataUrl || item.remoteUrl;
      if (!dataUrl) throw new Error('No image data (missing png/dataUrl/remoteUrl)');
      console.debug('downloadPdf: item=', item.id, 'using source=', String(dataUrl).slice(0, 120));
      const imgBlob = await toBlobFromDataUrl(dataUrl);
      let img;
      try { img = await createImageBitmap(imgBlob); } catch (e) {
        // fallback: create Image and draw onto canvas
        try {
          const url = URL.createObjectURL(imgBlob);
          const tmpImg = new Image(); tmpImg.crossOrigin = 'anonymous'; tmpImg.src = url;
          await new Promise((res, rej) => { tmpImg.onload = res; tmpImg.onerror = rej; setTimeout(res, 1500); });
          img = tmpImg;
          try { URL.revokeObjectURL(url); } catch (e) { }
        } catch (err) { throw err; }
      }
      // create pdf sized to image aspect ratio with 72dpi canvas units
      const pdf = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (jsPDF ? jsPDF : null);
      // use  A4 portrait by default
      const pdfDoc = pdf ? new pdf({ unit: 'pt', format: 'a4' }) : null;
      if (!pdfDoc) { // fallback: just trigger PNG download
        return downloadPng(item);
      }
      const pageW = pdfDoc.internal.pageSize.getWidth();
      const pageH = pdfDoc.internal.pageSize.getHeight();
      const imgW = (img.width || img.naturalWidth || img.bitmapWidth || 800); const imgH = (img.height || img.naturalHeight || img.bitmapHeight || 600);
      // fit image into page with margin
      const margin = 24;
      let dw = pageW - margin * 2; let dh = (imgH / imgW) * dw;
      if (dh > pageH - margin * 2) { dh = pageH - margin * 2; dw = (imgW / imgH) * dh; }
      // draw image to canvas to get dataURL as JPEG/PNG supported by jspdf
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0);
      const outDataUrl = canvas.toDataURL('image/png');
      pdfDoc.addImage(outDataUrl, 'PNG', (pageW - dw) / 2, (pageH - dh) / 2, dw, dh);
      const pdfBlob = pdfDoc.output('blob');
      const url = URL.createObjectURL(pdfBlob); const a = document.createElement('a'); a.href = url; a.download = (item.bill_no || 'patti') + '.pdf'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { console.error('downloadPdf error', e); alert('Failed to create PDF: ' + (e && e.message ? e.message : e) + '\nOpen the browser console for details.'); }
  }

  function deleteItem(id) { if (!confirm('Delete this patti?')) return; const arr = loadAll().filter(i => i.id !== id); saveAll(arr); render(); }

  // modal/enlarge
  const modal = q('#modal'); const modalImg = q('#modalImg'); const modalTitle = q('#modalTitle'); const modalDate = q('#modalDate'); const modalInfo = q('#modalInfo');
  let currentModalItem = null;
  function openModal(item) {
    currentModalItem = item;
    modalTitle.textContent = item.miller || item.bill_no || 'Patti';
    modalDate.textContent = item.created ? (' - ' + new Date(item.created).toLocaleString()) : '';
    modalInfo.textContent = (item.remoteUrl ? 'Uploaded' : 'Local') + (item.bill_no ? (' • Bill: ' + item.bill_no) : '');
    // set src last so image loads with crossOrigin set
    try { modalImg.crossOrigin = 'anonymous'; } catch (e) { }
    modalImg.src = item.pngDataUrl || item.dataUrl || item.originalDataUrl || '';
    modal.style.display = 'flex';
  }
  function closeModal() { modal.style.display = 'none'; currentModalItem = null; }

  q('#modalClose')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });


  // Copy image to clipboard (explicit button). Uses Clipboard API if available, otherwise fallback to open blob in new tab.
  async function copyImage(item) {
    try {
      const dataUrl = item.pngDataUrl || item.dataUrl || item.originalDataUrl;
      if (!dataUrl) throw new Error('No image data');
      const blob = await toBlobFromDataUrl(dataUrl);

      // Prefer shared helper from app.js which implements ClipboardItem, execCommand and writeText fallbacks
      if (window.copyBlobToClipboard && typeof window.copyBlobToClipboard === 'function') {
        try {
          const res = await window.copyBlobToClipboard(blob);
          if (res && res.ok) {
            const method = res.method || 'clipboard';
            alert('Image copied to clipboard (' + method + ').');
            return true;
          }
        } catch (e) { console.warn('copyBlobToClipboard failed', e); }
      }

      // Fallback: try direct ClipboardItem (if supported)
      if (navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
          alert('Image copied to clipboard (ClipboardItem).');
          return true;
        } catch (e) { console.warn('ClipboardItem.write failed', e); }
      }

      // Try the execCommand fallback if available (shared helper)
      if (window.tryExecCommandCopy && typeof window.tryExecCommandCopy === 'function') {
        try {
          const ok = await window.tryExecCommandCopy(blob);
          if (ok) { alert('Image copied to clipboard (execCommand).'); return true; }
        } catch (e) { console.warn('tryExecCommandCopy failed', e); }
      }

      // Final fallback: open image in new tab so user can right-click -> copy
      const url = URL.createObjectURL(blob); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 30000);
      return false;
    } catch (err) { console.error('copyImage failed', err); alert('Copy failed: ' + (err && err.message ? err.message : err) + '\nSee console for details.'); return false; }
  }

  // (download/copy buttons removed from modal; copy/download are available on the preview cards)

  // right-click copy: offer context menu copy on image (uses copyImage helper)
  modalImg.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (!currentModalItem) return;
    await copyImage(currentModalItem);
  });

  // back button
  q('#backBtn')?.addEventListener('click', () => { window.location.href = 'index.html'; });
  q('#regenBtn')?.addEventListener('click', async () => {
    if (!confirm('Regenerate PNG previews for all saved pattis? This will update local entries.')) return;
    const items = loadAll();
    if (!items || items.length === 0) return alert('No pattis to regenerate.');
    const total = items.length; let done = 0;
    const origText = q('#countText')?.textContent;
    q('#countText').textContent = `Regenerating 0 / ${total} ...`;
    for (const it of items) {
      try {
        const src = it.pngDataUrl || it.dataUrl || it.originalDataUrl;
        if (!src) continue;
        const blob = await toBlobFromDataUrl(src);
        if (blob) {
          const r = new FileReader();
          const dataUrl = await new Promise((res, rej) => { r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
          it.pngDataUrl = dataUrl;
        }
      } catch (e) { console.warn('regen failed for', it.id, e); }
      done++; q('#countText').textContent = `Regenerating ${done} / ${total} ...`;
      await new Promise(r => setTimeout(r, 120));
    }
    // save back
    try { localStorage.setItem(PATTIS_KEY, JSON.stringify(items)); } catch (e) { console.error('Failed to save regenerated pattis', e); }
    q('#countText').textContent = origText || (items.length + ' pattis saved');
    render();
    alert('Regeneration complete.');
  });
  q('#clearAll')?.addEventListener('click', () => {
    if (!confirm('Delete ALL pattis? This cannot be undone.')) return;
    localStorage.removeItem(PATTIS_KEY);
    // Also clear remote items so gallery truly appears empty
    _remoteItems = [];
    _knownRemoteIds = new Set();
    render();
  });

  // Paste / file input / drag & drop support
  const chooseFileBtn = q('#chooseFileBtn'); const fileInput = q('#fileInput');
  if (chooseFileBtn && fileInput) {
    chooseFileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      await handleIncomingImage(f);
      fileInput.value = '';
    });
  }

  // handle paste events to capture images from clipboard
  window.addEventListener('paste', async (e) => {
    try {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items || []);
      for (const it of items) {
        if (it.kind === 'file' && it.type && it.type.startsWith('image')) {
          const blob = it.getAsFile(); if (blob) { await handleIncomingImage(blob); return; }
        }
        // Some browsers provide URI list or plain text with data URL
        if (it.kind === 'string') {
          it.getAsString(async (s) => {
            try { if (s && s.startsWith('data:image')) { const b = await toBlobFromDataUrl(s); if (b) await handleIncomingImage(b); } } catch (e) { }
          });
        }
      }
    } catch (err) { console.warn('paste handler error', err); }
  });

  // drag & drop on the gallery container
  const galleryEl = q('#gallery');
  if (galleryEl) {
    galleryEl.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; galleryEl.style.outline = '2px dashed var(--primary)'; });
    galleryEl.addEventListener('dragleave', (e) => { galleryEl.style.outline = ''; });
    galleryEl.addEventListener('drop', async (e) => {
      e.preventDefault(); galleryEl.style.outline = '';
      try {
        const files = (e.dataTransfer && e.dataTransfer.files) ? Array.from(e.dataTransfer.files) : [];
        if (files.length > 0) {
          // pick first image-like file
          const img = files.find(f => f.type && f.type.startsWith('image')) || files[0];
          if (img) await handleIncomingImage(img);
        } else {
          // may contain URI list or text
          const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
          if (uri && uri.startsWith('data:image')) { const b = await toBlobFromDataUrl(uri); if (b) await handleIncomingImage(b); }
        }
      } catch (err) { console.warn('drop handler failed', err); }
    });
  }

  // Make the paste area focusable and clickable
  const pasteArea = q('#pasteArea');
  if (pasteArea) {
    pasteArea.addEventListener('click', () => { pasteArea.focus(); pasteArea.textContent = ''; });
    // simple highlight feedback after paste/save
    const highlight = () => { const orig = pasteArea.style.background; pasteArea.style.background = 'rgba(16,185,129,0.06)'; setTimeout(() => pasteArea.style.background = orig, 700); };
    // patch handleIncomingImage to call highlight after successful save
    const _origHandle = handleIncomingImage;
    handleIncomingImage = async function (b) { const r = await _origHandle(b); try { highlight(); } catch (e) { } return r; };
  }

  // helper: process incoming image blob/file and save via saveToPattis from app.js
  async function handleIncomingImage(blobOrFile) {
    try {
      // prefer PNG conversion where possible using shared helper
      let blob = blobOrFile;
      if (window.ensurePngBlob) {
        try { blob = await window.ensurePngBlob(blob); } catch (e) { console.warn('ensurePngBlob failed for pasted file', e); }
      }
      // call saveToPattis if present
      if (typeof window.saveToPattis === 'function') {
        // saveToPattis expects a Blob (or will generate preview itself). Provide the blob.
        const res = await window.saveToPattis(blob);
        // res contains id and maybe remoteUrl
        render();
        alert('Patti saved: ' + (res && res.id ? res.id : 'ok'));
        return;
      }
      // fallback: manually add to localStorage if no saveToPattis available
      try {
        const reader = new FileReader();
        const dataUrl = await new Promise((res, rej) => { reader.onload = () => res(reader.result); reader.onerror = rej; reader.readAsDataURL(blob); });
        const timestamp = Date.now(); const meta = { id: 'patti_' + timestamp, created: timestamp, bill_no: '', miller: '' };
        const store = loadAll(); store.unshift(Object.assign({}, meta, { dataUrl, pngDataUrl: dataUrl, originalDataUrl: dataUrl }));
        saveAll(store.slice(0, 200)); render(); alert('Patti saved locally');
      } catch (e) { console.error('manual save failed', e); alert('Save failed: ' + e.message); }
    } catch (err) { console.error('handleIncomingImage failed', err); alert('Failed to save image: ' + (err && err.message ? err.message : err)); }
  }

  // keyboard Escape to close modal
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // ---- Share / Copy on mobile ----
  async function shareOrCopyImage(item) {
    try {
      const dataUrl = item.pngDataUrl || item.dataUrl || item.originalDataUrl || item.remoteUrl;
      if (!dataUrl) throw new Error('No image data');
      const blob = await toBlobFromDataUrl(dataUrl);
      const file = new File([blob], (item.bill_no || item.miller || 'patti') + '.png', { type: 'image/png' });
      // 1. Native Web Share (Android/iOS Chrome)
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Patti - ' + (item.miller || item.bill_no || '') });
        return;
      }
      // 2. Clipboard API
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        alert('✅ Image copied to clipboard! Paste it anywhere.');
        return;
      }
      // 3. Show full-screen image for long-press save
      const dataUrl2 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1rem';
      overlay.innerHTML = `<p style="color:#fff;font-size:0.85rem;margin-bottom:0.75rem">Long-press the image → Save / Copy</p><img src="${dataUrl2}" style="max-width:100%;max-height:80vh;border-radius:8px" /><br><button style="margin-top:0.75rem;padding:0.5rem 1.2rem;background:#ef4444;color:#fff;border:none;border-radius:8px;font-size:0.85rem;cursor:pointer">Close</button>`;
      overlay.querySelector('button').onclick = () => overlay.remove();
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    } catch (e) {
      if (e.name !== 'AbortError') alert('Share/Copy failed: ' + (e.message || e));
    }
  }

  // initial render
  render();

  // ---- Real-time Firestore listener ----
  // Wait for Firebase to be ready (it initialises asynchronously)
  function attachFirestoreListener() {
    if (!window.firebaseNames || !window.firebaseNames.listenPattis) return; // not available
    if (!window.firebaseNames.enabled) return;

    // Show LIVE badge
    _liveConnected = true;
    const header = q('.header-actions');
    if (header && !q('#liveBadge')) {
      const badge = document.createElement('span');
      badge.id = 'liveBadge';
      badge.innerHTML = '🔴 LIVE';
      badge.style.cssText = 'font-size:0.7rem;font-weight:700;color:#ef4444;letter-spacing:0.05em;padding:2px 8px;border-radius:20px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);animation:pulse-red 2s infinite';
      header.prepend(badge);
    }

    window.firebaseNames.listenPattis(remoteDocs => {
      const newIds = new Set();
      remoteDocs.forEach(doc => {
        if (!_knownRemoteIds.has(doc.id) && _knownRemoteIds.size > 0) {
          // genuinely new arrival since page load
          newIds.add(doc.id);
          if (doc.remoteUrl) newIds.add(doc.remoteUrl);
        }
        _knownRemoteIds.add(doc.id);
      });
      _remoteItems = remoteDocs;
      render(newIds);
    });
  }

  // Try immediately, then poll until Firebase is ready (max 8s)
  let _fbPollCount = 0;
  function tryAttach() {
    if (window.firebaseNames && window.firebaseNames.enabled && window.firebaseNames.listenPattis) {
      attachFirestoreListener();
    } else if (_fbPollCount++ < 16) {
      setTimeout(tryAttach, 500);
    }
  }
  tryAttach();

  // Sync Now button: immediate manual sync
  const syncNowBtn = q('#syncNowBtn');
  if (syncNowBtn) {
    syncNowBtn.addEventListener('click', () => {
      const server = window.THUMBNAIL_SERVER || prompt('Enter thumbnail server URL (e.g. http://localhost:4000)');
      if (!server) return alert('No server provided');
      try { window.startThumbnailPoller(server); alert('Sync started (polling every 15s).'); } catch (e) { console.warn(e); alert('Failed to start sync: ' + e.message); }
    });
  }

  // Upload All button: upload all local pattis to thumbnail server and update localStorage with remoteUrl
  const uploadAllBtn = q('#uploadAllBtn'); const uploadStatus = q('#uploadStatus');
  if (uploadAllBtn) {
    uploadAllBtn.addEventListener('click', async () => {
      try {
        const server = window.THUMBNAIL_SERVER || prompt('Enter thumbnail server URL to upload to (e.g. http://localhost:4000)');
        if (!server) return alert('No server provided');
        uploadAllBtn.disabled = true; uploadAllBtn.textContent = 'Uploading...'; if (uploadStatus) uploadStatus.textContent = '';
        const items = loadAll(); let uploaded = 0;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.remoteUrl) continue; // skip already uploaded
          try {
            // choose source data
            const src = it.pngDataUrl || it.dataUrl || it.originalDataUrl;
            if (!src) { console.warn('No source for', it.id); continue; }
            // get blob (convert SVG if needed)
            let blob = await toBlobFromDataUrl(src).catch(e => { throw e; });
            // If the blob is an SVG, either keep it as SVG (if configured) or
            // rasterize -> JPEG before upload to avoid mismatched server filenames.
            try {
              const t = String(blob.type || '').toLowerCase();
              if (t.includes('svg')) {
                if (window.UPLOAD_KEEP_SVG) {
                  // upload as-is (SVG) — filename will be inferred by upload helper
                } else {
                  // convert SVG -> PNG then PNG -> JPEG
                  try { blob = await convertSvgBlobToPng(blob); } catch (e) { console.warn('SVG->PNG conversion failed', e); }
                  try { blob = await convertBlobToJpeg(blob, 0.9); } catch (e) { console.warn('PNG->JPEG conversion failed', e); }
                }
              }
            } catch (e) { /* ignore */ }
            // try to make a thumbnail to reduce size if helper available
            if (window.makeThumbnailBlob) { try { blob = await window.makeThumbnailBlob(blob, 800, 'image/jpeg', 0.8); } catch (e) { /* ignore */ } }
            const form = new FormData(); form.append('file', blob, (it.bill_no || it.miller || it.id || 'patti') + '.jpg');
            const res = await fetch(String(server).replace(/\/$/, '') + '/upload', { method: 'POST', body: form });
            const json = await res.json().catch(() => null);
            if (res.ok && json && json.url) {
              // update localStorage record
              const all = loadAll(); const idx = all.findIndex(x => x.id === it.id);
              if (idx >= 0) { all[idx].remoteUrl = json.url; all[idx].remoteUploadedAt = Date.now(); saveAll(all); }
              uploaded++; if (uploadStatus) uploadStatus.textContent = `Uploaded ${uploaded} / ${items.length}`;
            } else { console.warn('Upload failed for', it.id, res.status, json); }
          } catch (err) { console.warn('Upload error for', it.id, err); }
          await new Promise(r => setTimeout(r, 350));
        }
        alert('Upload complete: ' + uploaded + ' items uploaded.');
        render();
      } catch (e) { console.error('Upload all failed', e); alert('Upload all failed: ' + e.message); }
      uploadAllBtn.disabled = false; uploadAllBtn.textContent = 'Upload all'; if (uploadStatus) uploadStatus.textContent = '';
    });
  }

  // Open Remote Gallery button: opens the server root in a new tab
  const openRemoteBtn = q('#openRemoteBtn');
  if (openRemoteBtn) {
    openRemoteBtn.addEventListener('click', () => {
      const base = window.THUMBNAIL_SERVER || prompt('Enter thumbnail server URL (e.g. http://localhost:4000)');
      if (!base) return;
      const url = String(base).replace(/\/$/, '') + '/';
      try { window.open(url, '_blank'); } catch (e) { window.location.href = url; }
    });
  }

  // Fetch Remote button: fetch /list and merge remote thumbnails into local store
  const refreshRemoteBtn = q('#refreshRemoteBtn');
  if (refreshRemoteBtn) {
    refreshRemoteBtn.addEventListener('click', async () => {
      try {
        const base = window.THUMBNAIL_SERVER || prompt('Enter thumbnail server URL (e.g. http://localhost:4000)');
        if (!base) return alert('No server provided');
        const url = String(base).replace(/\/$/, '') + '/list';
        refreshRemoteBtn.disabled = true; refreshRemoteBtn.textContent = 'Fetching...';
        const res = await fetch(url);
        if (!res.ok) throw new Error('Fetch failed: ' + res.status);
        const list = await res.json();
        if (!Array.isArray(list)) throw new Error('Invalid list response');
        // merge into local store (dedupe by remote URL)
        const store = loadAll(); const remoteSet = new Set(store.map(i => i.remoteUrl).filter(Boolean));
        let added = 0; const addedEntries = [];
        for (const it of list) {
          if (!it || !it.url) continue;
          if (remoteSet.has(it.url)) continue;
          const id = 'patti_' + (it.filename || '').replace(/\.[^.]+$/, '') || ('remote_' + Date.now());
          const entry = { id, created: it.created || Date.now(), bill_no: '', miller: '', remoteUrl: it.url, dataUrl: null, pngDataUrl: null, party: '' };
          store.unshift(entry); remoteSet.add(it.url); added++; addedEntries.push(entry);
        }
        if (added > 0) {
          saveAll(store.slice(0, 200)); render();
          try {
            // Fetch and cache remote thumbnails in background so previews appear
            (async () => {
              const results = await Promise.allSettled(addedEntries.map(e => fetchAndCacheRemote(e)));
              const ok = results.filter(r => r.status === 'fulfilled').length;
              console.info('Cached remote thumbnails:', ok, 'of', results.length);
              if (ok > 0) render();
            })();
          } catch (e) { console.warn('Background caching failed', e); }
          alert('Added ' + added + ' remote thumbnails — caching previews in background');
        } else alert('No new remote thumbnails found');
      } catch (e) { console.error('Fetch remote failed', e); alert('Fetch remote failed: ' + (e && e.message ? e.message : e)); }
      refreshRemoteBtn.disabled = false; refreshRemoteBtn.textContent = 'Fetch Remote';
    });
  }

  // Poll thumbnail server for new uploads and merge into local store (lightweight realtime)
  // Expose a start function so the poller can be started immediately when window.THUMBNAIL_SERVER is set
  let _patti_thumb_poll_handle = null;
  function startThumbnailPoller(serverBase, intervalMs = 15000) {
    if (!serverBase) return null;
    if (_patti_thumb_poll_handle) return _patti_thumb_poll_handle; // already running
    let timer = null;
    const base = String(serverBase).replace(/\/$/, '');
    async function pollOnce() {
      // show spinner if available
      try { const sp = document.getElementById('syncSpinner'); if (sp) sp.style.display = 'inline-block'; } catch (e) { }
      try {
        const res = await fetch(base + '/list');
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && list.length) {
            const existing = loadAll(); const ids = new Set(existing.map(i => i.id)); const remoteSet = new Set(existing.map(i => i.remoteUrl).filter(Boolean));
            let added = 0;
            for (const it of list) {
              const id = 'patti_' + (it.filename || '').replace(/\.[^.]+$/, '');
              // skip if we already have this id OR if the remote URL is already present (dedupe by remoteUrl)
              if (ids.has(id) || (it.url && remoteSet.has(it.url))) continue;
              const entry = { id, created: it.created || Date.now(), bill_no: '', miller: '', remoteUrl: it.url, dataUrl: null, pngDataUrl: null, party: '' };
              existing.unshift(entry); ids.add(id); if (it.url) remoteSet.add(it.url); added++;
            }
            if (added > 0) { try { localStorage.setItem(PATTIS_KEY, JSON.stringify(existing.slice(0, 200))); render(); } catch (e) { console.warn('Failed to merge thumbnails', e); } }
          }
        }
      } catch (e) { console.warn('Thumbnail poller failed', e); }
      // hide spinner
      try { const sp = document.getElementById('syncSpinner'); if (sp) sp.style.display = 'none'; } catch (e) { }
      // After each poll, attempt to fetch remote thumbnails and cache them locally (non-blocking)
      try {
        const items = loadAll();
        for (const it of items) {
          if (it.remoteUrl && !it.pngDataUrl) {
            // fire-and-forget
            fetchAndCacheRemote(it).catch(e => { /* ignore individual failures */ });
          }
        }
      } catch (e) { /* ignore caching errors */ }
      // schedule next poll
      timer = setTimeout(pollOnce, intervalMs);
    }
    // start immediately
    pollOnce();
    _patti_thumb_poll_handle = {
      stop: () => { try { clearTimeout(timer); } catch (e) { } _patti_thumb_poll_handle = null; }
    };
    return _patti_thumb_poll_handle;
  }

  // Expose start function globally
  if (typeof window !== 'undefined') window.startThumbnailPoller = startThumbnailPoller;

  // If THUMBNAIL_SERVER is assigned now or later, start the poller immediately.
  if (typeof window !== 'undefined') {
    // preserve any existing value
    let _ts = window.THUMBNAIL_SERVER;
    try {
      Object.defineProperty(window, 'THUMBNAIL_SERVER', {
        configurable: true,
        enumerable: true,
        get() { return _ts; },
        set(v) { _ts = v; if (v) startThumbnailPoller(v); }
      });
    } catch (e) { /* if defineProperty fails, fallback to starting if value present */ }
    if (_ts) startThumbnailPoller(_ts);
  }
})();