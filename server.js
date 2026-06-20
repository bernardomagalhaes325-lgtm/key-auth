const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Storage ──────────────────────────────────────────────────────────────────
// Em produção (Render) os ficheiros são efémeros, mas para este use-case
// (poucos clientes, volume pequeno) um ficheiro JSON local é suficiente.
// Para persistência real substitui por uma DB (SQLite, Postgres, etc.)
const DATA_FILE = path.join(__dirname, 'keys.json');

function readKeys() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return []; }
}

function writeKeys(keys) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(keys, null, 2), 'utf8');
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Categorias ────────────────────────────────────────────────────────────────
const CATS = {
  diaria:      1,
  semanal:     7,
  mensal:      30,
  trimestral:  90,
  anual:       365,
  permanente:  null,
};

// ── API REST ──────────────────────────────────────────────────────────────────

// GET /api/keys  — retorna todas as keys (painel web)
app.get('/api/keys', (req, res) => {
  res.json(readKeys());
});

// POST /api/keys  — gera novas keys  { category, qty, note }
app.post('/api/keys', (req, res) => {
  const { category, qty = 1, note = '' } = req.body;
  if (!CATS.hasOwnProperty(category))
    return res.status(400).json({ error: 'invalid_category' });

  const keys  = readKeys();
  const added = [];
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const uid   = n => Array.from({length:n}, ()=>chars[Math.floor(Math.random()*chars.length)]).join('');
  const genCode = cat => `${cat.slice(0,3).toUpperCase()}-${uid(4)}-${uid(4)}-${uid(4)}`;

  const count = Math.min(50, Math.max(1, parseInt(qty) || 1));
  for (let i = 0; i < count; i++) {
    const k = {
      code:        genCode(category),
      category,
      note,
      createdAt:   Date.now(),
      status:      'pending',
      hwid:        null,
      activatedAt: null,
      expiresAt:   null,
    };
    keys.push(k);
    added.push(k);
  }
  writeKeys(keys);
  res.json({ added });
});

// DELETE /api/keys/:code  — apaga uma key
app.delete('/api/keys/:code', (req, res) => {
  let keys = readKeys();
  const before = keys.length;
  keys = keys.filter(k => k.code !== req.params.code);
  writeKeys(keys);
  res.json({ deleted: before - keys.length });
});

// POST /api/keys/:code/reset-hwid  — limpa o HWID
app.post('/api/keys/:code/reset-hwid', (req, res) => {
  const keys = readKeys();
  const k = keys.find(x => x.code === req.params.code);
  if (!k) return res.status(404).json({ error: 'not_found' });
  k.hwid = null;
  writeKeys(keys);
  res.json({ ok: true });
});

// ── Endpoint principal — usado pelo Launcher C++ ──────────────────────────────
//
// POST /api/validate
// Body: { "key": "XXX-XXXX-XXXX-XXXX", "hwid": "ABCD1234-AABBCCDD..." }
//
// Resposta sucesso:
// { "success": true, "username": "User", "role": "...", "type": "mensal",
//   "expires_at": 1700000000 }
//
// Resposta erro:
// { "success": false, "message": "..." }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/validate', (req, res) => {
  const { key, hwid } = req.body || {};

  if (!key)  return res.json({ success: false, message: 'Key não informada.' });
  if (!hwid) return res.json({ success: false, message: 'HWID não informado.' });

  const keys = readKeys();
  const k    = keys.find(x => x.code === key.trim().toUpperCase());

  if (!k)
    return res.json({ success: false, message: 'Key inválida ou não encontrada.' });

  const now = Date.now();

  // ── Caso 1: key já ativa ──────────────────────────────────────────────────
  if (k.status === 'active') {
    // Verifica se expirou
    if (k.expiresAt && now > k.expiresAt)
      return res.json({ success: false, message: 'Key expirada.' });

    // Verifica HWID — se já tem um HWID vinculado, deve bater
    if (k.hwid && k.hwid !== hwid)
      return res.json({ success: false, message: 'HWID inválido para esta key.' });

    // Se ainda não tem HWID (reset), vincula agora
    if (!k.hwid) {
      k.hwid = hwid;
      writeKeys(keys);
    }

    return res.json({
      success:    true,
      username:   k.note || 'User',
      role:       k.category,
      type:       k.category,
      expires_at: k.expiresAt ? Math.floor(k.expiresAt / 1000) : 0,
    });
  }

  // ── Caso 2: key pendente — primeira activação ─────────────────────────────
  if (k.status === 'pending') {
    const days = CATS[k.category];
    k.status      = 'active';
    k.hwid        = hwid;
    k.activatedAt = now;
    k.expiresAt   = days ? now + days * 86400000 : null;
    writeKeys(keys);

    return res.json({
      success:    true,
      username:   k.note || 'User',
      role:       k.category,
      type:       k.category,
      expires_at: k.expiresAt ? Math.floor(k.expiresAt / 1000) : 0,
    });
  }

  return res.json({ success: false, message: 'Status de key inválido.' });
});

// ── Fallback SPA ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`VaultKey rodando na porta ${PORT}`);
});
