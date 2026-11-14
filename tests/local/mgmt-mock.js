// LOCAL TEST ONLY: fake Supabase Management API backed by a local Postgres database.
const http = require('http'), { Client } = require('pg');
const db = new Client({ host:'/tmp', port:54329, user:'postgres', database:'nl3' }); db.connect();
const REF = 'abcdefghijklmnopqrst', calls = [];
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks).toString();
  const send = (code, o) => { res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(o)); };
  calls.push(req.method + ' ' + req.url); console.log(req.method, req.url, req.headers.authorization === 'Bearer sbp_test' ? 'auth-ok' : 'AUTH-MISSING');
  if (req.headers.authorization !== 'Bearer sbp_test') return send(401, { message:'Unauthorized' });
  if (req.method === 'GET' && req.url === `/v1/projects/${REF}`) return send(200, { id:REF, ref:REF, status:'ACTIVE_HEALTHY' });
  if (req.method === 'POST' && req.url === `/v1/projects/${REF}/database/query`) {
    try { await db.query(JSON.parse(body).query); return send(201, []); } catch (e) { return send(400, { message:e.message }); }
  }
  if (req.method === 'GET' && req.url === `/v1/projects/${REF}/api-keys?reveal=true`) return send(200, [
    { name:'anon', type:'legacy', api_key:'eyJhbGciOiJIUzI1NiJ9.test-anon.sig' }, { name:'service_role', type:'legacy', api_key:'eyJ.service.secret' },
    { name:'default', type:'publishable', api_key:'sb_publishable_test' }]);
  if (req.method === 'PATCH' && req.url === `/v1/projects/${REF}/config/auth`) { console.log('auth body', body); return send(200, JSON.parse(body)); }
  send(404, { message:'not mocked' });
}).listen(54400, () => console.log('mgmt mock on 54400'));
