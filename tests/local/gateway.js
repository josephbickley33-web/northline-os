// LOCAL TEST ONLY: minimal stand-in for Supabase's API gateway + GoTrue, in front of PostgREST.
const http = require('http'), crypto = require('crypto'), { Client } = require('pg');
const SECRET = 'local-test-secret-local-test-secret-123456';
const db = new Client({ host:'/tmp', port:54329, user:'postgres', database:'nl2' }); db.connect();
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function sign(p){ const h = b64({alg:'HS256',typ:'JWT'}), b = b64(p); return h+'.'+b+'.'+crypto.createHmac('sha256',SECRET).update(h+'.'+b).digest('base64url'); }
function verify(t){ try { const [h,b,s] = t.split('.'); if (crypto.createHmac('sha256',SECRET).update(h+'.'+b).digest('base64url') !== s) return null; return JSON.parse(Buffer.from(b,'base64url')); } catch { return null; } }
const passwords = {}; // email -> password (memory)
const SERVICE_KEY = 'local-service-key';
const files = new Map(); // storage path -> {type, buf}
async function asUser(sub, sql, params){ // run one statement as an authenticated user, with RLS
  const c = new Client({ host:'/tmp', port:54329, user:'postgres', database:'nl2' }); await c.connect();
  try { await c.query('begin'); await c.query("select set_config('request.jwt.claim.sub', $1, true)", [sub]); await c.query('set local role authenticated');
        const r = await c.query(sql, params); await c.query('commit'); return r; }
  catch (e) { await c.query('rollback').catch(()=>{}); throw e; } finally { await c.end(); } }
function userObj(r){ return { id:r.id, aud:'authenticated', role:'authenticated', email:r.email, user_metadata:r.raw_user_meta_data||{}, app_metadata:{provider:'email'}, created_at:r.created_at }; }
function session(r){ const now = Math.floor(Date.now()/1000); const exp = now+3600;
  return { access_token:sign({ sub:r.id, role:'authenticated', aud:'authenticated', email:r.email, exp, iat:now }), token_type:'bearer', expires_in:3600, expires_at:exp, refresh_token:'rt-'+r.id, user:userObj(r) }; }
const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'*', 'Access-Control-Allow-Methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'Access-Control-Expose-Headers':'Content-Range,Content-Profile' };
function send(res, code, obj){ res.writeHead(code, { ...cors, 'Content-Type':'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); }
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const chunks = []; for await (const c of req) chunks.push(c); const raw = Buffer.concat(chunks);
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/rest/v1/')) {
      const headers = { ...req.headers }; delete headers.host;
      const auth = headers.authorization || ''; const tok = auth.replace(/^Bearer /,'');
      if (tok === SERVICE_KEY || headers.apikey === SERVICE_KEY && tok === SERVICE_KEY) headers.authorization = 'Bearer ' + sign({ role:'service_role', exp:Math.floor(Date.now()/1000)+3600 });
      else if (!verify(tok)) delete headers.authorization; // anon key is not a JWT we signed
      const p = http.request({ host:'127.0.0.1', port:3000, method:req.method, path:req.url.replace('/rest/v1',''), headers }, (pr) => {
        const h = {}; for (const [k,v] of Object.entries(pr.headers)) if (!k.startsWith('access-control-')) h[k]=v; res.writeHead(pr.statusCode, { ...h, ...cors }); pr.pipe(res); });
      p.on('error', e => send(res, 502, { message:e.message })); p.end(raw); return;
    }
    if (url.pathname.startsWith('/functions/v1/')) { // proxy to the local Deno function server (real handlers)
      const headers = { ...req.headers }; delete headers.host;
      const p = http.request({ host:'127.0.0.1', port:54339, method:req.method, path:url.pathname.replace('/functions/v1',''), headers }, (pr) => {
        const h = {}; for (const [k,v] of Object.entries(pr.headers)) if (!k.startsWith('access-control-')) h[k]=v; res.writeHead(pr.statusCode, { ...h, ...cors }); pr.pipe(res); });
      p.on('error', e => send(res, 502, { message:'functions server: ' + e.message })); p.end(raw); return;
    }
    if (url.pathname.startsWith('/storage/v1/')) {
      const c = verify((req.headers.authorization||'').replace(/^Bearer /,''));
      const m = /^\/storage\/v1\/object\/(sign\/)?([^/]+)\/?(.*)$/.exec(url.pathname);
      if (!m) return send(res, 404, { message:'storage route' });
      const [, signRoute, bucket, rest] = m; const path = decodeURIComponent(rest);
      if (signRoute && req.method === 'GET') { const f = files.get(bucket + '/' + path); if (!f || url.searchParams.get('token') !== 'ok') return send(res, 404, { message:'not found' });
        res.writeHead(200, { ...cors, 'Content-Type': f.type }); return res.end(f.buf); }
      if (!c) return send(res, 401, { message:'login required', statusCode:'401', error:'Unauthorized' });
      if (signRoute && req.method === 'POST') { const b = JSON.parse(raw); const out = [];
        for (const p of (b.paths || [])) { const r = await asUser(c.sub, 'select 1 from storage.objects where bucket_id=$1 and name=$2', [bucket, p]).catch(() => ({ rows:[] }));
          out.push(r.rows.length ? { path:p, signedURL:'/object/sign/' + bucket + '/' + encodeURIComponent(p) + '?token=ok', error:null } : { path:p, signedURL:null, error:'Either the object does not exist or you do not have access to it' }); }
        return send(res, 200, out); }
      if (req.method === 'POST') {
        try { await asUser(c.sub, 'insert into storage.objects(bucket_id, name) values ($1, $2)', [bucket, path]); }
        catch (e) { return send(res, 403, { statusCode:'403', error:'Unauthorized', message:'new row violates row-level security policy: ' + e.message }); }
        files.set(bucket + '/' + path, { type:req.headers['content-type'] || 'application/octet-stream', buf:raw }); return send(res, 200, { Key: bucket + '/' + path, Id: path });
      }
      return send(res, 405, { message:'method' });
    }
    if (url.pathname === '/auth/v1/signup') {
      const b = JSON.parse(raw); const r = (await db.query('insert into auth.users(email, raw_user_meta_data) values ($1,$2) returning *', [b.email, b.data||{}])).rows[0];
      passwords[b.email] = b.password; return send(res, 200, session(r));
    }
    if (url.pathname === '/auth/v1/token') {
      const b = JSON.parse(raw);
      if (url.searchParams.get('grant_type') === 'refresh_token') { const id = String(b.refresh_token).slice(3); const r = (await db.query('select * from auth.users where id=$1',[id])).rows[0]; return r ? send(res,200,session(r)) : send(res,400,{error:'invalid_grant',error_description:'Invalid Refresh Token'}); }
      const r = (await db.query('select * from auth.users where email=$1', [b.email])).rows[0];
      if (!r || (passwords[b.email] && passwords[b.email] !== b.password) || (!passwords[b.email] && b.password !== 'password123'))
        return send(res, 400, { error:'invalid_grant', error_description:'Invalid login credentials', code:'invalid_credentials', msg:'Invalid login credentials' });
      return send(res, 200, session(r));
    }
    if (url.pathname === '/auth/v1/user') {
      const c = verify((req.headers.authorization||'').replace(/^Bearer /,'')); if (!c) return send(res, 401, { msg:'invalid JWT' });
      const r = (await db.query('select * from auth.users where id=$1', [c.sub])).rows[0]; return send(res, 200, userObj(r));
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204);
    if (url.pathname === '/auth/v1/recover') return send(res, 200, {});
    return send(res, 404, { message:'not in local gateway: '+url.pathname });
  } catch (e) { return send(res, 500, { message:e.message }); }
}).listen(54321, () => console.log('gateway on 54321'));
