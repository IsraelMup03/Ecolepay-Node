const { setupTestDb, teardownTestDb } = require('./_helpers/testDb');
const dbFile = setupTestDb(); // doit rester avant tout require touchant src/config/db.js

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./_helpers/app');
const { creerClasse, creerEleve, tokenAdmin } = require('./_helpers/fixtures');

let ctx;
before(async () => {
  ctx = await startTestServer(tokenAdmin());
});
after(async () => {
  await ctx.close();
  await teardownTestDb(dbFile);
});

test('un paiement de scolarite normal (sous le montant du) est enregistre tel quel', async () => {
  const classe = await creerClasse({ frais_scolarite: 500 });
  const eleve = await creerEleve(classe.id);

  const { status, body } = await ctx.api('POST', '/api/paiements', {
    eleve_id: eleve.id, montant: 200, devise: 'USD', type_paiement: 'scolarite',
  });

  assert.equal(status, 201);
  assert.equal(body.surplus, undefined, 'pas de surplus attendu sous le montant du');
});

test('un paiement de scolarite qui depasse ce qui est du est plafonne, le surplus est isole', async () => {
  const classe = await creerClasse({ frais_scolarite: 550 });
  const eleve = await creerEleve(classe.id);

  const { status, body } = await ctx.api('POST', '/api/paiements', {
    eleve_id: eleve.id, montant: 600, devise: 'USD', type_paiement: 'scolarite',
  });

  assert.equal(status, 201);
  assert.equal(body.surplus, 50, 'le surplus doit etre exactement 600 - 550');

  const { body: fiche } = await ctx.api('GET', `/api/eleves/${eleve.id}`);
  assert.equal(Number(fiche.totaux.totalPayeScolarite), 550, 'le montant applique a la dette reste plafonne a 550');
  assert.equal(Number(fiche.totaux.totalSurplusNonRendu), 50, 'le surplus doit apparaitre comme non rendu');
});

test('impossible de payer la scolarite d\'un eleve deja entierement solde', async () => {
  const classe = await creerClasse({ frais_scolarite: 300 });
  const eleve = await creerEleve(classe.id);

  const premier = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 300, devise: 'USD', type_paiement: 'scolarite' });
  assert.equal(premier.status, 201);

  const second = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 50, devise: 'USD', type_paiement: 'scolarite' });
  assert.equal(second.status, 400, 'un paiement de scolarite supplementaire doit etre refuse une fois solde');
});

test('un paiement en CDF est converti en USD selon le taux de change de l\'ecole', async () => {
  const classe = await creerClasse({ frais_scolarite: 1000 });
  const eleve = await creerEleve(classe.id);

  // taux_usd_cdf par defaut = 2800 (seed de migrate-sqlite.js)
  const { status, body } = await ctx.api('POST', '/api/paiements', {
    eleve_id: eleve.id, montant: 280000, devise: 'CDF', type_paiement: 'scolarite',
  });
  assert.equal(status, 201);

  const { body: fiche } = await ctx.api('GET', `/api/eleves/${eleve.id}`);
  assert.equal(Number(fiche.totaux.totalPayeScolarite), 100, '280000 CDF / 2800 doit donner 100 USD');
});

test('les paiements "inscription" et "autre" ne sont jamais plafonnes ni mis en surplus', async () => {
  const classe = await creerClasse({ frais_scolarite: 500, frais_inscription: 50 });
  const eleve = await creerEleve(classe.id);

  // 200 pour un frais d'inscription de 50 : seule la scolarite a une logique de plafond/surplus.
  const { status, body } = await ctx.api('POST', '/api/paiements', {
    eleve_id: eleve.id, montant: 200, devise: 'USD', type_paiement: 'inscription',
  });
  assert.equal(status, 201);
  assert.equal(body.surplus, undefined, 'un paiement d\'inscription ne doit jamais generer de surplus');

  const { body: fiche } = await ctx.api('GET', `/api/eleves/${eleve.id}`);
  assert.equal(Number(fiche.totaux.totalPayeInscription), 200, 'le montant total doit etre enregistre sans plafond');
});
