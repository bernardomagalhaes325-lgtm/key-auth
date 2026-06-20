const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname)));

/* ---------- Persistência simples em arquivo JSON ---------- */
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return [];
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    return [];
  }
}
function writeDB(keys) {
  fs.writeFileSync(DB_FILE, JSON.stringify(keys, null, 2));
}

const CATS = {
  diaria:     { days: 1 },
  semanal:    { days: 7 },
  mensal:     { days: 30 },
  trimestral: { days: 90 },
  anual:      { days: 365 },
  permanente: { days: null },
};

function uid(n) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function genCode(catId) {
  const prefix = catId.slice(0, 3).toUpperCase();
  return `${prefix}-${uid(4)}-${uid(4)}-${uid(4)}`;
}

/* ---------- Auth simples do painel (header x-admin-key) ---------- */
const ADMIN_KEY = process.env.ADMIN_KEY || 'Shark10-10';
function requireAdmin(req, res, next) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }
  next();
}

/* ---------- Endpoints do painel (admin) ---------- */
app.get('/api/keys', requireAdmin, (req, res) => {
  res.json({ success: true, keys: readDB() });
});

app.post('/api/keys/generate', requireAdmin, (req, res) => {
  const { category, qty, note } = req.body;
  if (!CATS[category]) return res.status(400).json({ success: false, error: 'invalid_category' });
  const n = Math.min(50, Math.max(1, parseInt(qty) || 1));
  const keys = readDB();
  const created = [];
  for (let i = 0; i < n; i++) {
    const k = {
      code: genCode(category),
      category,
      note: note || '',
      createdAt: Date.now(),
      status: 'pending',
      hwid: null,
      activatedAt: null,
      expiresAt: null,
    };
    keys.push(k);
    created.push(k);
  }
  writeDB(keys);
  res.json({ success: true, created });
});

app.delete('/api/keys/:code', requireAdmin, (req, res) => {
  let keys = readDB();
  keys = keys.filter(k => k.code !== req.params.code);
  writeDB(keys);
  res.json({ success: true });
});

app.post('/api/keys/:code/reset-hwid', requireAdmin, (req, res) => {
  const keys = readDB();
  const k = keys.find(x => x.code === req.params.code);
  if (!k) return res.status(404).json({ success: false, error: 'key_not_found' });
  k.hwid = null;
  writeDB(keys);
  res.json({ success: true, key: k });
});

/* ---------- Endpoint público: o programa do cliente chama este ---------- */
/* POST /api/validate   body: { "key": "DIA-XXXX-XXXX-XXXX", "hwid": "PC-12345" } */
app.post('/api/validate', (req, res) => {
  const { key, hwid } = req.body || {};
  if (!key || !hwid) {
    return res.status(400).json({ success: false, error: 'missing_key_or_hwid' });
  }
  const keys = readDB();
  const k = keys.find(x => x.code === key.trim().toUpperCase());

  if (!k) {
    return res.status(404).json({ success: false, error: 'key_not_found' });
  }

  // Key ainda não foi usada -> ativa agora e vincula o HWID
  if (k.status === 'pending') {
    const cat = CATS[k.category];
    k.status = 'active';
    k.hwid = hwid;
    k.activatedAt = Date.now();
    k.expiresAt = cat.days ? Date.now() + cat.days * 86400000 : null;
    writeDB(keys);
    return res.json({
      success: true,
      message: 'key_activated',
      type: k.category,
      expiresAt: k.expiresAt,
    });
  }

  // Key já ativa -> precisa bater o HWID
  if (k.hwid && k.hwid !== hwid) {
    return res.status(403).json({ success: false, error: 'hwid_mismatch' });
  }

  // Key expirada
  if (k.expiresAt && Date.now() > k.expiresAt) {
    return res.status(403).json({ success: false, error: 'key_expired' });
  }

  return res.json({
    success: true,
    message: 'key_valid',
    type: k.category,
    expiresAt: k.expiresAt,
  });
});

/* ---------- Fallback: serve o painel ---------- */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`VaultKey rodando na porta ${PORT}`);
});
