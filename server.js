const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));

const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 1);

if (!DATABASE_URL) {
  console.error('DATABASE_URL não configurada.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const allowedOrigins = FRONTEND_ORIGIN.split(',').map(x=>x.trim()).filter(Boolean);
app.use((req,res,next)=>{
  const origin=req.headers.origin;
  if(origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Credentials','false');
  }
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});

function hashPassword(password, salt=crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve,reject)=>{
    crypto.scrypt(password, salt, 64, {N:16384,r:8,p:1}, (err,key)=>{
      if(err) reject(err); else resolve({salt, hash:key.toString('hex')});
    });
  });
}
function verifyPassword(password, salt, expected) {
  return new Promise((resolve,reject)=>{
    crypto.scrypt(password,salt,64,{N:16384,r:8,p:1},(err,key)=>{
      if(err) return reject(err);
      const a=Buffer.from(expected,'hex'), b=Buffer.from(key.toString('hex'),'hex');
      resolve(a.length===b.length && crypto.timingSafeEqual(a,b));
    });
  });
}
function tokenHash(token){ return crypto.createHash('sha256').update(token).digest('hex'); }
function newToken(){ return crypto.randomBytes(32).toString('base64url'); }

async function auth(req,res,next){
  try{
    const h=req.headers.authorization||'';
    if(!h.startsWith('Bearer ')) return res.status(401).json({error:'Não autenticado.'});
    const token=h.slice(7);
    const r=await pool.query(
      `SELECT s.id session_id,u.id,u.username,u.display_name,u.role,u.active
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>NOW()`,[tokenHash(token)]);
    if(!r.rowCount || !r.rows[0].active) return res.status(401).json({error:'Sessão inválida ou usuário bloqueado.'});
    req.user=r.rows[0]; next();
  }catch(e){console.error(e);res.status(500).json({error:'Erro interno de autenticação.'});}
}
function adminOnly(req,res,next){ if(req.user.role!=='admin') return res.status(403).json({error:'Apenas administradores.'}); next(); }
function validUsername(v){return typeof v==='string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(v);}
function validPassword(v){return typeof v==='string' && v.length>=8 && v.length<=128;}

app.get('/api/health',(req,res)=>res.json({ok:true}));

app.post('/api/auth/login', async (req,res)=>{
  try{
    const username=String(req.body.username||'').trim();
    const password=String(req.body.password||'');
    const r=await pool.query('SELECT * FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1',[username]);
    if(!r.rowCount || !r.rows[0].active) return res.status(401).json({error:'Usuário ou senha inválidos.'});
    const u=r.rows[0];
    if(!await verifyPassword(password,u.password_salt,u.password_hash)) return res.status(401).json({error:'Usuário ou senha inválidos.'});
    const token=newToken();
    await pool.query(
      `INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+($3 || ' days')::interval)`,
      [token,u.id,String(SESSION_DAYS)]
    );
    res.json({token,user:{id:u.id,username:u.username,display_name:u.display_name,role:u.role}});
  }catch(e){console.error(e);res.status(500).json({error:'Erro ao fazer login.'});}
});

app.get('/api/auth/me',auth,(req,res)=>res.json({user:{
  id:req.user.id,username:req.user.username,display_name:req.user.display_name,role:req.user.role
}}));

app.post('/api/auth/logout',auth,async(req,res)=>{
  await pool.query('DELETE FROM sessions WHERE id=$1',[req.user.session_id]);
  res.json({ok:true});
});

app.get('/api/admin/users',auth,adminOnly,async(req,res)=>{
  const r=await pool.query(`SELECT id,username,display_name,role,active,created_at FROM users ORDER BY created_at ASC`);
  res.json({users:r.rows});
});

app.post('/api/admin/users',auth,adminOnly,async(req,res)=>{
  try{
    const username=String(req.body.username||'').trim();
    const password=String(req.body.password||'');
    const display=String(req.body.display_name||username).trim().slice(0,80);
    if(!validUsername(username)) return res.status(400).json({error:'Usuário: 3–32 caracteres, apenas letras, números, _, . e -.'});
    if(!validPassword(password)) return res.status(400).json({error:'Senha deve ter pelo menos 8 caracteres.'});
    const exists=await pool.query('SELECT 1 FROM users WHERE LOWER(username)=LOWER($1)',[username]);
    if(exists.rowCount) return res.status(409).json({error:'Esse usuário já existe.'});
    const p=await hashPassword(password);
    const r=await pool.query(
      `INSERT INTO users(username,display_name,role,active,password_hash,password_salt)
       VALUES($1,$2,'user',true,$3,$4) RETURNING id,username,display_name,role,active`,
      [username,display,p.hash,p.salt]);
    res.status(201).json({user:r.rows[0]});
  }catch(e){console.error(e);res.status(500).json({error:'Não foi possível criar o usuário.'});}
});

app.patch('/api/admin/users/:id',auth,adminOnly,async(req,res)=>{
  try{
    const id=req.params.id;
    if(String(id)===String(req.user.id) && req.body.active===false) return res.status(400).json({error:'Você não pode bloquear sua própria conta.'});
    const sets=[], vals=[], add=(sql,val)=>{vals.push(val);sets.push(sql.replace('?',`$${vals.length}`));};
    if(typeof req.body.active==='boolean') add('active=?',req.body.active);
    if(typeof req.body.display_name==='string') add('display_name=?',req.body.display_name.trim().slice(0,80));
    if(typeof req.body.password==='string'){
      if(!validPassword(req.body.password)) return res.status(400).json({error:'Senha deve ter pelo menos 8 caracteres.'});
      const p=await hashPassword(req.body.password);
      add('password_hash=?',p.hash); add('password_salt=?',p.salt);
    }
    if(!sets.length) return res.status(400).json({error:'Nada para alterar.'});
    vals.push(id);
    const r=await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING id,username,display_name,role,active`,vals);
    if(!r.rowCount) return res.status(404).json({error:'Usuário não encontrado.'});
    if(req.body.password || req.body.active===false) await pool.query('DELETE FROM sessions WHERE user_id=$1',[id]);
    res.json({user:r.rows[0]});
  }catch(e){console.error(e);res.status(500).json({error:'Não foi possível alterar o usuário.'});}
});

app.delete('/api/admin/users/:id',auth,adminOnly,async(req,res)=>{
  const id=req.params.id;
  if(String(id)===String(req.user.id)) return res.status(400).json({error:'Você não pode excluir sua própria conta.'});
  const r=await pool.query('DELETE FROM users WHERE id=$1 RETURNING id',[id]);
  if(!r.rowCount) return res.status(404).json({error:'Usuário não encontrado.'});
  res.json({ok:true});
});

async function init(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(32) UNIQUE NOT NULL,
      display_name VARCHAR(80) NOT NULL,
      role VARCHAR(10) NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions(
      id BIGSERIAL PRIMARY KEY,
      token_hash CHAR(64) UNIQUE NOT NULL,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
  `);

  const adminUser=process.env.ADMIN_USERNAME;
  const adminPass=process.env.ADMIN_PASSWORD;
  if(adminUser && adminPass){
    const r=await pool.query('SELECT id FROM users WHERE LOWER(username)=LOWER($1)',[adminUser]);
    if(!r.rowCount){
      if(!validUsername(adminUser) || !validPassword(adminPass)) throw new Error('ADMIN_USERNAME/ADMIN_PASSWORD inválidos.');
      const p=await hashPassword(adminPass);
      await pool.query(
        `INSERT INTO users(username,display_name,role,active,password_hash,password_salt)
         VALUES($1,$1,'admin',true,$2,$3)`,[adminUser,p.hash,p.salt]);
      console.log('Administrador inicial criado:',adminUser);
    }
  }

  app.listen(PORT,'0.0.0.0',()=>console.log(`SquadCall API ouvindo na porta ${PORT}`));
}
init().catch(e=>{console.error(e);process.exit(1);});
