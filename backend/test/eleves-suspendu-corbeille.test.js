const { setupTestDb, teardownTestDb } = require('./_helpers/testDb');
const dbFile = setupTestDb();

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./_helpers/app');
const { creerClasse, creerEleve, tokenAdmin, db } = require('./_helpers/fixtures');

let ctx;
before(async () => { ctx = await startTestServer(tokenAdmin()); });
after(async () => { await ctx.close(); teardownTestDb(dbFile); });

test('suspendre un eleve cree une entree dans la corbeille', async () => {
  const classe = await creerClasse();
  const eleve = await creerEleve(classe.id);

  const res = await ctx.api('PUT', `/api/eleves/${eleve.id}/statut`, { statut: 'suspendu' });
  assert.equal(res.status, 200);

  const [[row]] = await db.query("SELECT id, donnees FROM corbeille WHERE table_source='eleves_suspendu' AND restaure=0 ORDER BY id DESC LIMIT 1");
  assert.ok(row, 'une entree de corbeille doit exister pour cet eleve suspendu');
  assert.equal(JSON.parse(row.donnees).id, eleve.id);
});

test('reactiver directement un eleve (bouton normal) marque sa propre entree de corbeille comme restauree', async () => {
  const classe = await creerClasse();
  const eleve = await creerEleve(classe.id);
  await ctx.api('PUT', `/api/eleves/${eleve.id}/statut`, { statut: 'suspendu' });

  await ctx.api('PUT', `/api/eleves/${eleve.id}/statut`, { statut: 'actif' });

  // Filtrage cote JS (pas de JSON_EXTRACT), comme le fait la route elle-meme.
  const [toutes] = await db.query("SELECT restaure, donnees FROM corbeille WHERE table_source='eleves_suspendu'");
  const laSienne = toutes.find((r) => JSON.parse(r.donnees).id === eleve.id);
  assert.ok(laSienne, 'l\'entree doit toujours exister');
  assert.equal(Number(laSienne.restaure), 1, 'reactiver directement doit marquer l\'entree comme restauree, pas la laisser trainer');
});

test('restaurer un eleve suspendu depuis la corbeille le remet actif', async () => {
  const classe = await creerClasse();
  const eleve = await creerEleve(classe.id);
  await ctx.api('PUT', `/api/eleves/${eleve.id}/statut`, { statut: 'suspendu' });

  const [[eleveApresSuspension]] = await db.query('SELECT statut FROM eleves WHERE id=?', [eleve.id]);
  assert.equal(eleveApresSuspension.statut, 'suspendu');

  const [[corbeilleRow]] = await db.query("SELECT id FROM corbeille WHERE table_source='eleves_suspendu' AND restaure=0 ORDER BY id DESC LIMIT 1");
  const res = await ctx.api('POST', `/api/corbeille/${corbeilleRow.id}/restaurer`);
  assert.equal(res.status, 200);

  const [[eleveApresRestauration]] = await db.query('SELECT statut FROM eleves WHERE id=?', [eleve.id]);
  assert.equal(eleveApresRestauration.statut, 'actif');
});
