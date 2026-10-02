import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
export function createApp({ dataDir = path.join(root, 'data'), adminPassword = process.env.STATZ_ADMIN_PASSWORD } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'db.json');
  const keyPath = path.join(dataDir, 'private.pem');
  if (!fs.existsSync(keyPath)) {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    fs.writeFileSync(keyPath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  }
  const privateKey = fs.readFileSync(keyPath);
  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  let db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, 'utf8')) : { users: [], keys: [] };
  const save = () => { fs.writeFileSync(dbPath + '.tmp', JSON.stringify(db, null, 2)); fs.renameSync(dbPath + '.tmp', dbPath); };
  const hash = password => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex'); };
  const check = (password, digest) => { const [salt, stored] = digest.split(':'); return crypto.timingSafeEqual(Buffer.from(stored, 'hex'), crypto.scryptSync(password, salt, 64)); };
  db.events ||= [];
  const expired = u => !!u.access_expires_at && Date.parse(u.access_expires_at) <= Date.now();
  const safeUser = u => { const { password, ...visible } = u; return {...visible,expired:expired(u)}; };
  const audit = (actor,action,target,details={}) => {
    db.events.unshift({id:crypto.randomUUID(),actor_name:actor.display_name,action,target_name:target.display_name||target.label||target.username||target.key,details,created_at:new Date().toISOString()});
    db.events=db.events.slice(0,1000);
  };
  let initialPassword;
  if (!db.users.length) {
    initialPassword = adminPassword || crypto.randomBytes(18).toString('base64url');
    db.users.push({ id: crypto.randomUUID(), username: 'admin', display_name: 'Administrador', password: hash(initialPassword), role: 'admin', approved: true, active: true }); save();
  }
  const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  const sign = u => { const body = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({ sub: u.id, username: u.username, name: u.display_name, role: u.role, ver: u.session_version || 0, exp: Math.floor(Date.now()/1000) + 86400 }); return body + '.' + crypto.sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url'); };
  const authenticate = req => {
    try {
      const token = (req.headers.authorization || '').replace(/^Bearer /, ''); const parts = token.split('.');
      if (parts.length !== 3 || !crypto.verify('RSA-SHA256', Buffer.from(parts[0]+'.'+parts[1]), publicKey, Buffer.from(parts[2], 'base64url'))) return null;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
      if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()/1000) return null;
      return db.users.find(u => u.id === payload.sub && u.active && u.approved && !expired(u) && (u.session_version || 0) === (payload.ver || 0)) || null;
    } catch { return null; }
  };
  const attempts = new Map();
  const server = http.createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    const origin = req.headers.origin;
    const origins = new Set((process.env.STATZ_ALLOWED_ORIGINS || 'http://tauri.localhost,https://tauri.localhost,tauri://localhost').split(','));
    if (origin && origins.has(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try {
      const url = new URL(req.url, 'http://localhost'); const route = url.pathname;
      if (route === '/api/health') return json(200, { ok: true, version: '1.3.2' });
      if (route === '/api/auth/public-key') return json(200, { public_key: publicKey });
      if (!route.startsWith('/api/')) {
        if (req.method !== 'GET') return json(405, { error: 'Método não permitido.' });
        if (route === '/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); return res.end(`window.SQUADCALL_AUTH_API=${JSON.stringify(process.env.STATZ_API_URL || '')};window.STATZ_PUBLIC_KEY=${JSON.stringify(publicKey)};`); }
        const files = { '/': 'index.html', '/index.html': 'index.html', '/room-policy.js': 'room-policy.js', '/statz-mascot.png': 'statz-mascot.png' };
        if (!files[route]) return json(404, { error: 'Não encontrado.' });
        res.writeHead(200, { 'Content-Type': route.endsWith('.png') ? 'image/png' : route.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(root, 'web', files[route])));
      }
      let body = {};
      if (['POST', 'PATCH'].includes(req.method)) {
        let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16384) return json(413, { error: 'Dados muito grandes.' }); }
        try { body = JSON.parse(raw || '{}'); if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error(); } catch { return json(400, { error: 'JSON inválido.' }); }
      }
      if (route === '/api/auth/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress; const now = Date.now(); const recent = (attempts.get(ip) || []).filter(t => t > now-60000);
        if (recent.length >= 10) return json(429, { error: 'Aguarde um minuto e tente novamente.' }); recent.push(now); attempts.set(ip, recent);
        const u = db.users.find(u => u.username === String(body.username || '').toLowerCase());
        if (!u || typeof body.password !== 'string' || body.password.length > 256 || !check(body.password, u.password)) return json(401, { error: 'Usuário ou senha incorretos.' });
        if (!u.active || !u.approved) return json(403, { error: 'Conta bloqueada ou aguardando aprovação.' });
        if(expired(u)) return json(403,{error:'Acesso expirado. Solicite renovação.'});
        return json(200, { token: sign(u), user: safeUser(u) });
      }
      if (route === '/api/auth/register' && req.method === 'POST') {
        const username = String(body.username || '').toLowerCase(); const name = String(body.display_name || username).trim();
        if (!/^[a-z0-9_.-]{3,32}$/.test(username) || typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 256 || !name || name.length > 80) return json(400, { error: 'Usuário: 3–32 letras/números. Senha: 8–256 caracteres. Nome: até 80 caracteres.' });
        if (db.users.some(u => u.username === username)) return json(409, { error: 'Usuário já existe.' });
        const key = db.keys.find(k => k.key === String(body.invite_key || '').toUpperCase() && !k.revoked && k.uses_left > 0);
        if (!key) return json(403, { error: 'KEY inválida ou esgotada.' });
        const newUser={id:crypto.randomUUID(),username,display_name:name,password:hash(body.password),role:'user',approved:false,active:true,session_version:0,registered_with_key:key.key,registered_with_key_label:key.label,access_expires_at:key.duration_days?new Date(Date.now()+key.duration_days*86400000).toISOString():null};
        db.users.push(newUser);key.uses_left--;(key.used_by ||= []).push({username,display_name:name});audit(newUser,'register',newUser);save();return json(201,{ok:true});
      }
      const user = authenticate(req); if (!user) return json(401, { error: 'Sessão inválida. Faça login.' });
      if (route === '/api/auth/me' && req.method === 'GET') return json(200, { user: safeUser(user) });
      if(route==='/api/ice-config' && req.method==='GET'){
        const iceServers=process.env.STATZ_ICE_SERVERS?JSON.parse(process.env.STATZ_ICE_SERVERS):[
          {urls:'turn:openrelay.metered.ca:80',username:'openrelayproject',credential:'openrelayproject'},
          {urls:'turn:openrelay.metered.ca:443',username:'openrelayproject',credential:'openrelayproject'},
          {urls:'turn:openrelay.metered.ca:443?transport=tcp',username:'openrelayproject',credential:'openrelayproject'}
        ];return json(200,{iceServers});
      }
      if (!route.startsWith('/api/admin/')) return json(404, { error: 'Não encontrado.' });
      if (user.role !== 'admin') return json(403, { error: 'Acesso exclusivo do administrador.' });
      if(route==='/api/admin/audit-log' && req.method==='GET') return json(200,{events:db.events});
      if (route === '/api/admin/users' && req.method === 'GET') return json(200, { users: db.users.map(safeUser) });
      if (route === '/api/admin/invite-keys' && req.method === 'GET') return json(200, { keys: db.keys });
      if (route === '/api/admin/invite-keys' && req.method === 'POST') {
        const max = Number(body.max_uses); if (!Number.isInteger(max) || max < 1 || max > 100) return json(400, { error: 'Usos deve ser de 1 a 100.' });
        const days=Number(body.duration_days ?? 0);if(!Number.isInteger(days)||days<0||days>3650)return json(400,{error:'Duração inválida.'});
        const key = { id: crypto.randomUUID(), key: crypto.randomBytes(12).toString('hex').toUpperCase(), label: String(body.label || '').slice(0,80), max_uses: max, uses_left: max, duration_days:days, used_by:[], revoked: false }; db.keys.push(key); audit(user,'create_key',key); save(); return json(201, { key });
      }
      const match = route.match(/^\/api\/admin\/(users|invite-keys)\/([a-z0-9-]+)$/i);
      if (match) {
        const collection = match[1] === 'users' ? db.users : db.keys; const item = collection.find(x => x.id === match[2]);
        if (!item) return json(404, { error: 'Registro não encontrado.' });
        if (match[1] === 'users' && item.role === 'admin') return json(403, { error: 'O administrador principal não pode ser bloqueado ou excluído.' });
        if (req.method === 'DELETE') { if (match[1] === 'users') db.users = db.users.filter(x => x !== item); else item.revoked = true; audit(user,match[1]==='users'?'delete_user':'revoke_key',item); save(); return json(200, { ok: true }); }
        if(req.method==='PATCH' && match[1]==='users'){
          if('extend_days' in body && (!Number.isInteger(body.extend_days)||body.extend_days<1||body.extend_days>3650))return json(400,{error:'Renovação inválida.'});
          for(const field of ['approved','active'])if(typeof body[field]==='boolean'){
            item[field]=body[field];audit(user,field==='approved'?(item[field]?'approve':'unapprove'):(item[field]?'unblock':'block'),item);
            if(!item[field])item.session_version=(item.session_version||0)+1;
          }
          if(body.lifetime===true){item.access_expires_at=null;audit(user,'lifetime',item);}
          if(body.extend_days){item.access_expires_at=new Date(Math.max(Date.now(),Date.parse(item.access_expires_at)||0)+body.extend_days*86400000).toISOString();audit(user,'renew',item,{days:body.extend_days});}
          if(body.revoke_sessions===true){item.session_version=(item.session_version||0)+1;audit(user,'revoke_sessions',item);}
          save();return json(200,{user:safeUser(item)});
        }
      }
      return json(404, { error: 'Não encontrado.' });
    } catch (error) { console.error(error.message); if (!res.headersSent) json(500, { error: 'Erro interno.' }); else res.end(); }
  });
  return { server, initialPassword };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp(); const port = Number(process.env.PORT || 3030);
  app.server.listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log(`Statz: http://localhost:${port}`);
    if (app.initialPassword) console.log(`Primeiro acesso: admin / ${app.initialPassword}\nGuarde esta senha. Ela só aparece na primeira inicialização.`);
  });
}
