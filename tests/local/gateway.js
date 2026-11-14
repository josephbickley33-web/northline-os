// LOCAL TEST ONLY: minimal stand-in for Supabase's API gateway + GoTrue, in front of PostgREST.
const http = require('http'), crypto = require('crypto'), { Client } = require('pg');
const SECRET = 'local-test-secret-local-test-secret-123456';
const db = new Client({ host:'/tmp', port:54329, user:'postgres', database:'nl2' }); db.connect();
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function sign(p){ const h = b64({alg:'HS256',typ:'JWT'}), b = b64(p); return h+'.'+b+'.'+crypto.createHmac('sha256',SECRET).update(h+'.'+b).digest('base64url'); }
function verify(t){ try { const [h,b,s] = t.split('.'); if (crypto.createHmac('sha256',SECRET).update(h+'.'+b).digest('base64url') !== s) return null; return JSON.parse(Buffer.from(b,'base64url')); } catch { return null; } }
const passwords = {}; // email -> password (memory)
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
      if (!verify(tok)) delete headers.authorization; // anon key is not a JWT we signed
      const p = http.request({ host:'127.0.0.1', port:3000, method:req.method, path:req.url.replace('/rest/v1',''), headers }, (pr) => {
        const h = {}; for (const [k,v] of Object.entries(pr.headers)) if (!k.startsWith('access-control-')) h[k]=v; res.writeHead(pr.statusCode, { ...h, ...cors }); pr.pipe(res); });
      p.on('error', e => send(res, 502, { message:e.message })); p.end(raw); return;
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
