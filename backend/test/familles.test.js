const { setupTestDb, teardownTestDb } = require('./_helpers/testDb');
const dbFile = setupTestDb();

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./_helpers/app');
const { creerClasse, creerEleve, creerTranche, tokenAdmin, db } = require('./_helpers/fixtures');

let ctx;
before(async () => { ctx = await startTestServer(tokenAdmin()); });
after(async () => { await ctx.close(); teardownTestDb(dbFile); });

test('creer une famille applique la remise sur la derniere tranche des membres', async () => {
  const classe = await creerClasse({ frais_scolarite: 750 });
  await creerTranche(classe.id, 1, 400);
  await creerTranche(classe.id, 2, 200);
  await creerTranche(classe.id, 3, 150);

  const e1 = await creerEleve(classe.id, { nom: 'Dupont', prenom: 'Alice', genre: 'F' });
  const e2 = await creerEleve(classe.id, { nom: 'Dupont', prenom: 'Bob', genre: 'M' });

  const res = await ctx.api('POST', '/api/familles', {
    nom: 'Famille Dupont',
    pourcentage_reduction: 20,
    eleve_ids: [e1.id, e2.id],
  });

  assert.equal(res.status, 201, 'la famille doit etre creee');
  assert.ok(res.body.id, 'la famille doit avoir un identifiant');

  const [[row1]] = await db.query('SELECT famille_id, frais_scolarite_total FROM eleves WHERE id=?', [e1.id]);
  const [[row2]] = await db.query('SELECT famille_id, frais_scolarite_total FROM eleves WHERE id=?', [e2.id]);
  assert.equal(Number(row1.famille_id), Number(res.body.id));
  assert.equal(Number(row2.famille_id), Number(res.body.id));
  assert.equal(Number(row1.frais_scolarite_total), 720, 'la reduction famille ne s applique qu a la derniere tranche');
  assert.equal(Number(row2.frais_scolarite_total), 720);

  const { body: detail } = await ctx.api('GET', `/api/eleves/${e1.id}`);
  assert.equal(Number(detail.tranches[detail.tranches.length - 1].montant), 120, 'la derniere tranche effective doit etre reduite');
  assert.equal(detail.tranches[detail.tranches.length - 1].pct, 0, 'la derniere tranche non payee reste a 0% de progression, meme avec reduction familiale');
});

test('rechercher des eleves pour creer une famille ne retourne pas les membres deja affectes', async () => {
  const classe = await creerClasse({ frais_scolarite: 500 });
  const e1 = await creerEleve(classe.id, { nom: 'Martin', prenom: 'Anne' });
  const e2 = await creerEleve(classe.id, { nom: 'Martin', prenom: 'Jean' });

  await ctx.api('POST', '/api/familles', { nom: 'Famille Martin', pourcentage_reduction: 10, eleve_ids: [e1.id] });

  const res = await ctx.api('GET', '/api/familles/search?q=Martin');
  assert.equal(res.status, 200);
  const ids = res.body.map((e) => e.id);
  assert.ok(!ids.includes(e1.id));
  assert.ok(ids.includes(e2.id));
});

test('modifier, archiver puis restaurer une famille conserve ses membres et ses montants', async () => {
  const classe = await creerClasse({ frais_scolarite: 600 });
  await creerTranche(classe.id, 1, 300);
  await creerTranche(classe.id, 2, 300);
  const e1 = await creerEleve(classe.id, { nom: 'Famille', prenom: 'Un' });
  const e2 = await creerEleve(classe.id, { nom: 'Famille', prenom: 'Deux' });
  const creee = await ctx.api('POST', '/api/familles', { nom: 'Ancien nom', pourcentage_reduction: 10, eleve_ids: [e1.id, e2.id] });
  assert.equal(creee.status, 201);

  const modifiee = await ctx.api('PUT', `/api/familles/${creee.body.id}`, { nom: 'Nouveau nom', pourcentage_reduction: 20, eleve_ids: [e1.id] });
  assert.equal(modifiee.status, 200);
  const [[apresModification]] = await db.query('SELECT famille_id, frais_scolarite_total FROM eleves WHERE id=?', [e1.id]);
  const [[retire]] = await db.query('SELECT famille_id, frais_scolarite_total FROM eleves WHERE id=?', [e2.id]);
  assert.equal(Number(apresModification.famille_id), Number(creee.body.id));
  assert.equal(Number(apresModification.frais_scolarite_total), 540);
  assert.equal(retire.famille_id, null);
  assert.equal(Number(retire.frais_scolarite_total), 600);

  const supprimee = await ctx.api('DELETE', `/api/familles/${creee.body.id}`);
  assert.equal(supprimee.status, 200);
  const [[inactive]] = await db.query('SELECT actif FROM familles WHERE id=?', [creee.body.id]);
  assert.equal(Number(inactive.actif), 0);
  const [corbeille] = await db.query("SELECT id FROM corbeille WHERE table_source='familles' ORDER BY id DESC LIMIT 1");
  assert.ok(corbeille[0]?.id);

  const restauree = await ctx.api('POST', `/api/corbeille/${corbeille[0].id}/restaurer`);
  assert.equal(restauree.status, 200);
  const [[active]] = await db.query('SELECT actif FROM familles WHERE id=?', [creee.body.id]);
  const [[membreRestaure]] = await db.query('SELECT famille_id, frais_scolarite_total FROM eleves WHERE id=?', [e1.id]);
  assert.equal(Number(active.actif), 1);
  assert.equal(Number(membreRestaure.famille_id), Number(creee.body.id));
  assert.equal(Number(membreRestaure.frais_scolarite_total), 540);
});
