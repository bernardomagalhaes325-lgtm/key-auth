const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve todos os arquivos estáticos da raiz do projeto (index.html, etc)
app.use(express.static(path.join(__dirname)));

// Qualquer rota que não for um arquivo cai no index.html (painel)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`VaultKey rodando na porta ${PORT}`);
});
