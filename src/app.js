// Live calculation and render to preview
function q(selector, root = document) { return root.querySelector(selector); }
function qAll(selector, root = document) { return Array.from(root.querySelectorAll(selector)); }

function formatNumber(n, compact = false) {
  if (n === '' || n === null || typeof n === 'undefined') return '';
  const num = Number(n) || 0;
  if (compact) {
    try {
      return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 2 }).format(num);
    } catch (e) {
      return num.toLocaleString('en-IN');
    }

    // Generate image blob with html2canvas preferred, fallback to domtoBlob.
    // Provides clearer errors for cross-origin taint problems.
    async function generateImageBlob(node, preferCanvas = true) {
      // Prefer a vector/foreignObject approach (dom->SVG->raster) because it preserves crisp text
      // and layout. Use a higher scale multiplier to produce a sharp PNG for clipboard/export.
      const dpr = (window.devicePixelRatio || 1);
      const preferredScale = Math.max(1, dpr * 2);

      try {
        // try dom->SVG->PNG first (higher fidelity for text and CSS)
        const domBlob = await domtoBlob(node, preferredScale);
        if (domBlob) {
          // If domtoBlob returned an SVG blob (type image/svg+xml), try to convert to PNG
          let __patti_inline_result = null;
          function __restore_inlined(replaced) {
            try {
              if (!replaced || !Array.isArray(replaced)) return;
              replaced.forEach(r => { if (r.prop === 'src') r.el.src = r.original; else if (r.prop === 'backgroundImage') r.el.style.backgroundImage = r.original; });
            } catch (e) { console.warn('Failed to restore inlined assets', e); }
          }

          try {
            // Run a quick diagnostic: if cross-origin assets detected, prompt user to provide replacements
            try {
              const taints = await scanForTaintingAssets();
              if (taints && taints.length > 0) {
                const proceed = await showAssetReplacementModal(taints);
                if (!proceed) { console.log('User cancelled export from replacement modal'); return; }
              }
            } catch (diagErr) { console.warn('Diagnostic step failed before export', diagErr); }
            if (domBlob.type && String(domBlob.type).toLowerCase().includes('svg')) {
              // attempt to rasterize client-side to PNG for clipboard compatibility
              const png = await ensurePngBlob(domBlob);
              if (png) return png;
            } else {
              // already a raster (PNG) blob
              return domBlob;
            }
          } catch (e) {
            console.warn('Conversion of domtoBlob SVG to PNG failed, will try html2canvas fallback:', e);
            // fall through to html2canvas
          }
        }
      } catch (e) {
        console.warn('domtoBlob failed, trying html2canvas as fallback:', e);
        // continue to try html2canvas below
      }

      // try html2canvas with a higher scale multiplier for sharper output
      if (preferCanvas && window.html2canvas) {
        try {
          const canvas = await html2canvas(node, { backgroundColor: '#fff', scale: preferredScale, useCORS: true, allowTaint: false });
          const blob = await new Promise((res, rej) => canvas.toBlob(res, 'image/png'));
          if (!blob) throw new Error('html2canvas returned no blob');
          return blob;
        } catch (e) {
          console.warn('html2canvas failed as last resort:', e);
          const msg = (e && e.message) ? e.message.toLowerCase() : '';
          if (msg.includes('taint') || msg.includes('security') || msg.includes('cross-origin')) throw e;
        }
      }

      // final fallback to domtoBlob at device DPR (may return SVG if rasterization blocked)
      const fallback = await domtoBlob(node, Math.max(1, dpr));
      if (!fallback) throw new Error('domtoBlob failed to produce blob');
      return fallback;
    }
  }
  return num.toLocaleString('en-IN');
}

// Quick safety flag: when true, use a minimal, well-known flow for Copy/Open
// that simply opens the generated image as a data: URL in a new tab so the
// user can right-click -> Copy image. This is a non-invasive rollback helper
// to restore the behaviour the user expects while we iterate on the rest.
if (typeof window !== 'undefined' && typeof window.PATTI_SAFE_MODE === 'undefined') window.PATTI_SAFE_MODE = false;

// parse user-entered values robustly: strip commas and non-numeric characters
function parseInput(v) {
  if (v === '' || v === null || typeof v === 'undefined') return 0;
  // allow digits, minus and dot
  const cleaned = String(v).replace(/[^0-9.\-]/g, '');
  const num = Number(cleaned);
  return isNaN(num) ? 0 : num;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Format a date string (ISO or other) into DD/MM/YYYY for consistent display
function formatDate(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function recalcAll() {
  // compute each item amount and totals
  const rows = qAll('#itemsTable .itemRow');
  const outItems = q('#out_items');
  if (outItems) outItems.innerHTML = '';
  // Calculate amount once using global QTY and RATE
  const gQty = parseInput(q('#rate_qty')?.value);
  const gRate = parseInput(q('#rate_rate')?.value);
  const amount = gQty * gRate;
  let subtotal = amount; // subtotal is the single calculated amount

  // Update first row amount display (if exists) and render preview row
  if (rows.length > 0) {
    const first = rows[0];
    const amtDisplay = first.querySelector('.amountDisplay');
    if (amtDisplay) {
      // support both input elements and plain cells
      if (amtDisplay.tagName === 'INPUT' || amtDisplay.tagName === 'TEXTAREA') amtDisplay.value = formatNumber(amount);
      else amtDisplay.textContent = formatNumber(amount);
    }
  }
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>Amount</td><td>${formatNumber(amount)}</td>`;
  if (outItems) outItems.appendChild(tr);

  const lorry = parseInput(q('#lorry')?.value);
  // discount percentage selection
  let discount = 0;
  const discountSelect = q('#discount_select');
  let selectedPct = discountSelect ? Number(discountSelect.value) : 0;

  // singleAmount (E5) is the calculated amount from global QTY & RATE —
  // define it early so later logic (discount calculation) can use it
  const singleAmount = amount;

  // compute days difference between arrival_dt and chq_date (if both provided)
  const arrivalVal = q('#arrival_dt')?.value;
  const chqDateVal = q('#chq_date')?.value;
  let daysDiff = null;
  if (arrivalVal && chqDateVal) {
    const a = new Date(arrivalVal); const c = new Date(chqDateVal);
    if (!isNaN(a.getTime()) && !isNaN(c.getTime())) {
      const ms = c.setHours(0, 0, 0, 0) - a.setHours(0, 0, 0, 0);
      daysDiff = Math.round(ms / (1000 * 60 * 60 * 24));
    }
  }

  // NOTE: listeners for #chq_date and #discount_select are wired in wire()
  // to avoid adding duplicate handlers on every recalculation.

  // show days difference in UI
  const dateDiffEl = q('#date_diff');
  if (dateDiffEl) dateDiffEl.textContent = daysDiff === null ? 'Days: -' : ('Days: ' + daysDiff);

  // Auto-select discount percentage based on daysDiff only if user hasn't manually changed selection recently.
  // Rules: <=14 => 4%, <=28 => 3%, <=42 => 2%, <=56 => 1%, else 0%.
  if (typeof daysDiff === 'number') {
    let autoPct = 0;
    if (daysDiff <= 14) autoPct = 0.04;
    else if (daysDiff <= 28) autoPct = 0.03;
    else if (daysDiff <= 42) autoPct = 0.02;
    else if (daysDiff <= 56) autoPct = 0.01;
    else autoPct = 0;
    // only set selection if current selection is 0 (user hasn't chosen) OR matches auto (keep manual choice otherwise)
    if (discountSelect && (Number(discountSelect.dataset.user) !== 1)) {
      discountSelect.value = String(autoPct);
      selectedPct = autoPct;
    }
  }

  // compute discount amount based on E5 (singleAmount)
  if (selectedPct && singleAmount) {
    discount = Math.round((singleAmount * selectedPct) * 100) / 100;
  } else {
    discount = 0;
  }
  const sellerComm = parseInput(q('#seller_commission')?.value);
  const qdiff = parseInput(q('#qdiff')?.value);
  const rateQty = parseInput(q('#rate_qty')?.value);
  const rateRate = parseInput(q('#rate_rate')?.value);
  const lorrySmall = parseInput(q('#lorry_small')?.value);

  // compute EXPENSES TOTAL (sum of lorry + discount + seller + qdiff).
  const expensesSum = lorrySmall + discount + sellerComm + qdiff;
  // Net Amount = singleAmount - expenses
  const netAmountLeft = singleAmount - expensesSum;

  // show LORRY and DISCOUNT as full formatted amounts (not compact)
  const outLorry = q('#out_lorry'); if (outLorry) outLorry.textContent = formatNumber(lorrySmall, false);
  const outDiscount = q('#out_discount'); if (outDiscount) outDiscount.textContent = formatNumber(discount, false);
  const outSeller = q('#out_seller'); if (outSeller) outSeller.textContent = formatNumber(sellerComm);
  const outQdiff = q('#out_qdiff'); if (outQdiff) outQdiff.textContent = formatNumber(qdiff);
  const outTotal = q('#out_total'); if (outTotal) outTotal.textContent = formatNumber(netAmountLeft);

  // NOTE: shortage will be computed later as E7 - E8 (singleAmount - computedTotal minus cheque amount)
  // We keep pretaxTotal separate; shortage is a final delta shown in E9.

  // populate exact A1..I11 cells to match the Excel screenshot
  // write to dedicated span for B1 so text serialization works reliably
  const millerVal = q('#miller_name')?.value || '';
  if (q('#B1_value')) q('#B1_value').textContent = millerVal;
  const B1_td = q('#B1'); if (B1_td) B1_td.textContent = millerVal;
  // map inputs to preview cells as requested
  const B2 = q('#B2'); if (B2) B2.textContent = q('#party_name')?.value || '';
  const B3 = q('#B3'); if (B3) B3.textContent = q('#bill_no')?.value || '';
  const B4 = q('#B4'); {
    const arrivalVal = q('#arrival_dt')?.value;
    if (B4) B4.textContent = arrivalVal ? formatDate(arrivalVal) : '';
  }
  // QTY -> B5, RATE -> D5, E5 shows calculated amount
  const B5 = q('#B5'); if (B5) B5.textContent = formatNumber(gQty);

  // RATE row: E5 should show the single calculated amount (singleAmount already computed)
  const C5 = q('#C5'); if (C5) C5.textContent = '';
  const D5 = q('#D5'); if (D5) D5.textContent = formatNumber(gRate);
  const E5 = q('#E5'); if (E5) E5.textContent = formatNumber(singleAmount);

  // LORRY small in B6, main LORRY total in E6
  const B6 = q('#B6'); if (B6) B6.textContent = formatNumber(parseInput(q('#lorry_small')?.value));
  // E6 will mirror the computed TOTAL (B11) per user instruction; assigned later after computedTotal is calculated.

  // DISCOUNT -> B7, keep main discount in E7
  const B7 = q('#B7'); if (B7) B7.textContent = formatNumber(discount);
  // E7 will be computed as E5 - B11 (singleAmount - computedTotal) per user request.

  // NOTE: E8 will be mirrored from G6 after computedTotal is known (see below).
  // SELLER COM -> B9 and also show in E9
  const B8 = q('#B8'); if (B8) B8.textContent = formatNumber(parseInput(q('#seller_commission')?.value));

  // Q-DIFF should appear in B10 (user requested)
  const B10 = q('#B10'); if (B10) B10.textContent = formatNumber(parseInput(q('#qdiff')?.value));

  // compute EXPENSES as sum of B6 + B7 + B9 + B10
  const lorryHire = parseInput(q('#lorry_small')?.value);
  const discountMain = discount; // use computed discount
  const seller = parseInput(q('#seller_commission')?.value);
  const qdiffVal = parseInput(q('#qdiff')?.value);
  const computedExpenses = lorryHire + discountMain + seller + qdiffVal;

  // NET AMOUNT
  const netAmount = singleAmount - computedExpenses;

  // put TOTAL (Net Amount) in B11 and E11
  const B11 = q('#B11'); if (B11) B11.textContent = formatNumber(netAmount);
  const E11 = q('#E11'); if (E11) E11.textContent = formatNumber(netAmount);

  // E7 shows Net Amount
  const E7 = q('#E7'); if (E7) E7.textContent = formatNumber(netAmount);

  // E6 shows computedExpenses: write into the dedicated span AND also
  // set the parent TD's visible textContent
  const E6_value = q('#E6_value');
  const E6_td = q('#E6');
  if (E6_value) E6_value.textContent = formatNumber(computedExpenses);
  if (E6_td) E6_td.textContent = formatNumber(computedExpenses);
  // ensure G6 holds a visible value (mirror computedExpenses into G6) so E8 can mirror G6
  const G6_node = q('#G6'); if (G6_node) G6_node.textContent = formatNumber(computedExpenses);
  // E8 should mirror I6 (cheque amount) per user request; format if numeric otherwise copy text.
  const E8 = q('#E8');
  const I6_node = q('#I6');
  let e8Text = '';
  if (I6_node && String(I6_node.textContent).trim() !== '') {
    const i6txt = String(I6_node.textContent).trim();
    // treat as numeric when only digits, commas, dots, spaces or minus present
    if (/^[0-9,\.\-\s]+$/.test(i6txt)) {
      e8Text = formatNumber(parseInput(i6txt));
    } else {
      e8Text = i6txt;
    }
  } else {
    // fallback: leave empty if I6 empty
    e8Text = '';
  }
  if (E8) E8.textContent = e8Text;

  // Populate the merged D10 cell with the Remarks text (trimmed)
  const D10_val = q('#D10_value');
  // sanitize remarks: replace newlines, trim and clamp to 200 chars to avoid layout break
  const rawRemarks = (q('#remarks')?.value || '');
  const sanitized = String(rawRemarks).replace(/\s+/g, ' ').trim();
  const maxLen = 200;
  const remarksVal = sanitized.length > maxLen ? sanitized.slice(0, maxLen) + '…' : sanitized;
  if (D10_val) D10_val.textContent = remarksVal;

  // Compute E9 (SHORTAGE) as displayed = E8 - E7 (Cheque - Net Amount).
  const E9_td = q('#E9');
  let e7num = netAmount;
  let e8num = 0;
  // prefer reading numeric I6 (cheque amount) as source of E8 value
  const I6_read = q('#I6');
  if (I6_read) e8num = parseInput(I6_read.textContent || I6_read.innerText || '0');
  // invert sign for display so shortage = cheque - (singleAmount - computedTotal)
  const e9num = e8num - e7num;
  const e9text = formatNumber(e9num);
  if (E9_td) {
    E9_td.textContent = e9text;
    E9_td.classList.remove('pos', 'neg');
    if (e9num > 0) E9_td.classList.add('pos');
    else if (e9num < 0) E9_td.classList.add('neg');
  }

  // CHQ fields in column I: CHQ AM row6, CHQ NO row7, CHQ DT row8, BANK row9
  const I6 = q('#I6'); if (I6) I6.textContent = formatNumber(parseInput(q('#chq_amount')?.value));
  const I7 = q('#I7'); if (I7) I7.textContent = q('#chq_no')?.value || '';
  const I8 = q('#I8'); {
    const chqDateVal = q('#chq_date')?.value;
    if (I8) I8.textContent = chqDateVal ? formatDate(chqDateVal) : '';
  }
  const I9 = q('#I9'); if (I9) I9.textContent = q('#bank')?.value || '';
}

// --- Pattis (local gallery) helpers ---
const PATTIS_KEY = 'pattis_images_v1';
// also expose to window so other scripts (pattis.js) can reuse the same key without redeclaring
if (typeof window !== 'undefined' && !window.PATTIS_KEY) window.PATTIS_KEY = PATTIS_KEY;

// Simple no-op PNG converter (removed server rasterizer and heavy client conversion).
// Keep the function so other code calling it doesn't break.
if (typeof window !== 'undefined') window.ensurePngBlob = async function (blob) { return blob; };

// getPreviewBlob: produces a real PNG blob using the same quickDownloadPNG
// path as the Export PNG button (which is known to work).
async function getPreviewBlob() {
  const node = q('#note');
  if (!node) throw new Error('Preview element not found');
  try {
    // quickDownloadPNG returns {blob, width, height} when returnBlob is true
    const result = await quickDownloadPNG({ returnBlob: true, scaleMultiplier: 2, filename: 'patti-note.png' });
    const blob = result && result.blob ? result.blob : result;
    if (blob instanceof Blob) return blob;
    throw new Error('quickDownloadPNG returned unexpected result');
  } catch (e) {
    throw new Error('Could not capture preview as PNG: ' + (e && e.message ? e.message : e));
  }
}

// Helpers to fetch/convert and trigger PNG downloads (same logic used by pattis.js)
async function fetchAsBlob(src) {
  if (!src) throw new Error('No source provided');
  if (typeof src === 'string' && src.startsWith('data:')) {
    const r = await fetch(src); if (!r.ok) throw new Error('Failed to read data URL'); return await r.blob();
  }
  const r = await fetch(src); if (!r.ok) throw new Error('Network fetch failed: ' + r.status); return await r.blob();
}

// Simplified: fetch the resource and return the blob. No rasterizer or conversion attempts here.
async function fetchAndEnsurePngBlob(src) {
  return await fetchAsBlob(src);
}

function triggerDownloadBlob(blob, filename) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename || 'patti-note.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }

// Simple quick-download helper: tries html2canvas with minimal options and downloads the PNG.
// This bypasses any inlining/fetch/CORS steps so it is fast and less likely to fail due to
// remote assets or Firebase-related flows. Fidelity may be lower for cross-origin assets,
// but it gives a predictable "save as PNG" experience.
// If opts.returnBlob is true, the function returns the generated Blob instead of triggering download.
async function quickDownloadPNG(opts = { filename: 'patti-quick.png', scaleMultiplier: 3, returnBlob: false }) {
  const node = q('#note');
  if (!node) throw new Error('Preview element not found');
  // Ensure visible DOM is current
  try { recalcAll(); } catch (e) { }
  await new Promise(r => setTimeout(r, 80));

  if (!window.html2canvas) throw new Error('html2canvas is not available');

  // Create an offscreen clone wrapped in a container so we can apply export-only CSS
  // without touching the live DOM. Render it fully offscreen but NOT clipped.
  const cloneWrap = document.createElement('div');
  cloneWrap.style.cssText = [
    'position:fixed',
    'left:-9999px',
    'top:0',
    'width:700px',       // natural render width — no constraints
    'overflow:visible',
    'z-index:100000',
    'pointer-events:none',
    'background:#fff'
  ].join(';');

  // Create a container with a known class so our CSS can target it
  const exportContainer = document.createElement('div');
  exportContainer.className = 'patti-export';
  exportContainer.style.cssText = 'width:700px;background:#fff;padding:12px;box-sizing:border-box;';

  // Clone the node deeply
  const cloned = node.cloneNode(true);

  // Remove any width constraints from the clone — let it flow at full natural width
  cloned.style.cssText = [
    'width:100%',
    'overflow:visible',
    'max-width:none',
    'min-width:0',
    'background:#ffffff',
    'color:#000',
    '-webkit-font-smoothing:antialiased'
  ].join(';');

  // Export-specific style overrides.
  const exportStyle = document.createElement('style');
  exportStyle.textContent = `
  .patti-export *:not(img):not(svg):not(canvas) {
    color: #111 !important;
    background-color: #fff !important;
    background: #fff !important;
    opacity: 1 !important;
    filter: none !important;
    -webkit-filter: none !important;
    box-shadow: none !important;
    text-shadow: none !important;
    overflow: visible !important;
    white-space: nowrap !important;
    text-overflow: clip !important;
    max-width: none !important;
  }
  .patti-export table {
    width: 100% !important;
    border-collapse: collapse !important;
    table-layout: auto !important;
  }
  .patti-export td, .patti-export th {
    border: 1px solid #b0b0b0 !important;
    background-color: #fff !important;
    color: #111 !important;
    padding: 4px 6px !important;
    font-size: 12px !important;
  }
  .patti-export .sheet { background-color: #fff !important; width: 100% !important; }
  .patti-export img, .patti-export svg, .patti-export canvas { opacity: 1 !important; filter: none !important; }
  `;
  exportContainer.appendChild(exportStyle);
  exportContainer.appendChild(cloned);
  cloneWrap.appendChild(exportContainer);

  // Utility: copy computed styles from source element to destination element
  function copyComputedStyles(src, dst) {
    try {
      const s = window.getComputedStyle(src);
      if (!s) return;
      // Copy each property
      for (const prop of s) {
        try { dst.style.setProperty(prop, s.getPropertyValue(prop), s.getPropertyPriority(prop)); } catch (e) { }
      }
      // Ensure display and box-sizing are preserved
      try { dst.style.boxSizing = s.boxSizing; } catch (e) { }
    } catch (e) { /* ignore */ }
  }

  // Recursively copy computed styles from original node to cloned node tree
  function deepCopyStyles(origRoot, cloneRoot) {
    try {
      copyComputedStyles(origRoot, cloneRoot);
      const origChildren = origRoot.children || [];
      const cloneChildren = cloneRoot.children || [];
      const len = Math.min(origChildren.length, cloneChildren.length);
      for (let i = 0; i < len; i++) deepCopyStyles(origChildren[i], cloneChildren[i]);
    } catch (e) { /* ignore */ }
  }
  // Walk all clone descendants: ensure fully opaque, no filters, borders on cells
  try {
    const all = Array.from(cloned.querySelectorAll('*'));
    all.forEach(el => {
      try {
        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'IMG' || tag === 'SVG' || tag === 'CANVAS') return;
        el.style.opacity = '1';
        el.style.filter = 'none';
        el.style.webkitFilter = 'none';
        el.style.boxShadow = 'none';
        // clear any inline overflow/clip that might have come from the live styles
        el.style.overflow = 'visible';
        el.style.textOverflow = 'clip';
        el.style.whiteSpace = 'nowrap';
        if (tag === 'TD' || tag === 'TH') {
          el.style.borderStyle = 'solid';
          el.style.borderWidth = '1px';
          el.style.borderColor = '#b0b0b0';
        }
      } catch (e) { }
    });
  } catch (e) { console.warn('Visibility overrides failed', e); }


  // append the export container (which contains the cloned node and export-only styles)
  // (exportContainer was already appended above)
  document.body.appendChild(cloneWrap);

  try {
    // Ensure fonts are loaded before rendering so measurements match
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { }
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    // allow user-provided multiplier, default to 3 for sharper results
    const multiplier = (typeof opts.scaleMultiplier === 'number' && opts.scaleMultiplier > 0) ? opts.scaleMultiplier : 3;
    const scale = Math.max(1, Math.round(dpr * multiplier));

    // Use higher quality smoothing when available
    const canvas = await html2canvas(exportContainer, {
      backgroundColor: '#fff',
      scale,
      useCORS: false,
      allowTaint: true,
      imageTimeout: 20000,
      logging: false
    });

    // Try to improve smoothing on the resulting canvas context
    try {
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (ctx) {
        try { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; } catch (e) { }
      }
    } catch (e) { }

    // Produce blob
    let blob = null;
    try { blob = await new Promise((res, rej) => canvas.toBlob(res, 'image/png')); } catch (e) { console.warn('canvas.toBlob failed', e); }
    if (!blob) {
      try { const dataUrl = canvas.toDataURL('image/png'); const resp = await fetch(dataUrl); blob = await resp.blob(); } catch (e) { console.warn('dataURL fallback failed', e); }
    }

    if (!blob) throw new Error('Unable to produce PNG from canvas (maybe cross-origin assets tainted the canvas).');
    if (opts.returnBlob) return { blob, width: canvas.width, height: canvas.height };
    triggerDownloadBlob(blob, opts.filename || 'patti-quick.png');
    return true;
  } finally {
    // Clean up clone
    try { cloneWrap.remove(); } catch (e) { }
  }
}

async function saveToPattis(presetBlob) {
  try {
    let blob = presetBlob || await getPreviewBlob();
    // Ensure we store a PNG dataUrl in localStorage. Try client-side conversion first.
    try {
      if (blob && blob.type && String(blob.type).toLowerCase().includes('svg')) {
        if (window.ensurePngBlob) {
          try { blob = await window.ensurePngBlob(blob); } catch (e) { console.warn('ensurePngBlob failed when saving pattis:', e); }
        }
        // if still svg, we attempted client-side conversion above; no server rasterizer available.
      } else {
        // If blob is not SVG but not PNG, attempt to convert to PNG for consistent storage
        if (blob && blob.type && !String(blob.type).toLowerCase().includes('png') && window.ensurePngBlob) {
          try { blob = await window.ensurePngBlob(blob); } catch (e) { /* ignore */ }
        }
      }
    } catch (e) { console.warn('saveToPattis conversion attempt failed', e); }
    const reader = new FileReader();
    const timestamp = Date.now();
    const meta = { id: 'patti_' + timestamp, created: timestamp, bill_no: q('#bill_no')?.value || '', miller: q('#miller_name')?.value || '', party: q('#party_name')?.value || '' };
    return await new Promise((resolve, reject) => {
      reader.onload = async () => {
        const dataUrl = reader.result;
        // attempt to produce a PNG dataURL for downloads while keeping original for gallery preview
        let pngDataUrl = dataUrl;
        try {
          // if blob we prepared is PNG already, just use dataUrl
          if (blob && blob.type && String(blob.type).toLowerCase().includes('png')) {
            pngDataUrl = dataUrl;
          } else {
            // try converting blob to PNG using the shared helper
            if (window.ensurePngBlob) {
              try {
                const pngBlob = await window.ensurePngBlob(blob);
                if (pngBlob && pngBlob.type && String(pngBlob.type).toLowerCase().includes('png')) {
                  const pReader = new FileReader();
                  pngDataUrl = await new Promise((res, rej) => { pReader.onload = () => res(pReader.result); pReader.onerror = rej; pReader.readAsDataURL(pngBlob); });
                }
              } catch (e) { console.warn('ensurePngBlob failed when creating pngDataUrl', e); }
            }
            // Do not perform a manual canvas SVG->PNG rasterization here; prefer ensurePngBlob or keep original dataUrl
          }
        } catch (e) { console.warn('Failed to create pngDataUrl', e); }
        try {
          const store = JSON.parse(localStorage.getItem(PATTIS_KEY) || '[]');
          // store both original dataUrl (for preview) and pngDataUrl (for safe downloads)
          store.unshift(Object.assign({}, meta, { dataUrl, pngDataUrl, originalDataUrl: dataUrl, party: q('#party_name')?.value || '' }));
          // keep only latest 200 images to avoid abuse
          localStorage.setItem(PATTIS_KEY, JSON.stringify(store.slice(0, 200)));

          // Refresh datalists with new names from this save
          if (typeof window.refreshDatalistsFromPattis === 'function') {
            setTimeout(() => window.refreshDatalistsFromPattis(), 100);
          }
          // attempt to upload a small thumbnail to a configured thumbnail server (self-hosted) or Firebase.
          // By default this will run automatically during save; set window.AUTO_UPLOAD_THUMBNAILS = false to disable.
          if (typeof window.AUTO_UPLOAD_THUMBNAILS === 'undefined' || window.AUTO_UPLOAD_THUMBNAILS) {
            try {
              let url = null;
              // If a self-hosted thumbnail server is configured, create a small thumbnail and upload to it
              try {
                if (window.THUMBNAIL_SERVER) {
                  try {
                    const thumb = await makeThumbnailBlob(blob, 800, 'image/jpeg', 0.8);
                    const resp = await uploadThumbnailToServer(thumb, window.THUMBNAIL_SERVER);
                    if (resp && resp.url) url = resp.url;
                  } catch (e) { console.warn('Thumbnail server upload failed', e); }
                }
              } catch (e) { console.warn('Thumbnail server flow error', e); }

              // fallback to Firebase upload if no thumbnail server url produced
              if (!url && typeof uploadBlobAndEnsurePng === 'function') {
                try { url = await uploadBlobAndEnsurePng(blob, meta.id, meta); } catch (e) { /* ignore */ }
              }

              if (url) { const cur = JSON.parse(localStorage.getItem(PATTIS_KEY) || '[]'); const idx = cur.findIndex(i => i.id === meta.id); if (idx >= 0) { cur[idx].remoteUrl = url; localStorage.setItem(PATTIS_KEY, JSON.stringify(cur)); } }
            } catch (e) { console.warn('Automatic upload failed (non-fatal):', e); }
          }
          resolve({ id: meta.id, remoteUrl: null, blobType: blob && blob.type });
        } catch (err) { reject(err); }
      };
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error('saveToPattis error', err);
    throw err;
  }
}

// Upload a blob to Firebase Storage and optionally create a Firestore doc for metadata
// Upload a blob to Firebase Storage and optionally create a Firestore doc for metadata
// Supports progress via uploadBytesResumable when onProgress callback provided.
async function uploadBlobToFirebase(blob, id, meta = {}, onProgress = null) {
  if (!window.FIREBASE_CONFIG) throw new Error('No Firebase config (window.FIREBASE_CONFIG)');
  try {
    const { initializeApp, getApps, getApp } = await import('https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js');
    const { getFirestore, collection, addDoc } = await import('https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js');
    const { getAuth, signInAnonymously } = await import('https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js');

    // Reuse existing app instance (firebase-init.js may have already called initializeApp)
    const app = getApps().length ? getApp() : initializeApp(window.FIREBASE_CONFIG);
    try { await signInAnonymously(getAuth(app)).catch(() => { }); } catch (e) { }

    const db = getFirestore(app);

    // --- PRIMARY: shrink blob → small thumbnail → base64 → Firestore ---
    // This gives instant cross-device sync without Firebase Storage or CORS
    let thumbDataUrl = null;
    try {
      const MAX_PX = 600; // max dimension for thumbnail stored in Firestore
      const imgEl = await new Promise((res, rej) => {
        const i = new Image(); i.onload = () => res(i); i.onerror = rej;
        i.src = URL.createObjectURL(blob);
      });
      const scale = Math.min(1, MAX_PX / Math.max(imgEl.naturalWidth || 800, imgEl.naturalHeight || 600));
      const tw = Math.round((imgEl.naturalWidth || 800) * scale);
      const th = Math.round((imgEl.naturalHeight || 600) * scale);
      const c = document.createElement('canvas'); c.width = tw; c.height = th;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tw, th);
      ctx.drawImage(imgEl, 0, 0, tw, th);
      thumbDataUrl = c.toDataURL('image/jpeg', 0.75); // JPEG @ 75% keeps size < 200 KB
    } catch (e) { console.warn('Thumbnail resize failed, will skip thumbDataUrl in Firestore', e); }

    const firestoreDoc = {
      id,
      url: '',            // will be updated if Storage upload succeeds
      created: meta.created || Date.now(),
      bill_no: meta.bill_no || '',
      miller: meta.miller || '',
      party: meta.party || '',
      ...(thumbDataUrl ? { thumbDataUrl } : {})
    };

    let docRef;
    try {
      docRef = await addDoc(collection(db, 'pattis'), firestoreDoc);
      console.log('Firestore patti doc written:', docRef.id);
      if (onProgress) try { onProgress(50); } catch (e) { }
    } catch (e) {
      console.warn('Firestore write failed:', e);
      throw e; // propagate so caller knows
    }

    // --- SECONDARY: Firebase Storage upload (best-effort, may fail on CORS) ---
    const storageUrl = await (async () => {
      try {
        const { getStorage, ref, uploadBytesResumable, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/9.22.2/firebase-storage.js');
        const { updateDoc } = await import('https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js');
        const storage = getStorage(app);
        const ext = (blob && blob.type && String(blob.type).indexOf('svg') !== -1) ? 'svg' : 'png';
        const storageRef = ref(storage, `pattis/${id}.${ext}`);
        const task = uploadBytesResumable(storageRef, blob, { contentType: blob.type });
        const uploadPromise = new Promise((res, rej) => task.on('state_changed',
          snap => { if (onProgress && snap.totalBytes) try { onProgress(50 + Math.round((snap.bytesTransferred / snap.totalBytes) * 50)); } catch (e) { } },
          rej, res));
        // Race against a 12s timeout so a CORS block doesn't hang the button
        await Promise.race([uploadPromise, new Promise((_, rej) => setTimeout(() => rej(new Error('Storage upload timed out')), 12000))]);
        const url = await getDownloadURL(storageRef);
        // update Firestore doc with the permanent Storage URL
        if (docRef) try { await updateDoc(docRef, { url }); } catch (e) { }
        if (onProgress) try { onProgress(100); } catch (e) { }
        return url;
      } catch (e) {
        console.warn('Storage upload failed (non-fatal — Firestore thumb still syncs):', e.message || e);
        return '';
      }
    })();

    return storageUrl || `firestore://${docRef?.id || id}`;
  } catch (err) {
    console.warn('uploadBlobToFirebase error', err);
    throw err;
  }
}

// Server rasterizer support removed — client-side conversion only.

// Upload helper that ensures PNG is produced and returns the download URL.
async function uploadBlobAndEnsurePng(blob, id, meta = {}, onProgress = null) {
  if (!blob) throw new Error('No blob provided');
  // If already PNG, upload directly
  if (blob.type && String(blob.type).toLowerCase().includes('png')) {
    return await uploadBlobToFirebase(blob, id, meta, onProgress);
  }

  // Try client-side conversion
  try {
    const pngBlob = await ensurePngBlob(blob);
    if (pngBlob && pngBlob.type && String(pngBlob.type).includes('png')) {
      return await uploadBlobToFirebase(pngBlob, id, meta, onProgress);
    }
  } catch (e) {
    console.warn('Client-side conversion to PNG failed:', e);
  }

  // Client-only: if conversion fails, propagate an informative error
  throw new Error('Unable to produce PNG from the provided image (client-side conversion failed).');
}

// Convert a blob (SVG or other) to PNG client-side using canvas when possible
async function ensurePngBlob(blob) {
  if (!blob) throw new Error('No blob to convert');
  if (blob.type && String(blob.type).toLowerCase().includes('png')) return blob;
  // Create an object URL and draw to canvas
  const url = URL.createObjectURL(blob);
  try {
    // Try createImageBitmap first
    let bitmap = null;
    if (typeof createImageBitmap === 'function') {
      try { bitmap = await createImageBitmap(blob); } catch (e) { bitmap = null; }
    }
    if (!bitmap) {
      // fallback to Image element
      await new Promise((res, rej) => {
        const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => { bitmap = img; res(); }; img.onerror = rej; img.src = url;
      });
    }
    const w = Math.max(1, (bitmap && (bitmap.width || bitmap.naturalWidth)) || 1200);
    const h = Math.max(1, (bitmap && (bitmap.height || bitmap.naturalHeight)) || 800);
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(w)); canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    if (bitmap instanceof ImageBitmap) ctx.drawImage(bitmap, 0, 0, w, h); else if (bitmap) ctx.drawImage(bitmap, 0, 0, w, h);
    const pngBlob = await new Promise((res, rej) => { try { canvas.toBlob(res, 'image/png'); } catch (e) { rej(e); } });
    if (!pngBlob) throw new Error('Canvas produced no PNG');
    return pngBlob;
  } finally { try { URL.revokeObjectURL(url); } catch (e) { } }
}

if (typeof window !== 'undefined') window.ensurePngBlob = ensurePngBlob;

// Expose a helper for other pages (pattis.html) to trigger upload when available
if (typeof window !== 'undefined') {
  window.uploadBlobToFirebaseFromClient = async function (blob, id, meta) {
    return await uploadBlobToFirebase(blob, id, meta);
  };
}

// Create a compressed/resized Blob from an image Blob (thumbnail)
async function makeThumbnailBlob(blob, maxWidth = 800, mime = 'image/jpeg', quality = 0.8) {
  if (!blob) throw new Error('No blob');
  let img;
  try {
    if (typeof createImageBitmap === 'function') {
      img = await createImageBitmap(blob);
    } else {
      img = new Image(); img.crossOrigin = 'anonymous';
      const url = URL.createObjectURL(blob);
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    img = new Image(); img.src = dataUrl; await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  }
  const w = img.width || img.naturalWidth || 1200;
  const h = img.height || img.naturalHeight || 800;
  const scale = Math.min(1, maxWidth / w);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const thumbBlob = await new Promise((res, rej) => { try { canvas.toBlob(res, mime, quality); } catch (e) { rej(e); } });
  if (!thumbBlob) throw new Error('Thumbnail creation failed');
  return thumbBlob;
}
if (typeof window !== 'undefined') window.makeThumbnailBlob = makeThumbnailBlob;

// Upload a thumbnail blob to the configured self-hosted thumbnail server
async function uploadThumbnailToServer(blob, serverBase) {
  if (!blob) throw new Error('No blob');
  if (!serverBase) throw new Error('No server base URL');
  try {
    const form = new FormData();
    // infer filename extension from blob type when possible
    let ext = '.jpg';
    try {
      const t = String(blob.type || '').toLowerCase();
      if (t.includes('svg')) ext = '.svg'; else if (t.includes('png')) ext = '.png'; else if (t.includes('jpeg') || t.includes('jpg')) ext = '.jpg';
    } catch (e) { }
    form.append('file', blob, 'thumb' + ext);
    const res = await fetch(serverBase.replace(/\/$/, '') + '/upload', { method: 'POST', body: form });
    if (!res.ok) throw new Error('Upload failed: ' + res.status);
    return await res.json();
  } catch (e) { console.warn('uploadThumbnailToServer error', e); throw e; }
}
if (typeof window !== 'undefined') window.uploadThumbnailToServer = uploadThumbnailToServer;

// share via WhatsApp: try Web Share API first, otherwise open WhatsApp Web with text and blob URL
async function shareImageViaWhatsApp(blob, text = 'Patti note') {
  // WhatsApp sharing removed. Provide PNG download or clipboard copy instead.
  try {
    let png = blob;
    if (window.ensurePngBlob) {
      try { png = await window.ensurePngBlob(blob); } catch (e) { console.warn('PNG conversion failed, continuing with original blob', e); }
    }

    // Try clipboard first
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        alert('Image copied to clipboard. Paste into chat or app to share.');
        return true;
      } catch (e) { console.warn('clipboard write failed', e); }
    }

    // Fallback: trigger a download of PNG
    const url = URL.createObjectURL(png);
    const a = document.createElement('a'); a.href = url; a.download = 'patti-share.png'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return false;
  } catch (err) {
    console.error('shareImageViaWhatsApp replacement failed', err);
    alert('Sharing failed: ' + (err && err.message ? err.message : String(err)));
    return false;
  }
}


// Attempt to scan a sheet (array of rows) and fill form fields using common labels
function scanAndFill(rows) {
  // Improved row-based mapping: first column is label, pick first numeric/value cell in the row
  const labelMap = {};
  rows.forEach((r, ri) => {
    if (!r || r.length === 0) return;
    const label = String(r[0] || '').trim();
    if (!label) return;
    // prefer E (index 4) for amount-like rows (RATE row often has amount in col E)
    let value = null;
    if (r[4] !== undefined && String(r[4]).trim() !== '') value = r[4];
    else {
      // otherwise pick first cell after column A that looks like a number or non-empty
      for (let c = 1; c < r.length; c++) {
        if (r[c] !== undefined && String(r[c]).trim() !== '') { value = r[c]; break; }
      }
    }
    labelMap[label.toUpperCase()] = value;
  });

  function getLabel(...keys) {
    for (const k of keys) {
      const v = labelMap[k.toUpperCase()];
      if (typeof v !== 'undefined' && v !== null && String(v).trim() !== '') return v;
    }
    return null;
  }

  const miller = getLabel('MILLER NAME'); if (miller) q('#miller_name').value = miller;
  const party = getLabel('PARTY NAME'); if (party) q('#party_name').value = party;
  const bill = getLabel('BILL NO'); if (bill) q('#bill_no').value = bill;
  const arrival = getLabel('ARRIVAL DT'); if (arrival) q('#arrival_dt').value = new Date(arrival).toISOString().slice(0, 10);

  // RATE row: prefer the computed amount in column E
  const rateAmount = getLabel('RATE');
  if (rateAmount) {
    // if the sheet had a RATE cached value, set first row qty/rate if possible
    const first = q('#itemsTable .itemRow');
    if (first) {
      // assume rateAmount is the total; leave it unless user sets qty/rate
    }
  }
  const lorry = getLabel('LORRY HIRE', 'LORRY');
  if (lorry) {
    // main #lorry input was removed; prefer setting #lorry if present, otherwise set #lorry_small
    const node = q('#lorry');
    if (node) node.value = lorry;
    else if (q('#lorry_small')) q('#lorry_small').value = lorry;
  }
  const discount = getLabel('DISCOUNT'); if (discount) q('#discount').value = discount;
  const seller = getLabel('SELLER COM'); if (seller) q('#seller_commission').value = seller;
  const qd = getLabel('Q-DIFF'); if (qd) q('#qdiff').value = qd;
  const chq = getLabel('CHQ AM'); if (chq) q('#chq_amount').value = chq;
  const chqno = getLabel('CHQ NO'); if (chqno) q('#chq_no').value = chqno;
  const chqdt = getLabel('CHQ DT'); if (chqdt) q('#chq_date').value = new Date(chqdt).toISOString().slice(0, 10);
  const bank = getLabel('BANK'); if (bank) q('#bank').value = bank;

  // reflect these into preview placeholders
  if (miller) q('#out_miller').textContent = miller;
  if (party) q('#out_party').textContent = party;
  if (bill) q('#out_bill').textContent = bill;
  if (arrival) q('#out_arrival').textContent = formatDate(arrival);
}

// ━━━ Cell Editor: Make table cells directly editable ━━━
// Map table cell IDs to their corresponding form field IDs
const CELL_EDITOR_MAP = {
  'B1': { fieldId: 'miller_name', label: 'Miller Name', type: 'select', isDate: false },
  'B2': { fieldId: 'party_name', label: 'Party Name', type: 'select', isDate: false },
  'B3': { fieldId: 'bill_no', label: 'Bill No', type: 'text', isDate: false },
  'B4': { fieldId: 'arrival_dt', label: 'Arrival Date', type: 'date', isDate: true },
  'B5': { fieldId: 'rate_qty', label: 'QTY', type: 'number', isDate: false },
  'B6': { fieldId: 'lorry_small', label: 'Lorry Hire', type: 'number', isDate: false },
  'B7': { fieldId: 'discount_select', label: 'Discount %', type: 'select', isDate: false },
  'B8': { fieldId: 'seller_commission', label: 'Seller Commission', type: 'number', isDate: false },
  'B10': { fieldId: 'qdiff', label: 'Q-Diff', type: 'number', isDate: false },
  'I6': { fieldId: 'chq_amount', label: 'CHQ Amount', type: 'number', isDate: false },
  'I7': { fieldId: 'chq_no', label: 'CHQ No', type: 'text', isDate: false },
  'I8': { fieldId: 'chq_date', label: 'CHQ Date', type: 'date', isDate: true },
  'I9': { fieldId: 'bank', label: 'Bank', type: 'text', isDate: false },
  'D10': { fieldId: 'remarks', label: 'Remarks', type: 'textarea', isDate: false }
};

// Setup cell editors for inline editing in table
function setupCellEditors() {
  Object.entries(CELL_EDITOR_MAP).forEach(([cellId, config]) => {
    const cellEl = q('#' + cellId);
    if (!cellEl) return;

    // Mark as editable
    cellEl.setAttribute('data-editable', 'true');

    // Make cell look clickable
    cellEl.style.cursor = 'pointer';
    cellEl.style.transition = 'background-color 0.2s ease';
    cellEl.style.position = 'relative';
    cellEl.style.borderBottom = '1px dotted rgba(37, 99, 235, 0.3)';
    cellEl.title = 'Click to edit: ' + config.label;

    // Hover effect
    cellEl.addEventListener('mouseenter', () => {
      cellEl.style.backgroundColor = 'rgba(37, 99, 235, 0.08)';
      cellEl.style.borderBottomStyle = 'solid';
      cellEl.style.borderBottomColor = 'rgba(37, 99, 235, 0.6)';
    });
    cellEl.addEventListener('mouseleave', () => {
      cellEl.style.backgroundColor = '';
      cellEl.style.borderBottomStyle = 'dotted';
      cellEl.style.borderBottomColor = 'rgba(37, 99, 235, 0.3)';
    });

    // Click to edit
    cellEl.addEventListener('click', (e) => {
      e.stopPropagation();
      showCellEditor(cellId, config);
    });
  });
}

function showCellEditor(cellId, config) {
  const formField = q('#' + config.fieldId);
  if (!formField) return;

  // Remove existing editor if open
  document.getElementById('_cell_editor_modal')?.remove();

  // Create modal
  const modal = document.createElement('div');
  modal.id = '_cell_editor_modal';
  Object.assign(modal.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(10,15,30,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '999999',
    padding: '1rem',
    backdropFilter: 'blur(3px)'
  });

  const box = document.createElement('div');
  Object.assign(box.style, {
    background: '#fff',
    borderRadius: '16px',
    padding: '1.5rem',
    maxWidth: '500px',
    width: '90%',
    boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
    animation: 'scaleIn 0.25s ease-out'
  });

  // Title
  const title = document.createElement('h3');
  title.textContent = 'Edit ' + config.label;
  Object.assign(title.style, {
    margin: '0 0 1rem 0',
    fontFamily: 'Inter, sans-serif',
    fontSize: '1.1rem',
    fontWeight: '600',
    color: '#1e293b'
  });
  box.appendChild(title);

  // Input field
  let input;
  if (config.type === 'select') {
    input = document.createElement('select');
    if (config.fieldId === 'discount_select') {
      // Discount select options
      input.innerHTML = `
        <option value="0">No discount</option>
        <option value="0.04">4%</option>
        <option value="0.03">3%</option>
        <option value="0.02">2%</option>
        <option value="0.01">1%</option>
      `;
    } else {
      // Miller or Party selects - populate from form field
      const originalSelect = formField;
      input.innerHTML = originalSelect.innerHTML;
    }
    input.value = formField.value;
  } else if (config.type === 'textarea') {
    input = document.createElement('textarea');
    input.value = formField.value;
    input.rows = 4;
    Object.assign(input.style, { resize: 'vertical', fontFamily: 'monospace' });
  } else {
    input = document.createElement('input');
    input.type = config.type;
    input.value = formField.value;
  }

  Object.assign(input.style, {
    width: '100%',
    padding: '0.75rem',
    border: '1.5px solid #e2e8f0',
    borderRadius: '10px',
    fontFamily: 'Inter, sans-serif',
    fontSize: '0.95rem',
    boxSizing: 'border-box',
    outline: 'none',
    transition: 'border-color 0.2s'
  });

  input.addEventListener('focus', () => {
    input.style.borderColor = '#2563eb';
  });
  input.addEventListener('blur', () => {
    input.style.borderColor = '#e2e8f0';
  });

  box.appendChild(input);

  // Buttons
  const buttonGroup = document.createElement('div');
  Object.assign(buttonGroup.style, {
    display: 'flex',
    gap: '0.75rem',
    marginTop: '1.5rem',
    justifyContent: 'flex-end'
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  Object.assign(cancelBtn.style, {
    padding: '0.6rem 1.2rem',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    background: '#f8fafc',
    color: '#64748b',
    cursor: 'pointer',
    fontFamily: 'Inter, sans-serif',
    fontWeight: '500',
    transition: 'all 0.2s'
  });
  cancelBtn.addEventListener('click', () => modal.remove());
  cancelBtn.addEventListener('mouseenter', () => {
    cancelBtn.style.background = '#e2e8f0';
  });
  cancelBtn.addEventListener('mouseleave', () => {
    cancelBtn.style.background = '#f8fafc';
  });

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  Object.assign(saveBtn.style, {
    padding: '0.6rem 1.2rem',
    border: 'none',
    borderRadius: '8px',
    background: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
    fontFamily: 'Inter, sans-serif',
    fontWeight: '600',
    transition: 'all 0.2s'
  });
  saveBtn.addEventListener('click', () => {
    formField.value = input.value;
    formField.dispatchEvent(new Event('input', { bubbles: true }));
    formField.dispatchEvent(new Event('change', { bubbles: true }));
    modal.remove();
    try { recalcAll(); } catch (e) { }
    showToast('✓ Updated: ' + config.label);
  });
  saveBtn.addEventListener('mouseenter', () => {
    saveBtn.style.background = '#1d4ed8';
  });
  saveBtn.addEventListener('mouseleave', () => {
    saveBtn.style.background = '#2563eb';
  });

  buttonGroup.appendChild(cancelBtn);
  buttonGroup.appendChild(saveBtn);
  box.appendChild(buttonGroup);

  modal.appendChild(box);
  document.body.appendChild(modal);

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  // Focus input and select all text
  setTimeout(() => {
    input.focus();
    if (input.select) input.select();
  }, 50);

  // Enter to save, Escape to cancel
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.tagName !== 'TEXTAREA') {
      saveBtn.click();
    } else if (e.key === 'Escape') {
      cancelBtn.click();
    }
  });
}

function wire() {
  // input listeners
  // removed dynamic adjustments; addRow no longer used

  // Setup cell editors for direct table editing
  setupCellEditors();

  q('#itemsTable')?.addEventListener('click', e => {
    if (e.target.classList.contains('del')) {
      const tr = e.target.closest('tr'); tr.remove(); recalcAll();
    }
  });

  function attachRowListeners(tr) {
    qAll('.qtyInput, .rateInput, .desc', tr).forEach(inp => inp.addEventListener('input', recalcAll));
  }

  qAll('#itemsTable .itemRow').forEach(attachRowListeners);
  q('#lorry')?.addEventListener('input', recalcAll);
  q('#discount')?.addEventListener('input', recalcAll);
  q('#seller_commission')?.addEventListener('input', recalcAll);
  q('#qdiff')?.addEventListener('input', recalcAll);
  q('#rate_qty')?.addEventListener('input', recalcAll);
  q('#rate_rate')?.addEventListener('input', recalcAll);
  q('#discount_select')?.addEventListener('change', () => {
    try {
      const sel = q('#discount_select'); if (sel) sel.dataset.user = '1';
      recalcAll();
    } catch (e) { }
  });
  // removed #company and #date listeners (not used in Excel format)
  q('#remarks')?.addEventListener('input', () => {
    const el = q('#out_remarks'); if (el) el.textContent = q('#remarks').value;
    // also update merged D10 preview immediately
    const d10 = q('#D10_value'); if (d10) d10.textContent = q('#remarks').value.trim();
  });
  q('#miller_name')?.addEventListener('change', () => {
    const el = q('#out_miller'); if (el) el.textContent = q('#miller_name').value;
  });
  // also update the sheet cell B1 immediately when miller name is edited
  q('#miller_name')?.addEventListener('change', () => {
    const v = q('#miller_name').value || '';
    if (q('#B1_value')) {
      q('#B1_value').textContent = v;
      // flash to show update
      q('#B1_value').classList.remove('flash');
      // force reflow
      void q('#B1_value').offsetWidth;
      q('#B1_value').classList.add('flash');
    }
    // also set cell text directly as a stronger fallback
    if (q('#B1')) q('#B1').textContent = v;
    console.log('miller_name input ->', v);
    recalcAll();
  });
  q('#party_name')?.addEventListener('change', () => { const el = q('#out_party'); if (el) el.textContent = q('#party_name').value; });
  // also update sheet cell B2 live from PARTY NAME input
  q('#party_name')?.addEventListener('change', () => {
    const v = q('#party_name').value || '';
    const b2 = q('#B2'); if (b2) b2.textContent = v;
    try { recalcAll(); } catch (e) { }
  });
  q('#bill_no')?.addEventListener('input', () => { const el = q('#out_bill'); if (el) el.textContent = q('#bill_no').value; });
  q('#arrival_dt')?.addEventListener('input', () => { const el = q('#out_arrival'); if (el) el.textContent = q('#arrival_dt').value ? formatDate(q('#arrival_dt').value) : ''; });

  // --- simple client-side storage for Miller and Party names ---
  const NAMES_KEY = 'patti_saved_names_v1';
  function loadSaved() {
    try { const raw = localStorage.getItem(NAMES_KEY); return raw ? JSON.parse(raw) : { millers: [], parties: [] }; } catch (e) { return { millers: [], parties: [] }; }
  }
  function saveSaved(obj) {
    try { localStorage.setItem(NAMES_KEY, JSON.stringify(obj)); } catch (e) { }
  }
  function populateDropdown(selectId, arr, placeholder = "Select...") {
    const select = q('#' + selectId); if (!select) return;
    const currentValue = select.value; // Preserve current selection
    select.innerHTML = `<option value="">${placeholder}</option>`;

    (arr || []).forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      if (v === currentValue) opt.selected = true; // Restore selection
      select.appendChild(opt);
    });
  }

  // Update function to work with dropdowns instead of datalist
  function populateDatalist(id, arr) {
    if (id === 'miller_list') {
      populateDropdown('miller_name', arr, 'Select Miller...');
    } else if (id === 'party_list') {
      populateDropdown('party_name', arr, 'Select Party...');
    }
  }

  // Function to extract names from Pattis store
  function extractNamesFromPattis() {
    try {
      if (typeof localStorage === 'undefined') return { millers: [], parties: [] };

      const pattisKey = (typeof window !== 'undefined' && window.PATTIS_KEY) ? window.PATTIS_KEY : 'pattis_images_v1';
      const pattis = JSON.parse(localStorage.getItem(pattisKey) || '[]');

      const millers = new Set();
      const parties = new Set();

      pattis.forEach(item => {
        if (item.miller && item.miller.trim()) {
          millers.add(item.miller.trim());
        }
        if (item.party && item.party.trim()) {
          parties.add(item.party.trim());
        }
      });

      return {
        millers: Array.from(millers).sort(),
        parties: Array.from(parties).sort()
      };
    } catch (e) {
      console.warn('Failed to extract names from Pattis:', e);
      return { millers: [], parties: [] };
    }
  }

  // Merge and populate datalists with all available data
  function populateDatalistsWithAllData() {
    const saved = loadSaved();
    const pattisNames = extractNamesFromPattis();

    // Merge and deduplicate
    const allMillers = [...new Set([...(saved.millers || []), ...pattisNames.millers])].sort();
    const allParties = [...new Set([...(saved.parties || []), ...pattisNames.parties])].sort();

    populateDatalist('miller_list', allMillers);
    populateDatalist('party_list', allParties);

    return { millers: allMillers, parties: allParties };
  }

  // Expose function globally for use when Pattis are saved/updated
  window.refreshDatalistsFromPattis = populateDatalistsWithAllData;

  // populate datalists at start with all available data
  populateDatalistsWithAllData();

  // ── Names Management Modal ──────────────────────────────────────
  // Creates a styled modal for adding / deleting miller or party names.
  function openNamesModal(type) {
    // type: 'miller' | 'party'
    const isM = type === 'miller';
    const title = isM ? 'Manage Miller Names' : 'Manage Party Names';
    const selectId = isM ? 'miller_name' : 'party_name';

    // Remove any existing modal
    const existing = document.getElementById('_names_modal');
    if (existing) existing.remove();

    function getNames() {
      const saved = loadSaved();
      const pattis = extractNamesFromPattis();
      const key = isM ? 'millers' : 'parties';
      return [...new Set([...(saved[key] || []), ...(pattis[key] || [])])].sort();
    }

    function saveName(val) {
      const s = loadSaved();
      const key = isM ? 'millers' : 'parties';
      if (!s[key]) s[key] = [];
      if (!s[key].includes(val)) { s[key].push(val); saveSaved(s); }
      // Firebase sync
      if (window.firebaseNames?.enabled && typeof window.firebaseNames.addName === 'function') {
        window.firebaseNames.addName(isM ? 'millers' : 'parties', val).catch(e => console.warn(e));
      }
    }

    function deleteName(val) {
      const s = loadSaved();
      const key = isM ? 'millers' : 'parties';
      if (s[key]) { s[key] = s[key].filter(n => n !== val); saveSaved(s); }
    }

    function buildModal() {
      const names = getNames();

      const backdrop = document.createElement('div');
      backdrop.id = '_names_modal';
      Object.assign(backdrop.style, {
        position: 'fixed', inset: '0', background: 'rgba(10,15,30,0.55)',
        zIndex: '999999', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem', backdropFilter: 'blur(4px)', animation: 'fadeIn 0.2s ease both'
      });

      const box = document.createElement('div');
      Object.assign(box.style, {
        background: '#fff', borderRadius: '20px', width: '100%', maxWidth: '420px',
        boxShadow: '0 30px 60px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column',
        overflow: 'hidden', animation: 'scaleIn 0.28s cubic-bezier(0.34,1.56,0.64,1) both',
        maxHeight: '90vh'
      });

      // Header
      const header = document.createElement('div');
      Object.assign(header.style, {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1.1rem 1.25rem', borderBottom: '1px solid #e2e8f0',
        background: 'linear-gradient(135deg,#2563eb,#0ea5e9)', color: '#fff'
      });
      header.innerHTML = `
        <span style="font-weight:700;font-size:1rem;font-family:Inter,sans-serif">${title}</span>
        <button id="_nm_close" style="background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:1.2rem;display:flex;align-items:center;justify-content:center;transition:background .2s">✕</button>
      `;

      // Add row
      const addRow = document.createElement('div');
      Object.assign(addRow.style, { display: 'flex', gap: '0.5rem', padding: '1rem 1.25rem', borderBottom: '1px solid #f1f5f9' });
      const inp = document.createElement('input');
      Object.assign(inp, { type: 'text', placeholder: `Type name and press Add…`, id: '_nm_input' });
      Object.assign(inp.style, {
        flex: '1', padding: '0.6rem 0.9rem', border: '1.5px solid #e2e8f0',
        borderRadius: '10px', fontFamily: 'Inter,sans-serif', fontSize: '0.9rem', minHeight: '42px',
        outline: 'none', transition: 'border-color .15s'
      });
      inp.addEventListener('focus', () => inp.style.borderColor = '#2563eb');
      inp.addEventListener('blur', () => inp.style.borderColor = '#e2e8f0');

      const addBtn = document.createElement('button');
      addBtn.textContent = '+ Add';
      Object.assign(addBtn.style, {
        background: '#10b981', color: '#fff', border: 'none', borderRadius: '10px',
        padding: '0 1rem', fontFamily: 'Inter,sans-serif', fontWeight: '700', fontSize: '0.85rem',
        cursor: 'pointer', minHeight: '42px', whiteSpace: 'nowrap', transition: 'background .2s,transform .15s'
      });
      addBtn.addEventListener('mouseenter', () => { addBtn.style.background = '#059669'; addBtn.style.transform = 'translateY(-1px)'; });
      addBtn.addEventListener('mouseleave', () => { addBtn.style.background = '#10b981'; addBtn.style.transform = ''; });
      addRow.append(inp, addBtn);

      // List container (scrollable)
      const listWrap = document.createElement('div');
      Object.assign(listWrap.style, { overflowY: 'auto', padding: '0.5rem 1.25rem 1.25rem', flex: '1' });

      function renderList() {
        listWrap.innerHTML = '';
        const currentNames = getNames();
        if (!currentNames.length) {
          listWrap.innerHTML = `<p style="color:#94a3b8;font-size:0.85rem;text-align:center;padding:1.5rem 0;font-family:Inter,sans-serif">No names yet. Add one above!</p>`;
          return;
        }
        
        // Add hint text
        const hint = document.createElement('p');
        hint.style.cssText = 'color:#64748b;font-size:0.8rem;margin:0 0 0.75rem 0;padding:0 0.5rem;font-family:Inter,sans-serif;display:flex;align-items:center;gap:0.5rem';
        hint.innerHTML = '💡 Click name to select • Click 🗑 to delete';
        listWrap.appendChild(hint);
        
        currentNames.forEach(name => {
          const row = document.createElement('div');
          Object.assign(row.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.55rem 0.75rem', marginBottom: '0.35rem',
            background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0',
            transition: 'background .15s, border-color .15s', cursor: 'pointer'
          });
          row.addEventListener('mouseenter', () => row.style.background = '#eff6ff');
          row.addEventListener('mouseleave', () => row.style.background = '#f8fafc');

          const nameSpan = document.createElement('span');
          nameSpan.textContent = name;
          Object.assign(nameSpan.style, { fontFamily: 'Inter,sans-serif', fontSize: '0.9rem', fontWeight: '500', color: '#1e293b', flex: '1', cursor: 'pointer' });
          // Click name to select it
          nameSpan.title = 'Click to select';
          nameSpan.addEventListener('click', () => {
            const sel = q('#' + selectId);
            if (sel) { sel.value = name; sel.dispatchEvent(new Event('change')); }
            backdrop.remove();
            showToast(`Selected: ${name}`);
          });

          const delBtn = document.createElement('button');
          delBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
          Object.assign(delBtn.style, {
            background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444', cursor: 'pointer',
            padding: '6px 8px', borderRadius: '6px', transition: 'all .15s', display: 'flex', alignItems: 'center', fontWeight: '600'
          });
          delBtn.title = 'Delete this name';
          delBtn.addEventListener('mouseenter', () => {
            delBtn.style.background = '#fee2e2';
            delBtn.style.borderColor = '#ef4444';
          });
          delBtn.addEventListener('mouseleave', () => {
            delBtn.style.background = 'rgba(239, 68, 68, 0.05)';
            delBtn.style.borderColor = 'rgba(239, 68, 68, 0.2)';
          });
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteName(name);
            populateDatalistsWithAllData();
            renderList();
            // If currently selected, clear the dropdown
            const sel = q('#' + selectId);
            if (sel && sel.value === name) { sel.value = ''; sel.dispatchEvent(new Event('change')); }
            showToast(`Deleted: ${name}`);
          });

          row.append(nameSpan, delBtn);
          listWrap.appendChild(row);
        });
      }

      function doAdd() {
        const val = inp.value.trim();
        if (!val) { inp.style.borderColor = '#ef4444'; inp.focus(); return; }
        saveName(val);
        populateDatalistsWithAllData();
        renderList();
        // Auto-select the newly added name
        const sel = q('#' + selectId);
        if (sel) { sel.value = val; sel.dispatchEvent(new Event('change')); }
        inp.value = '';
        inp.focus();
        showToast(`Added: ${val}`);
      }

      addBtn.addEventListener('click', doAdd);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });

      renderList();
      box.append(header, addRow, listWrap);
      backdrop.appendChild(box);
      document.body.appendChild(backdrop);

      // Close on backdrop click or ✕ button
      backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
      document.getElementById('_nm_close')?.addEventListener('click', () => backdrop.remove());

      // Focus the input
      setTimeout(() => inp.focus(), 80);
    }

    buildModal();
  }

  q('#add_miller_btn')?.addEventListener('click', () => openNamesModal('miller'));
  q('#add_party_btn')?.addEventListener('click', () => openNamesModal('party'));

  // No search needed for dropdowns - they show all options

  // subscribe to real-time updates from Firestore to keep datalists synced
  const fbStatusEl = q('#firebase_status');
  function setFbStatus(txt, ok) { if (fbStatusEl) { fbStatusEl.textContent = 'Firebase: ' + txt; fbStatusEl.style.color = ok ? '#117a37' : '#b22222'; } }

  // If firebase-init is present, wait for it to become enabled (auth initialisation is async)
  async function setupFirebaseIntegration() {
    if (!window.firebaseNames) return false;

    // wait up to ~6 seconds for firebase to finish init/auth
    const waitForEnabled = async (timeoutMs = 6000, poll = 200) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (window.firebaseNames.enabled) return true;
        await new Promise(r => setTimeout(r, poll));
      }
      return !!window.firebaseNames.enabled;
    };

    const enabled = await waitForEnabled(6000, 250);
    if (!enabled) {
      console.warn('Firebase did not become enabled within timeout; falling back to local store for dropdowns');
      return false;
    }

    try {
      // subscribe to realtime updates
      const unsubM = window.firebaseNames.listenNames('millers', (firebaseMillers) => {
        const pattisNames = extractNamesFromPattis();
        const saved = loadSaved();
        const allMillers = [...new Set([...(saved.millers || []), ...pattisNames.millers, ...firebaseMillers])].sort();
        populateDropdown('miller_name', allMillers, 'Select Miller...');
      });
      const unsubP = window.firebaseNames.listenNames('parties', (firebaseParties) => {
        const pattisNames = extractNamesFromPattis();
        const saved = loadSaved();
        const allParties = [...new Set([...(saved.parties || []), ...pattisNames.parties, ...firebaseParties])].sort();
        populateDropdown('party_name', allParties, 'Select Party...');
      });

      // initial fetch using getAllNames to populate dropdowns immediately
      if (typeof window.firebaseNames.getAllNames === 'function') {
        try {
          const [firebaseMillers, firebaseParties] = await Promise.all([
            window.firebaseNames.getAllNames('millers'),
            window.firebaseNames.getAllNames('parties')
          ]);
          const pattisNames = extractNamesFromPattis();
          const saved = loadSaved();
          const allMillers = [...new Set([...(saved.millers || []), ...pattisNames.millers, ...firebaseMillers])].sort();
          const allParties = [...new Set([...(saved.parties || []), ...pattisNames.parties, ...firebaseParties])].sort();
          populateDropdown('miller_name', allMillers, 'Select Miller...');
          populateDropdown('party_name', allParties, 'Select Party...');
          console.log('Initial Firebase data loaded:', { millers: firebaseMillers.length, parties: firebaseParties.length });
        } catch (e) { console.warn('Error fetching initial firebase lists', e); }
      }

      window._patti_unsub = () => { try { unsubM(); unsubP(); } catch (e) { } };
      setFbStatus('connected', true);
      return true;
    } catch (e) { console.warn('subscribe failed', e); return false; }
  }

  // kick off firebase integration (async) if the module is present
  if (window.firebaseNames) { setupFirebaseIntegration(); }
  else {
    setFbStatus('not connected (falling back to localStorage)', false);
    // Load local data when Firebase is not available
    const pattisNames = extractNamesFromPattis();
    const saved = loadSaved();
    const allMillers = [...new Set([...(saved.millers || []), ...pattisNames.millers])].sort();
    const allParties = [...new Set([...(saved.parties || []), ...pattisNames.parties])].sort();
    populateDropdown('miller_name', allMillers, 'Select Miller...');
    populateDropdown('party_name', allParties, 'Select Party...');
  }

  // (Test Firebase button removed from UI.)

  // Retry button removed — initialization now happens automatically on page load if config present.

  // also update sheet cell B4 live from ARRIVAL DT input and trigger recalc
  q('#arrival_dt')?.addEventListener('input', () => {
    const v = q('#arrival_dt').value || '';
    const b4 = q('#B4'); if (b4) b4.textContent = v ? formatDate(v) : '';
    try { recalcAll(); } catch (e) { }
  });

  // format amount inputs on blur, parse on focus
  function wireFormatting(sel) {
    qAll(sel).forEach(inp => {
      inp.addEventListener('focus', e => { e.target.value = (parseInput(e.target.value) || 0); });
      inp.addEventListener('blur', e => { e.target.value = formatNumber(parseInput(e.target.value)); recalcAll(); });
    });
  }
  // apply formatting to all relevant inputs
  wireFormatting('.qtyInput, .rateInput');
  wireFormatting('#rate_qty, #rate_rate');
  wireFormatting('#lorry, #discount, #chq_amount');

  // also format seller commission and qdiff
  wireFormatting('#seller_commission, #qdiff');

  // cheque inputs wiring
  q('#chq_amount')?.addEventListener('input', () => { const el = q('#out_chq_amount'); if (el) el.textContent = 'CHQ AM: ' + formatNumber(parseInput(q('#chq_amount').value)); recalcAll(); });
  // CHQ NO is free-form string (may contain letters, leading zeros). Update preview cell I7 live.
  q('#chq_no')?.addEventListener('input', () => {
    const val = q('#chq_no').value || '';
    const out = q('#out_chq_no'); if (out) out.textContent = 'CHQ NO: ' + val;
    const previewI7 = q('#I7'); if (previewI7) previewI7.textContent = val;
    try { recalcAll(); } catch (e) { }
  });
  q('#chq_date')?.addEventListener('input', () => { const el = q('#out_chq_date'); if (el) el.textContent = 'CHQ DT: ' + formatDate(q('#chq_date').value); try { recalcAll(); } catch (e) { } });
  q('#bank')?.addEventListener('input', () => { const el = q('#out_bank'); if (el) el.textContent = 'BANK: ' + q('#bank').value; try { recalcAll(); } catch (e) { } });

  // Import removed per user request — Excel is only reference

  // Simplified export: use quickDownloadPNG to avoid CORS/fetch/Firebase flows and provide a
  // simple "Download PNG" experience. This intentionally skips complex inlining and server
  // upload attempts so users can reliably save an image.

  // Small transient toast helper
  function showToast(msg, timeout = 2200) {
    try {
      let t = document.getElementById('_patti_toast');
      if (!t) { t = document.createElement('div'); t.id = '_patti_toast'; t.style.position = 'fixed'; t.style.right = '16px'; t.style.top = '16px'; t.style.background = 'rgba(0,0,0,0.8)'; t.style.color = '#fff'; t.style.padding = '8px 12px'; t.style.borderRadius = '6px'; t.style.zIndex = 200000; t.style.fontSize = '13px'; document.body.appendChild(t); }
      t.textContent = msg;
      t.style.opacity = '1';
      clearTimeout(t._timeout);
      t._timeout = setTimeout(() => { try { t.style.transition = 'opacity 300ms'; t.style.opacity = '0'; setTimeout(() => { try { t.remove(); } catch (e) { } }, 320); } catch (e) { } }, timeout);
    } catch (e) { try { alert(msg); } catch (_) { } };
  }

  q('#exportBtn')?.addEventListener('click', async () => {
    try {
      await quickDownloadPNG({ filename: 'patti-note.png', scaleMultiplier: 2 });
      showToast('Export PNG successful');
    } catch (e) {
      console.warn('Quick export failed', e);
      // fall back to informing user how to proceed
      showToast('Export PNG failed');
      alert('Quick export failed: ' + (e && e.message ? e.message : String(e)) + '\n\nIf this is due to cross-origin images, try hosting images locally or use the Export Diagnostic to identify problematic assets.');
    }
  });

  // --- Export diagnostic tooling: scan page for likely cross-origin/tainting assets ---
  async function scanForTaintingAssets() {
    const results = [];
    try {
      // Images
      const imgs = Array.from(document.images || []);
      imgs.forEach(img => {
        try {
          const src = img.currentSrc || img.src;
          if (!src) return;
          // If origin differs from location.origin, flag it
          const url = new URL(src, location.href);
          if (url.origin !== location.origin) results.push({ type: 'image', src, reason: 'cross-origin' });
        } catch (e) { }
      });

      // Stylesheets: external CSS files that may include fonts/background images
      for (const sheet of Array.from(document.styleSheets || [])) {
        try {
          if (sheet.href) {
            const sUrl = new URL(sheet.href, location.href);
            if (sUrl.origin !== location.origin) results.push({ type: 'stylesheet', src: sheet.href, reason: 'cross-origin stylesheet' });
          }
        } catch (e) { }
      }

      // Inline background images (CSS background-image) from elements
      const all = Array.from(document.querySelectorAll('*'));
      all.forEach(el => {
        try {
          const style = window.getComputedStyle(el);
          if (!style) return;
          const bg = style.getPropertyValue('background-image');
          if (bg && bg !== 'none') {
            // extract url(...) entries
            const urls = [];
            const re = /url\(([^)]+)\)/g; let m;
            while ((m = re.exec(bg)) !== null) {
              let u = m[1].trim().replace(/^['"]|['"]$/g, '');
              if (u && !u.startsWith('data:')) {
                try { const nu = new URL(u, location.href); if (nu.origin !== location.origin) results.push({ type: 'background-image', src: u, element: el.tagName, reason: 'cross-origin background-image' }); } catch (e) { }
              }
            }
          }
        } catch (e) { }
      });

      // Fonts referenced via @font-face in styleSheets (best-effort)
      for (const sheet of Array.from(document.styleSheets || [])) {
        try {
          const rules = sheet.cssRules || sheet.rules;
          for (const r of Array.from(rules || [])) {
            try {
              if (r.type === CSSRule.FONT_FACE_RULE || String(r.cssText || '').toLowerCase().includes('@font-face')) {
                const txt = r.cssText || '';
                const re = /url\(([^)]+)\)/g; let m;
                while ((m = re.exec(txt)) !== null) {
                  let u = m[1].trim().replace(/^['"]|['"]$/g, ''); if (u && !u.startsWith('data:')) { try { const nu = new URL(u, location.href); if (nu.origin !== location.origin) results.push({ type: 'font', src: u, reason: 'font from external origin' }); } catch (e) { } }
                }
              }
            } catch (e) { }
          }
        } catch (e) { }
      }
    } catch (err) { console.warn('scanForTaintingAssets failed', err); }
    // dedupe by src
    const seen = new Set(); const out = [];
    results.forEach(r => { if (r.src && !seen.has(r.src)) { seen.add(r.src); out.push(r); } });
    return out;
  }

  // map of asset src -> dataUrl replacements provided by user (same-origin replacements)
  if (typeof window !== 'undefined' && !window._patti_asset_replacements) window._patti_asset_replacements = {};

  // Show a modal to let the user upload replacements for cross-origin assets so PNG rasterization can succeed.
  function showAssetReplacementModal(items) {
    return new Promise((resolve) => {
      try {
        // dedupe by src
        const uniq = [];
        const seen = new Set();
        items.forEach(it => { if (it && it.src && !seen.has(it.src)) { seen.add(it.src); uniq.push(it); } });

        const modal = document.createElement('div'); modal.style.position = 'fixed'; modal.style.inset = '0'; modal.style.background = 'rgba(0,0,0,0.6)'; modal.style.display = 'flex'; modal.style.alignItems = 'center'; modal.style.justifyContent = 'center'; modal.style.zIndex = 100000;
        const box = document.createElement('div'); box.style.background = '#fff'; box.style.padding = '16px'; box.style.borderRadius = '8px'; box.style.maxWidth = '880px'; box.style.width = '90%'; box.style.maxHeight = '80%'; box.style.overflow = 'auto';
        box.innerHTML = `<h3>Cross-origin assets detected</h3><p>The page includes external assets that may prevent client-side PNG export. You can upload replacements (local files) for these assets so PNG export will work. Uploading creates same-origin data URLs used only in this export.</p>`;
        const list = document.createElement('div'); list.style.display = 'grid'; list.style.gap = '8px'; list.style.marginTop = '8px';
        uniq.forEach(it => {
          const row = document.createElement('div'); row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px';
          const label = document.createElement('div'); label.style.flex = '1'; label.style.wordBreak = 'break-all'; label.textContent = it.src;
          const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.style.flex = '0 0 220px';
          const thumb = document.createElement('div'); thumb.style.width = '72px'; thumb.style.height = '48px'; thumb.style.border = '1px solid #ddd'; thumb.style.backgroundSize = 'cover'; thumb.style.backgroundPosition = 'center center';
          input.addEventListener('change', async (e) => {
            const f = e.target.files && e.target.files[0]; if (!f) return; try { const fr = new FileReader(); fr.onload = () => { window._patti_asset_replacements[it.src] = fr.result; thumb.style.backgroundImage = `url(${fr.result})`; }; fr.readAsDataURL(f); } catch (err) { console.warn('Failed to load replacement', err); }
          });
          row.appendChild(label); row.appendChild(input); row.appendChild(thumb); list.appendChild(row);
        });
        box.appendChild(list);
        const actions = document.createElement('div'); actions.style.display = 'flex'; actions.style.justifyContent = 'flex-end'; actions.style.gap = '8px'; actions.style.marginTop = '12px';
        const skip = document.createElement('button'); skip.textContent = 'Continue without replacements'; skip.className = 'btn-secondary';
        const use = document.createElement('button'); use.textContent = 'Use replacements and continue'; use.className = 'btn-primary';
        const cancel = document.createElement('button'); cancel.textContent = 'Cancel export'; cancel.className = 'btn-danger';
        actions.appendChild(cancel); actions.appendChild(skip); actions.appendChild(use);
        box.appendChild(actions); modal.appendChild(box); document.body.appendChild(modal);

        skip.addEventListener('click', () => { modal.remove(); resolve(true); });
        use.addEventListener('click', () => { modal.remove(); resolve(true); });
        cancel.addEventListener('click', () => { modal.remove(); resolve(false); });
      } catch (e) { console.warn('asset replacement modal failed', e); resolve(true); }
    });
  }

  // Export diagnostic removed per request.

  // diagRetryServer removed — client-side PNG export only

  q('#copyBtn')?.addEventListener('click', async () => {
    const copyBtn = q('#copyBtn');
    const origHTML = copyBtn ? copyBtn.innerHTML : '';

    if (copyBtn) {
      copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16.01"/></svg> Copying…`;
      copyBtn.disabled = true;
    }

    try {
      try { recalcAll(); } catch (_) { }
      await new Promise(res => setTimeout(res, 150));

      const blob = await getPreviewBlob();

      // 1. Try modern Clipboard API (works in Chrome/Edge)
      if (navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          showToast('✅ Image copied to clipboard!');
          return;
        } catch (e) {
          console.warn('Clipboard API failed, trying fallback:', e);
        }
      }

      // 2. Fallback: open as data URL in new tab so user can right-click → Copy Image
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });

      const w = window.open('', '_blank');
      if (w) {
        w.document.write(`<!DOCTYPE html><html><head><title>Patti Image</title>
          <style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1e293b;}
          img{max-width:100%;max-height:100vh;border-radius:8px;box-shadow:0 20px 40px rgba(0,0,0,0.4);}</style></head>
          <body><img src="${dataUrl}" alt="Patti Note"/></body></html>`);
        w.document.close();
        showToast('📋 Opened in new tab — right-click the image to copy!');
      } else {
        showToast('⚠️ Popup blocked — trying download instead');
        // Last resort: trigger a download
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'patti-note.png';
        a.click();
      }

    } catch (err) {
      console.error('Copy Image failed:', err);
      showToast('❌ Copy failed. Use Export PNG instead.');
    } finally {
      if (copyBtn) {
        setTimeout(() => {
          copyBtn.innerHTML = origHTML;
          copyBtn.disabled = false;
        }, 1500);
      }
    }
  });

  // Explicit 'Open image' button — shows the image in a full-screen in-page overlay
  // instead of a new tab, so no popup-blocker issues.
  q('#openImageBtn')?.addEventListener('click', async () => {
    const btn = q('#openImageBtn');
    const origHTML = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = '⏳ Loading…'; btn.disabled = true; }

    try {
      try { recalcAll(); } catch (_) { }
      await new Promise(res => setTimeout(res, 150));

      const blob = await getPreviewBlob();
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });

      // Remove existing overlay if present
      document.getElementById('_img_overlay')?.remove();

      // Build full-screen overlay
      const overlay = document.createElement('div');
      overlay.id = '_img_overlay';
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', background: 'rgba(15,23,42,0.92)',
        zIndex: '999998', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '1.5rem', animation: 'fadeIn 0.25s ease both',
        backdropFilter: 'blur(6px)'
      });

      // Top bar
      const bar = document.createElement('div');
      Object.assign(bar.style, {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        width: '100%', maxWidth: '800px', marginBottom: '0.75rem'
      });

      const title = document.createElement('span');
      title.textContent = 'Patti Preview';
      Object.assign(title.style, { color: '#fff', fontFamily: 'Inter,sans-serif', fontWeight: '600', fontSize: '0.95rem' });

      const btnGroup = document.createElement('div');
      Object.assign(btnGroup.style, { display: 'flex', gap: '0.5rem' });

      // Save / download button
      const _isMobile = window.matchMedia('(hover:none) and (pointer:coarse)').matches
        || /android|iphone|ipad|ipod/i.test(navigator.userAgent);

      let actionBtn;
      if (_isMobile) {
        // Mobile: Share / Copy button
        actionBtn = document.createElement('button');
        actionBtn.textContent = '📤 Share / Copy';
        Object.assign(actionBtn.style, {
          background: '#10b981', color: '#fff', borderRadius: '8px',
          padding: '0.45rem 0.9rem', fontFamily: 'Inter,sans-serif',
          fontWeight: '600', fontSize: '0.8rem', border: 'none', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center'
        });
        actionBtn.onclick = async () => {
          try {
            const file = new File([blob], 'patti-note.png', { type: 'image/png' });
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: 'Patti Note' });
              return;
            }
            if (navigator.clipboard && window.ClipboardItem) {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
              showToast('✅ Copied to clipboard!');
              return;
            }
            showToast('Long-press the image below to save/copy it.');
          } catch (e) {
            if (e.name !== 'AbortError') showToast('Could not share: ' + (e.message || e));
          }
        };
      } else {
        // Desktop: Save PNG download link
        actionBtn = document.createElement('a');
        actionBtn.href = dataUrl;
        actionBtn.download = 'patti-note.png';
        actionBtn.textContent = '⬇ Save PNG';
        Object.assign(actionBtn.style, {
          background: '#10b981', color: '#fff', borderRadius: '8px',
          padding: '0.45rem 0.9rem', fontFamily: 'Inter,sans-serif',
          fontWeight: '600', fontSize: '0.8rem', textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center'
        });
      }

      // Close button
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕ Close';
      Object.assign(closeBtn.style, {
        background: 'rgba(255,255,255,0.12)', color: '#fff', border: 'none',
        borderRadius: '8px', padding: '0.45rem 0.9rem',
        fontFamily: 'Inter,sans-serif', fontWeight: '600', fontSize: '0.8rem',
        cursor: 'pointer'
      });
      closeBtn.onclick = () => overlay.remove();

      btnGroup.append(actionBtn, closeBtn);
      bar.append(title, btnGroup);

      // Image
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = 'Patti Note';
      Object.assign(img.style, {
        maxWidth: '100%', maxHeight: 'calc(100vh - 100px)', borderRadius: '12px',
        boxShadow: '0 30px 60px rgba(0,0,0,0.5)', objectFit: 'contain'
      });

      overlay.append(bar, img);
      // Close on backdrop click
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);

      showToast('🖼️ Use "Save PNG" to download');
    } catch (e) {
      console.error('Open Image failed:', e);
      showToast('❌ Could not open image. Try Export PNG.');
    } finally {
      if (btn) {
        setTimeout(() => { btn.innerHTML = origHTML; btn.disabled = false; }, 1000);
      }
    }
  });

  // Save to Pattis button (stores dataURL in localStorage and syncs to Firebase)
  const _savePattisBtn = q('#save_pattis');
  if (_savePattisBtn && !_savePattisBtn.dataset.wired) {
    _savePattisBtn.dataset.wired = '1'; // guard against duplicate listener registration
    _savePattisBtn.addEventListener('click', async () => {
      const btn = q('#save_pattis');
      const saveSvg = `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
      if (btn) { btn.disabled = true; btn.innerHTML = saveSvg + ' Saving...'; }
      try {
        try { recalcAll(); } catch (e) { }
        // Pre-generate blob so we can inspect type and show helpful messages
        let blob;
        try {
          blob = await getPreviewBlob();
        } catch (genErr) {
          console.error('Preview generation failed:', genErr);
          alert('Preview generation failed: ' + (genErr && genErr.message ? genErr.message : String(genErr)));
          throw genErr;
        }
        // saveToPattis handles BOTH local storage AND Firebase upload internally.
        // Do NOT call uploadBlobAndEnsurePng separately — that would cause duplicate Firebase entries.
        await saveToPattis(blob);
        if (btn) { btn.innerHTML = saveSvg + ' Saved ✓'; }
        showToast('✅ Saved! View in Pattis Gallery.');
        setTimeout(() => { if (btn) { btn.innerHTML = saveSvg + ' Save to Pattis'; btn.disabled = false; } }, 2000);
        return; // skip finally re-enable (done in setTimeout above)
      } catch (e) {
        alert('Failed to save: ' + (e && e.message ? e.message : e));
        if (btn) btn.innerHTML = saveSvg + ' Save to Pattis';
      } finally { if (btn) btn.disabled = false; }
    });
  }


  q('#go_pattis')?.addEventListener('click', () => { window.location.href = 'pattis.html'; });

  // Share via WhatsApp removed per user request. Button (if present) will be hidden.
  const _shareBtn = q('#share_whatsapp'); if (_shareBtn) { _shareBtn.style.display = 'none'; }

  // capture initial values for all form controls so Reset restores them instead of reloading the page
  const formControls = Array.from(document.querySelectorAll('input, textarea, select'));
  const initialValues = {};
  formControls.forEach(el => initialValues[el.id || el.name || el.dataset.key || ('el_' + Math.random().toString(36).slice(2))] = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value);

  q('#resetBtn')?.addEventListener('click', () => {
    // restore captured values
    formControls.forEach(el => {
      const key = el.id || el.name || el.dataset.key;
      if (!key) return;
      const val = initialValues[key];
      if (typeof val === 'undefined') return;
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = val;
      else el.value = val;
      // trigger input/blur handlers where appropriate
      try { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { }
    });
    // ensure UI reflects restored values
    try { recalcAll(); } catch (e) { }
  });

  // expose a small diagnostic widget to check clipboard capabilities
  async function updateClipboardStatus() {
    const el = q('#clipboardText');
    const dot = q('#clipboardDots');

    try {
      const isSecure = window.isSecureContext === true;
      const hasClip = !!(navigator.clipboard);
      const hasClipboardItem = !!window.ClipboardItem;
      const hasHtml2Canvas = !!window.html2canvas;

      let perm = 'unknown';
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const p = await navigator.permissions.query({ name: 'clipboard-write' });
          perm = p.state;
        }
      } catch (e) {
        perm = 'unavailable';
      }

      const parts = [];
      parts.push(isSecure ? '🔒 secure' : '⚠️ insecure');
      parts.push(hasClip ? '📋 clipboard API' : '❌ no clipboard API');
      parts.push(hasClipboardItem ? '🖼️ ClipboardItem' : '❌ no ClipboardItem');
      // indicate if Chrome has advanced clipboardWrite support
      const isChrome = /Chrome/.test(navigator.userAgent || '') && !/Edge|OPR|Brave|Chromium/.test(navigator.userAgent || '');
      if (isChrome && hasClipboard) {
        parts.push('⚙️ Chrome: may require permission prompt');
      }
      parts.push(hasHtml2Canvas ? '🎨 html2canvas' : '⚠️ no html2canvas');
      if (perm !== 'unknown') parts.push(`📝 perm:${perm}`);

      const txt = parts.join(' | ');
      if (el) el.textContent = txt;

      const isReady = hasClipboardItem && isSecure && hasClip;
      if (dot) {
        dot.textContent = isReady ? '✅' : '❌';
        dot.style.color = isReady ? '#1b7a1b' : '#b22222';
      }

      console.log('Clipboard status:', { isSecure, hasClip, hasClipboardItem, hasHtml2Canvas, perm });

    } catch (err) {
      console.error('Error checking clipboard status:', err);
      if (el) el.textContent = 'Error checking clipboard status';
      if (dot) {
        dot.textContent = '❌';
        dot.style.color = '#b22222';
      }
    }
  }

  // High-res preview removed; provide a single Download PDF action below.

  q('#downloadPdfBtn')?.addEventListener('click', async () => {
    try {
      try { recalcAll(); } catch (e) { }
      // Generate a high-quality image of the preview first
      const res = await quickDownloadPNG({ filename: 'patti-highres.png', scaleMultiplier: 4, returnBlob: true });
      const blob = res && res.blob ? res.blob : res;
      if (!blob) throw new Error('Failed to generate image for PDF');
      // Create A5 PDF (148 x 210 mm) in portrait; fit image into page with margins
      let jsPDFctor = null;
      try { if (window.jspdf && window.jspdf.jsPDF) jsPDFctor = window.jspdf.jsPDF; } catch (e) { }
      if (!jsPDFctor && window.jsPDF) jsPDFctor = window.jsPDF;
      if (!jsPDFctor) throw new Error('jsPDF not loaded');

      // Convert blob to dataURL
      const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
      // Create an image to get dimensions
      const img = new Image(); img.src = dataUrl; await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
      const imgW = img.naturalWidth || img.width; const imgH = img.naturalHeight || img.height;

      // A5 page in mm (landscape): 210 x 148
      const pageW = 210; const pageH = 148; const margin = 8; // mm
      const contentW = pageW - margin * 2; const contentH = pageH - margin * 2;
      // Convert px->mm assuming 96 DPI
      const pxToMm = (px) => (px * 25.4) / 96;
      const imgWmm = pxToMm(imgW); const imgHmm = pxToMm(imgH);
      // Fit image within content box while preserving aspect ratio
      let drawW = contentW; let drawH = (imgHmm * contentW) / imgWmm;
      if (drawH > contentH) { drawH = contentH; drawW = (imgWmm * contentH) / imgHmm; }

      const pdf = new jsPDFctor({ unit: 'mm', format: 'a5', orientation: 'landscape' });
      const x = (pageW - drawW) / 2; const y = (pageH - drawH) / 2;
      pdf.addImage(dataUrl, 'PNG', x, y, drawW, drawH);
      pdf.save('patti-note.pdf');
    } catch (e) { console.error('Download PDF failed', e); alert('Download PDF failed: ' + (e && e.message ? e.message : String(e))); }
  });

  // Export generated blob as PDF using jsPDF
  async function exportBlobAsPDF(blob, filename = 'patti.pdf') {
    if (!blob) throw new Error('No blob provided');
    // convert blob to dataURL
    const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    // load jsPDF (umd exposes window.jspdf ?)
    const jsPDFlib = window.jspdf || (window.jspdf === undefined && window.jspdf);
    // try UMD namespace
    let jsPDF = null;
    try { if (window.jspdf && window.jspdf.jsPDF) jsPDF = window.jspdf.jsPDF; } catch (e) { }
    if (!jsPDF && typeof window.jspdf === 'function') jsPDF = window.jspdf;
    if (!jsPDF) {
      // attempt to read from global (older builds)
      if (window.jsPDF) jsPDF = window.jsPDF;
    }
    if (!jsPDF) throw new Error('jsPDF not loaded');

    // Create an image to read dimensions
    const img = new Image(); img.src = dataUrl;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const imgW = img.naturalWidth || img.width; const imgH = img.naturalHeight || img.height;

    // Create PDF page matching image aspect ratio. Use mm units.
    const pxToMm = (px) => (px * 25.4) / 96; // assume 96 DPI for browsers
    const pdfW = Math.max(210, Math.round(pxToMm(imgW))); // at least A4 width
    const pdfH = Math.max(297, Math.round(pxToMm(imgH)));
    const pdf = new jsPDF({ unit: 'mm', format: [pdfW, pdfH] });
    // Place image to fill page while preserving aspect
    pdf.addImage(dataUrl, 'PNG', 0, 0, pdfW, pdfH);
    // Save
    pdf.save(filename);
    return true;
  }

  q('#highresPDF')?.addEventListener('click', async () => {
    const modal = q('#highresModal'); if (!modal) return; const blob = modal._patti_blob; if (!blob) { alert('No generated image available'); return; }
    try {
      await exportBlobAsPDF(blob, 'patti-note.pdf');
    } catch (e) { console.error('Export to PDF failed', e); alert('PDF export failed: ' + (e && e.message ? e.message : String(e))); }
  });
  q('#clipboardCheck')?.addEventListener('click', updateClipboardStatus);
  // run once at startup
  updateClipboardStatus().catch(() => { });
  // add a diagnostic copy test when the same button is clicked while holding Alt (or long-press)
  q('#clipboardCheck')?.addEventListener('dblclick', async () => {
    // dblclick will attempt an actual copy diagnostic so user can test without Export
    await runCopyDiagnostic();
  });

  // Also expose a programmatic diagnostic function
  async function runCopyDiagnostic() {
    const txt = q('#clipboardText');
    const dot = q('#clipboardDots');
    if (txt) txt.textContent = 'Running copy diagnostic...';
    if (dot) { dot.textContent = '…'; dot.style.color = '#666'; }
    try {
      const node = q('#note');
      // generate blob
      let blob;
      if (window.html2canvas) {
        const canvas = await html2canvas(node, { backgroundColor: '#fff', scale: window.devicePixelRatio || 1 });
        blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      } else {
        blob = await domtoBlob(node, 2);
      }
      if (!blob) throw new Error('Failed to create image blob');

      // try ClipboardItem
      if (navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          if (txt) txt.textContent = 'Diagnostic: copied via ClipboardItem';
          if (dot) { dot.textContent = '✅'; dot.style.color = '#1b7a1b'; }
          return { ok: true, method: 'ClipboardItem' };
        } catch (e) {
          console.warn('Diagnostic primary copy failed', e);
          // try execCommand fallback
          const ok = await tryExecCommandCopy(blob);
          if (ok) {
            if (txt) txt.textContent = 'Diagnostic: copied via execCommand fallback';
            if (dot) { dot.textContent = '✅'; dot.style.color = '#1b7a1b'; }
            return { ok: true, method: 'execCommand' };
          }
          // final fallback: try direct PNG download, then open blob URL if possible
          if (txt) txt.textContent = 'Diagnostic: copy failed, attempting download fallback';
          if (dot) { dot.textContent = '❌'; dot.style.color = '#b22222'; }
          try {
            const png = await fetchAndEnsurePngBlob(URL.createObjectURL(blob));
            triggerDownloadBlob(png, 'patti-note.png');
          } catch (e) {
            const url = URL.createObjectURL(blob);
            const w = window.open(url, '_blank');
            if (!w) { const a = document.createElement('a'); a.href = url; a.download = 'patti-note.png'; a.click(); }
          }
          return { ok: false, method: 'download' };
        }
      } else {
        // no ClipboardItem support, try execCommand directly
        const ok = await tryExecCommandCopy(blob);
        if (ok) {
          if (txt) txt.textContent = 'Diagnostic: copied via execCommand fallback';
          if (dot) { dot.textContent = '✅'; dot.style.color = '#1b7a1b'; }
          return { ok: true, method: 'execCommand' };
        }
        if (txt) txt.textContent = 'Diagnostic: copy not supported, opened download fallback';
        if (dot) { dot.textContent = '❌'; dot.style.color = '#b22222'; }
        try { const png = await fetchAndEnsurePngBlob(URL.createObjectURL(blob)); triggerDownloadBlob(png, 'patti-note.png'); } catch (e) { const url = URL.createObjectURL(blob); const w = window.open(url, '_blank'); if (!w) { const a = document.createElement('a'); a.href = url; a.download = 'patti-note.png'; a.click(); } }
        return { ok: false, method: 'download' };
      }
    } catch (err) {
      console.error('Copy diagnostic failed', err);
      if (q('#clipboardText')) q('#clipboardText').textContent = 'Diagnostic error: ' + (err && err.message ? err.message : String(err));
      if (q('#clipboardDots')) { q('#clipboardDots').textContent = '❌'; q('#clipboardDots').style.color = '#b22222'; }
      return { ok: false, error: err };
    }
  }
}

function removeDebugNodes() {
  // remove any elements that still contain the debug label text
  Array.from(document.querySelectorAll('*')).forEach(el => {
    try {
      if (el.textContent && el.textContent.includes('DEBUG - Miller')) el.remove();
    } catch (e) { }
  });
}

// small dom-to-blob using html2canvas-like approach but lightweight using foreignObject
async function domtoBlob(node, scaleMultiplier = 1) {
  // clone the node and replace form inputs with their current text values so serialization captures them
  const clone = node.cloneNode(true);
  // replace inputs, textareas and spans that may contain live values
  clone.querySelectorAll('input, textarea').forEach(inp => {
    const val = inp.value || '';
    const txt = document.createTextNode(val);
    inp.parentNode.replaceChild(txt, inp);
  });
  // Attempt to inline computed styles and external images/backgrounds into the clone
  // This is best-effort: it helps avoid canvas taint when stylesheets or images are same-origin or CORS-enabled.
  try {
    // Pairwise traversal to copy computed styles from original node to clone
    (function inlineStyles(orig, cl) {
      try {
        if (orig && cl && orig.nodeType === 1) {
          const cs = window.getComputedStyle(orig);
          if (cs && cs.cssText) cl.style.cssText = cs.cssText;
        }
      } catch (e) {/* ignore */ }
      const oChildren = Array.from(orig.children || []);
      const cChildren = Array.from(cl.children || []);
      for (let i = 0; i < Math.min(oChildren.length, cChildren.length); i++) inlineStyles(oChildren[i], cChildren[i]);
    })(node, clone);

    // Inline images and background images where possible
    async function inlineImagesAndBackgrounds(origRoot, cloneRoot) {
      const origImgs = Array.from(origRoot.querySelectorAll('img'));
      const cloneImgs = Array.from(cloneRoot.querySelectorAll('img'));
      for (let i = 0; i < Math.min(origImgs.length, cloneImgs.length); i++) {
        const o = origImgs[i]; const c = cloneImgs[i];
        try {
          const src = o.currentSrc || o.src;
          if (!src || src.startsWith('data:')) continue;
          // If a user provided a replacement for this src, use it
          try {
            const repl = (window && window._patti_asset_replacements) ? window._patti_asset_replacements[src] : null;
            if (repl) { c.src = repl; continue; }
          } catch (e) { }
          // Try to fetch the image as CORS-enabled resource
          try {
            const r = await fetch(src, { mode: 'cors' });
            if (r && r.ok) { const b = await r.blob(); const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); }); c.src = dataUrl; continue; }
          } catch (e) { /* can't fetch due to CORS or network - fall through to replacement attempt */ }
          // Try replacement again with a best-effort key match (strip query params)
          try {
            const key = src.split('?')[0]; const repl2 = (window && window._patti_asset_replacements) ? window._patti_asset_replacements[key] : null;
            if (repl2) { c.src = repl2; continue; }
          } catch (e) { }
        } catch (e) { /* can't inline due to CORS or network, skip */ }
      }

      // Background images
      const origEls = Array.from(origRoot.querySelectorAll('*'));
      const cloneEls = Array.from(cloneRoot.querySelectorAll('*'));
      for (let i = 0; i < Math.min(origEls.length, cloneEls.length); i++) {
        const o = origEls[i]; const c = cloneEls[i];
        try {
          const cs = window.getComputedStyle(o);
          const bg = cs && cs.backgroundImage;
          if (bg && bg !== 'none' && bg.indexOf('url(') !== -1) {
            const m = /url\(["']?([^"')]+)["']?\)/.exec(bg);
            if (m && m[1]) {
              const url = m[1];
              if (!url.startsWith('data:')) {
                try {
                  // Try replacement first
                  const repl = (window && window._patti_asset_replacements) ? (window._patti_asset_replacements[url] || window._patti_asset_replacements[url.split('?')[0]]) : null;
                  if (repl) { c.style.backgroundImage = `url('${repl}')`; continue; }
                  const r2 = await fetch(url, { mode: 'cors' });
                  if (r2 && r2.ok) { const b2 = await r2.blob(); const dataUrl2 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b2); }); c.style.backgroundImage = `url('${dataUrl2}')`; }
                } catch (e) { /* skip */ }
              }
            }
          }
        } catch (e) { /* skip */ }
      }
    }
    // run inlining but don't block too long — allow up to 2s for inlining
    const inlinePromise = inlineImagesAndBackgrounds(node, clone);
    const timeout = new Promise((res) => setTimeout(res, 2000));
    await Promise.race([inlinePromise, timeout]);
  } catch (e) { console.warn('Inlining styles/images failed (best-effort)', e); }
  // ensure any dedicated value spans are present as text
  clone.querySelectorAll('span').forEach(sp => {
    // leave structural spans but ensure their textContent is preserved (they are preserved by clone)
  });

  // Compute element size robustly. getBoundingClientRect can return 0 when
  // the element is not laid out or hidden; fall back to other metrics and
  // use sensible defaults to avoid creating zero-sized canvases/SVGs.
  const rect = (node && node.getBoundingClientRect) ? node.getBoundingClientRect() : { width: 0, height: 0 };
  let width = rect.width || node.offsetWidth || node.clientWidth || node.scrollWidth || 0;
  let height = rect.height || node.offsetHeight || node.clientHeight || node.scrollHeight || 0;
  if (!width || width < 1) width = 800;
  if (!height || height < 1) height = 600;
  // collect inline CSS from document.styleSheets where same-origin
  let cssText = '';
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules || sheet.rules;
      for (const r of Array.from(rules)) cssText += r.cssText + '\n';
    } catch (e) {
      // likely cross-origin stylesheet — skip it
    }
  }

  // Render SVG at devicePixelRatio to produce a higher-resolution raster with crisper lines.
  // allow caller to request extra scaling for higher-resolution exports
  const dpr = (window.devicePixelRatio || 1) * (scaleMultiplier || 1);
  const sw = Math.ceil(width * dpr);
  const sh = Math.ceil(height * dpr);
  // use viewBox to preserve CSS layout while scaling the output
  const svg = `<?xml version="1.0" encoding="utf-8"?>
  <svg xmlns='http://www.w3.org/2000/svg' width='${sw}' height='${sh}' viewBox='0 0 ${Math.ceil(width)} ${Math.ceil(height)}' preserveAspectRatio='xMinYMin meet'>
    <style>
      svg{shape-rendering:crispEdges;stroke-linecap:square;-webkit-font-smoothing:antialiased;}
      ${cssText}
    </style>
    <foreignObject width='100%' height='100%'>
      ${new XMLSerializer().serializeToString(clone)}
    </foreignObject>
  </svg>`;
  const svg64 = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svg64);
  const img = new Image();
  img.width = sw; img.height = sh;
  img.src = url;
  try {
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const canvas = document.createElement('canvas'); canvas.width = sw; canvas.height = sh;
    const ctx = canvas.getContext('2d');
    // draw a white background and disable smoothing for crisp grid lines
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = false;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, sw, sh);
    URL.revokeObjectURL(url);
    // attempt to produce raster PNG; this may throw if canvas tainted
    const rasterBlob = await new Promise((res, rej) => {
      try { canvas.toBlob(res, 'image/png'); } catch (e) { rej(e); }
    });
    if (!rasterBlob) throw new Error('Canvas produced no blob');
    return rasterBlob;
  } catch (err) {
    // Likely a tainted canvas or image load error. As a robust fallback, return the SVG itself
    // This preserves the visual layout and allows saving/uploading even when rasterization is blocked.
    console.warn('domtoBlob rasterization failed, returning SVG fallback blob:', err);
    try { URL.revokeObjectURL(url); } catch (e) { }
    return svg64;
  }

  // --- Clipboard helpers (shared) ------------------------------------------
  // Convert a Blob to a data URL
  window.blobToDataURL = function (blob) {
    return new Promise((res, rej) => {
      try {
        const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob);
      } catch (e) { rej(e); }
    });
  };

  // ExecCommand fallback: insert an <img> into a temporary contenteditable and execCommand('copy')
  window.tryExecCommandCopy = async function (blob) {
    try {
      const dataUrl = await window.blobToDataURL(blob);
      const img = new Image(); img.src = dataUrl;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; setTimeout(res, 500); });

      const container = document.createElement('div');
      container.contentEditable = 'true';
      container.style.position = 'fixed'; container.style.left = '-99999px'; container.style.top = '-99999px'; container.style.opacity = '0';
      container.appendChild(img);
      document.body.appendChild(container);

      const range = document.createRange(); range.selectNodeContents(img);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);

      const ok = document.execCommand('copy');

      sel.removeAllRanges(); document.body.removeChild(container);
      return !!ok;
    } catch (err) { console.warn('tryExecCommandCopy failed', err); try { /* cleanup */ } catch (e) { } return false; }
  };

  // Robustly copy a Blob to clipboard: try ClipboardItem -> execCommand -> writeText(dataURL)
  window.copyBlobToClipboard = async function (blob) {
    try {
      let pngBlob = blob;
      // If blob is not PNG and we have a converter, try to convert
      const t = String(blob && blob.type || '').toLowerCase();
      if (window.ensurePngBlob && !t.includes('png')) {
        try { const p = await window.ensurePngBlob(blob); if (p) pngBlob = p; } catch (e) { console.warn('ensurePngBlob conversion failed', e); }
      }

      // Preferred: ClipboardItem with image/png
      if (navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
          return { ok: true, method: 'ClipboardItem' };
        } catch (e) { console.warn('ClipboardItem write failed', e); }
      }

      // ExecCommand fallback
      try {
        const ok = await window.tryExecCommandCopy(pngBlob || blob);
        if (ok) return { ok: true, method: 'execCommand' };
      } catch (e) { console.warn('execCommand fallback failed', e); }

      // Final fallback: copy data URL as text
      try {
        const dataUrl = await window.blobToDataURL(pngBlob || blob);
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(dataUrl);
          return { ok: true, method: 'writeText' };
        }
      } catch (e) { console.warn('writeText fallback failed', e); }

      return { ok: false };
    } catch (err) { console.error('copyBlobToClipboard failed', err); return { ok: false, error: err }; }
  };
}

// initial
// debug: log presence of key elements to help diagnose visibility issues
console.log('startup: miller_name=', !!q('#miller_name'), 'B1_value=', !!q('#B1_value'), 'note=', !!q('#note'), 'exportBtn=', !!q('#exportBtn'));
// Only auto-run wiring in real browser environment. Tests or Node can set window.__PATTI_NO_AUTO to skip.
try {
  if (typeof window !== 'undefined' && !window.__PATTI_NO_AUTO) {
    wire(); recalcAll();
  }
} catch (e) { /* ignore when run in non-browser contexts */ }


