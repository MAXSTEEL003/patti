const http = require('http');
const s = http.createServer((req,res)=> res.end('ok'));
s.on('error', e => { console.error('SERVER-ERR', e && e.code ? e.code + ' ' + e.message : e); process.exit(1); });
s.listen(4000, ()=> console.log('TEST-SERVER listening on 4000'));
