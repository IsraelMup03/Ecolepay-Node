// Fichier dedie (base de test fraiche et isolee) pour verifier des valeurs EXACTES du taux
// de recouvrement -- separe de dashboard.test.js pour ne pas dependre de l'etat cumule par
// d'autres tests dans le meme fichier/processus.
const { setupTestDb, teardownTestDb } = require('./_helpers/testDb');
const dbFile = setupTestDb();

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./_helpers/app');
const { creerClasse, creerEleve, tokenAdmin } = require('./_helpers/fixtures');

let ctx;
before(async () => { ctx = await startTestServer(tokenAdmin()); });
after(async () => { await ctx.close(); await teardownTestDb(dbFile); });

test('taux de recouvrement : ignore les paiements "autre" et le surplus, ne compte que la scolarite due', async () => {
  const classe = await creerClasse({ frais_scolarite: 500 });
  const eleve = await creerEleve(classe.id);

  // Paiement "autre" (ex: uniforme) : le total attendu (scolarite) augmente avec le nouvel
  // eleve, mais le taux doit rester a 0 tant qu'aucune scolarite n'a ete payee.
  await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 1000, devise: 'USD', type_paiement: 'autre' });
  const { body: apresAutre } = await ctx.api('GET', '/api/dashboard');
  assert.equal(apresAutre.stats.totalAttendu, 500);
  assert.equal(apresAutre.stats.taux, 0, 'un paiement "autre" ne doit jamais faire progresser le taux de recouvrement');

  // Paiement de scolarite de 700$ pour une dette de 500$ (donc 200$ de surplus) : seuls les
  // 500$ effectivement dus doivent compter dans le taux, jamais les 700$ recus.
  await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 700, devise: 'USD', type_paiement: 'scolarite' });
  const { body: apresScolarite } = await ctx.api('GET', '/api/dashboard');
  assert.equal(apresScolarite.stats.totalAttendu, 500);
  assert.equal(apresScolarite.stats.taux, 100, '500$ appliques sur 500$ dus = 100%, jamais plus meme si 700$ ont ete recus');
});

test('taux de recouvrement : un eleve d\'une autre classe ayant deja tout paye ne doit pas fausser une classe non payee', async () => {
  const classePayee = await creerClasse({ frais_scolarite: 400 });
  const elevePaye = await creerEleve(classePayee.id);
  await ctx.api('POST', '/api/paiements', { eleve_id: elevePaye.id, montant: 400, devise: 'USD', type_paiement: 'scolarite' });

  const classeNonPayee = await creerClasse({ frais_scolarite: 600 });
  await creerEleve(classeNonPayee.id);

  const { body } = await ctx.api('GET', `/api/classes/${classeNonPayee.id}/stats`);
  assert.equal(Number(body.stats.total_paye), 0, 'le recouvrement de la classe non payee ne doit rien devoir a une autre classe');
});
