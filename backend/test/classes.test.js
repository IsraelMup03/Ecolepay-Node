// Regression : GET /api/classes/:id/stats oubliait de filtrer le total paye par annee
// scolaire (contrairement a toutes les requetes equivalentes ailleurs dans l'app), ce qui
// recomptait les paiements d'une annee anterieure -- typiquement ceux d'un redoublant.
const { setupTestDb, teardownTestDb } = require('./_helpers/testDb');
const dbFile = setupTestDb();

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./_helpers/app');
const { creerClasse, creerEleve, creerPaiementBrut, tokenAdmin, ANNEE_COURANTE } = require('./_helpers/fixtures');

let ctx;
before(async () => { ctx = await startTestServer(tokenAdmin()); });
after(async () => { await ctx.close(); await teardownTestDb(dbFile); });

test('les stats d\'une classe ne comptent pas les paiements de scolarite d\'une annee anterieure (redoublant)', async () => {
  const classe = await creerClasse({ frais_scolarite: 500 });
  const eleve = await creerEleve(classe.id, { annee_scolaire: ANNEE_COURANTE });

  // Paiement de l'annee PRECEDENTE (ex: l'eleve redouble et avait deja paye l'an dernier) :
  // ne doit jamais compter dans le recouvrement de l'annee en cours.
  await creerPaiementBrut(eleve.id, { montant_usd: 500, montant: 500, annee_scolaire: '2023-2024' });

  const { body } = await ctx.api('GET', `/api/classes/${classe.id}/stats`);
  assert.equal(Number(body.stats.total_paye), 0, 'un paiement de l\'annee precedente ne doit pas gonfler le recouvrement de cette annee');
  assert.equal(Number(body.stats.total_attendu), 500);

  // Un paiement de l'annee EN COURS doit lui etre compte normalement.
  await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 200, devise: 'USD', type_paiement: 'scolarite' });
  const { body: apres } = await ctx.api('GET', `/api/classes/${classe.id}/stats`);
  assert.equal(Number(apres.stats.total_paye), 200);
});
