const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Storage ───────────────────────────────────────────────────────────────────
// Usa ficheiro local com fallback para /data (Render Disk) se disponível
const DATA_DIR  = fs.existsSync('/data') ? '/data' : __dirname;
const DATA_FILE = path.join(DATA_DIR, 'keys.json');

function readDB() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return []; }
}

function writeDB(keys) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(keys, null, 2), 'utf8');
  } catch(e) {
    console.error('Erro ao salvar keys:', e.message);
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());

// ── Categorias ────────────────────────────────────────────────────────────────
const CATS = { diaria:1, semanal:7, mensal:30, trimestral:90, anual:365, permanente:null };

// ── Admin key (painel web) ────────────────────────────────────────────────────
const ADMIN_KEY = process.env.ADMIN_KEY || 'Shark10-10';
function isAdmin(req) { return req.headers['x-admin-key'] === ADMIN_KEY; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid(n) {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:n}, ()=>c[Math.floor(Math.random()*c.length)]).join('');
}
function genCode(cat) { return `${cat.slice(0,3).toUpperCase()}-${uid(4)}-${uid(4)}-${uid(4)}`; }

// ── API — painel ──────────────────────────────────────────────────────────────

app.get('/api/keys', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ success:false, error:'unauthorized' });
  res.json({ success:true, keys: readDB() });
});

app.post('/api/keys/generate', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ success:false, error:'unauthorized' });
  const { category, qty=1, note='' } = req.body;
  if (!CATS.hasOwnProperty(category)) return res.status(400).json({ success:false, error:'invalid_category' });
  const keys = readDB();
  const created = [];
  const n = Math.min(50, Math.max(1, parseInt(qty)||1));
  for (let i=0; i<n; i++) {
    const k = { code:genCode(category), category, note, createdAt:Date.now(), status:'pending', hwid:null, activatedAt:null, expiresAt:null };
    keys.push(k); created.push(k);
  }
  writeDB(keys);
  res.json({ success:true, created });
});

app.delete('/api/keys/:code', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ success:false, error:'unauthorized' });
  let keys = readDB();
  const before = keys.length;
  keys = keys.filter(k => k.code !== req.params.code);
  writeDB(keys);
  console.log(`Key apagada: ${req.params.code}`);
  res.json({ success:true, deleted: before - keys.length });
});

app.post('/api/keys/:code/reset-hwid', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ success:false, error:'unauthorized' });
  const keys = readDB();
  const k = keys.find(x => x.code === req.params.code);
  if (!k) return res.status(404).json({ success:false, error:'not_found' });
  k.hwid = null;
  writeDB(keys);
  res.json({ success:true, key:k });
});

// ── Endpoint público — Launcher C++ ──────────────────────────────────────────
app.post('/api/validate', (req, res) => {
  const { key, hwid } = req.body || {};
  if (!key)  return res.json({ success:false, message:'Key não informada.' });
  if (!hwid) return res.json({ success:false, message:'HWID não informado.' });

  const keys = readDB();
  const k = keys.find(x => x.code === key.trim().toUpperCase());

  // Key não existe no servidor = inválida
  if (!k) return res.json({ success:false, message:'Key inválida ou não encontrada.' });

  const now = Date.now();

  if (k.status === 'active') {
    if (k.expiresAt && now > k.expiresAt)
      return res.json({ success:false, message:'Key expirada.' });
    if (k.hwid && k.hwid !== hwid)
      return res.json({ success:false, message:'HWID inválido para esta key.' });
    if (!k.hwid) { k.hwid = hwid; writeDB(keys); }
    return res.json({ success:true, username:k.note||'User', role:k.category, type:k.category, expires_at: k.expiresAt ? Math.floor(k.expiresAt/1000) : 0 });
  }

  if (k.status === 'pending') {
    const days = CATS[k.category];
    k.status='active'; k.hwid=hwid; k.activatedAt=now;
    k.expiresAt = days ? now + days*86400000 : null;
    writeDB(keys);
    return res.json({ success:true, username:k.note||'User', role:k.category, type:k.category, expires_at: k.expiresAt ? Math.floor(k.expiresAt/1000) : 0 });
  }

  return res.json({ success:false, message:'Status de key inválido.' });
});

// ── Static + SPA ──────────────────────────────────────────────────────────────
app.get('/api/ping', (req, res) => res.json({ ok: true, time: Date.now() }));
app.use(express.static(path.join(__dirname)));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
  console.log(`VaultKey na porta ${PORT}`);
  console.log(`Storage: ${DATA_FILE}`);
  console.log(`Keys existentes: ${readDB().length}`);

  // ── Keep-alive: ping a cada 10 minutos para o Render não dormir ──
  const https = require('https');
  const SELF_URL = process.env.RENDER_EXTERNAL_URL || `https://key-auth-0rfw.onrender.com`;
  setInterval(() => {
    https.get(SELF_URL + '/api/ping', (res) => {
      console.log(`[keep-alive] ping ok: ${res.statusCode}`);
    }).on('error', (e) => {
      console.log(`[keep-alive] ping erro: ${e.message}`);
    });
  }, 10 * 60 * 1000); // 10 minutos
});
