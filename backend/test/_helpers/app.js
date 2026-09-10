// Assemble une app Express minimale montant les vraies routes de production (mêmes
// fichiers que server.js), pour tester le vrai comportement des routes -- SQL, permissions,
// auth -- sans dupliquer server.js ni ouvrir un vrai port pendant toute la duree du test.
const express = require('express');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../../src/routes/auth'));
  app.use('/api/dashboard', require('../../src/routes/dashboard'));
  app.use('/api/eleves', require('../../src/routes/eleves'));
  app.use('/api/classes', require('../../src/routes/classes'));
  app.use('/api/paiements', require('../../src/routes/paiements'));
  app.use('/api/remboursements', require('../../src/routes/remboursements'));
  app.use('/api/promotion', require('../../src/routes/promotion'));
  app.use('/api/comptabilite', require('../../src/routes/comptabilite'));
  app.use('/api/rapports', require('../../src/routes/rapports'));
  app.use('/api/familles', require('../../src/routes/familles'));
  app.use('/api/utilisateurs', require('../../src/routes/utilisateurs'));
  app.use('/api/historique', require('../../src/routes/historique'));
  app.use('/api/parametres', require('../../src/routes/parametres'));
  app.use('/api/corbeille', require('../../src/routes/corbeille'));
  return app;
}

// Demarre l'app sur un port ephemere (0 = choisi par l'OS) et renvoie une petite aide `api`
// pour appeler l'API en JSON avec le jeton d'authentification deja attache.
async function startTestServer(token) {
  const app = buildApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  async function api(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* reponse vide (ex: 204) */ }
    return { status: res.status, body: json };
  }

  return { server, api, close: () => new Promise((resolve) => server.close(resolve)) };
}

module.exports = { buildApp, startTestServer };
