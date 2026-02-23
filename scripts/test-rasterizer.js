// Simple test script to POST a sample SVG to a rasterizer endpoint and save returned PNG
// Usage: node scripts/test-rasterizer.js <rasterizer_url> [api_key]
// Example: node scripts/test-rasterizer.js http://localhost:3000/rasterize myapikey

const fs = require('fs');
const path = require('path');
const url = process.argv[2];
const apiKey = process.argv[3] || '';

if(!url){
  console.error('Usage: node scripts/test-rasterizer.js <rasterizer_url> [api_key]');
  process.exit(1);
}

const sampleSvg = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns='http://www.w3.org/2000/svg' width='800' height='400'>
  <rect width='100%' height='100%' fill='#0ea5e9'/>
  <text x='50%' y='50%' font-family='Arial, sans-serif' font-size='36' fill='white' dominant-baseline='middle' text-anchor='middle'>Patti Rasterizer Test</text>
</svg>`;

(async ()=>{
  try{
    const payload = { type: 'svg', data: sampleSvg };
    const headers = { 'Content-Type': 'application/json' };
    if(apiKey) headers['X-API-KEY'] = apiKey;

    // Use global fetch if available (Node 18+), otherwise fall back to node-fetch
    let fetchFn;
    if(typeof fetch === 'function') fetchFn = fetch;
    else {
      try{ fetchFn = require('node-fetch'); }catch(e){ console.error('node-fetch is required on older Node versions. npm install node-fetch'); process.exit(1); }
    }

    const res = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    if(!res.ok){
      const txt = await res.text().catch(()=>'<no-text>');
      throw new Error('Rasterizer responded with ' + res.status + ': ' + txt);
    }

    const buf = await res.arrayBuffer();
    const out = Buffer.from(buf);
    const outPath = path.resolve(process.cwd(), 'rasterizer-test-output.png');
    fs.writeFileSync(outPath, out);
    console.log('Rasterizer test succeeded — saved to', outPath);
  }catch(err){
    console.error('Rasterizer test failed:', err);
    process.exit(2);
  }
})();
