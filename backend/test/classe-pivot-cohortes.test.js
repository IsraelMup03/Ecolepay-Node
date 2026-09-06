const { setupTestDb, teardownTestDb } = require('./_helpers/testDb');
const dbFile = setupTestDb();

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./_helpers/app');
const { creerClasse, creerEleve, tokenAdmin, db } = require('./_helpers/fixtures');

let ctx;
before(async () => { ctx = await startTestServer(tokenAdmin()); });
after(async () => { await ctx.close(); teardownTestDb(dbFile); });

test('promotion : distingue les eleves deja presents dans la classe pivot de ceux qui viennent d\'y arriver', async () => {
  const pivot = await creerClasse({ frais_scolarite: 500, est_pivot: 1 });
  const inferieure = await creerClasse({ frais_scolarite: 400, classe_superieure_id: pivot.id });

  const dejaLa = await creerEleve(pivot.id);
  const arrivant = await creerEleve(inferieure.id);

  const res = await ctx.api('POST', '/api/promotion/executer', { nouvelle_annee: '2025-2026' });
  assert.equal(res.status, 200);

  const [[apresDejaLa]] = await db.query('SELECT classe_id, en_attente_orientation FROM eleves WHERE id=?', [dejaLa.id]);
  assert.equal(apresDejaLa.classe_id, pivot.id);
  assert.equal(Number(apresDejaLa.en_attente_orientation), 1, 'deja present avant la promotion -> en attente de transfert');

  const [[apresArrivant]] = await db.query('SELECT classe_id, en_attente_orientation FROM eleves WHERE id=?', [arrivant.id]);
  assert.equal(apresArrivant.classe_id, pivot.id);
  assert.equal(Number(apresArrivant.en_attente_orientation), 0, 'fraichement promu -> normal, ne doit pas etre mele au groupe en attente');
});

test('transferer resout l\'attente de transfert (remet le flag a 0)', async () => {
  const pivot = await creerClasse({ frais_scolarite: 500, est_pivot: 1 });
  const optionSciences = await creerClasse({ frais_scolarite: 650 });
  const eleve = await creerEleve(pivot.id, { en_attente_orientation: 1 });

  const res = await ctx.api('POST', `/api/eleves/${eleve.id}/transferer`, { classe_id: optionSciences.id });
  assert.equal(res.status, 200);

  const [[apres]] = await db.query('SELECT classe_id, en_attente_orientation FROM eleves WHERE id=?', [eleve.id]);
  assert.equal(apres.classe_id, optionSciences.id);
  assert.equal(Number(apres.en_attente_orientation), 0);
});

test('retrograder remet le flag a 0 par securite', async () => {
  const inferieure = await creerClasse({ frais_scolarite: 300 });
  const classe = await creerClasse({ frais_scolarite: 500, classe_inferieure_id: inferieure.id });
  const eleve = await creerEleve(classe.id, { en_attente_orientation: 1 });

  const res = await ctx.api('POST', `/api/eleves/${eleve.id}/retrograder`, {});
  assert.equal(res.status, 200);

  const [[apres]] = await db.query('SELECT en_attente_orientation FROM eleves WHERE id=?', [eleve.id]);
  assert.equal(Number(apres.en_attente_orientation), 0);
});

test('GET /eleves?en_attente_orientation=1 renvoie uniquement les eleves en attente', async () => {
  const pivot = await creerClasse({ frais_scolarite: 500, est_pivot: 1 });
  const attente = await creerEleve(pivot.id, { en_attente_orientation: 1 });
  await creerEleve(pivot.id, { en_attente_orientation: 0 });

  const res = await ctx.api('GET', '/api/eleves?en_attente_orientation=1&limit=200');
  assert.equal(res.status, 200);
  const ids = res.body.rows.map((r) => r.id);
  assert.ok(ids.includes(attente.id));
  assert.equal(res.body.rows.every((r) => Number(r.en_attente_orientation) === 1), true);
});

test('GET /eleves/by-classe/:id inclut en_attente_orientation pour separer les deux listes cote frontend', async () => {
  const pivot = await creerClasse({ frais_scolarite: 500, est_pivot: 1 });
  const attente = await creerEleve(pivot.id, { en_attente_orientation: 1 });
  const normal = await creerEleve(pivot.id, { en_attente_orientation: 0 });

  const res = await ctx.api('GET', `/api/eleves/by-classe/${pivot.id}`);
  assert.equal(res.status, 200);
  const parId = Object.fromEntries(res.body.map((e) => [e.id, e.en_attente_orientation]));
  assert.equal(Number(parId[attente.id]), 1);
  assert.equal(Number(parId[normal.id]), 0);
});

test('GET /dashboard/alertes compte les eleves en attente et les remboursements en attente', async () => {
  const pivot = await creerClasse({ frais_scolarite: 500, est_pivot: 1 });
  await creerEleve(pivot.id, { en_attente_orientation: 1 });
  await creerEleve(pivot.id, { en_attente_orientation: 1 });

  const res = await ctx.api('GET', '/api/dashboard/alertes');
  assert.equal(res.status, 200);
  assert.ok(res.body.elevesEnAttenteOrientation >= 2);
  assert.equal(typeof res.body.remboursementsEnAttente, 'number');
});
