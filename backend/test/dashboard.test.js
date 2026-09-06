const { setupTestDb, teardownTestDb } = require('./_helpers/testDb');
const dbFile = setupTestDb();

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./_helpers/app');
const { creerClasse, creerEleve, tokenAdmin } = require('./_helpers/fixtures');

let ctx;
before(async () => { ctx = await startTestServer(tokenAdmin()); });
after(async () => { await ctx.close(); await teardownTestDb(dbFile); });

async function totalAnnee() {
  const { body } = await ctx.api('GET', '/api/dashboard');
  return body.stats.totalAnnee;
}

test('Total encaisse inclut le surplus tant qu\'il n\'a pas ete rendu (regression)', async () => {
  const classe = await creerClasse({ frais_scolarite: 550 });
  const eleve = await creerEleve(classe.id);

  const avant = await totalAnnee();
  const { body: paiement } = await ctx.api('POST', '/api/paiements', {
    eleve_id: eleve.id, montant: 600, devise: 'USD', type_paiement: 'scolarite',
  });
  assert.equal(paiement.surplus, 50);

  const apres = await totalAnnee();
  assert.equal(Math.round((apres - avant) * 100) / 100, 600, 'les 600$ recus doivent tous compter dans Total encaisse, surplus compris');

  // On rend le surplus : Total encaisse doit redescendre de 50$ (regression du bug signale
  // par l'utilisateur : rendre un surplus doit reellement le retirer du total).
  const rendu = await ctx.api('POST', `/api/paiements/${paiement.id}/surplus-rembourse`, {});
  assert.equal(rendu.status, 200);

  const apresRendu = await totalAnnee();
  assert.equal(Math.round((apresRendu - avant) * 100) / 100, 550, 'seuls les 550$ effectivement dus doivent rester comptes une fois le surplus rendu');
});

