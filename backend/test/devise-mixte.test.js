// Verifie la repartition par devise reellement saisie (usd/cdf/cdfEnUsd) exposee a cote
// de chaque total mixte, sur les points d'entree les plus a risque : un eleve dont les
// paiements melangent USD et CDF (eleves.js), une ligne a devise NULL (doit tomber dans
// le panier USD par defaut, comme le reste du logiciel), et le fait que le surplus
// (toujours en USD, quelle que soit la devise de la ligne) ne doit jamais polluer le
// panier CDF meme sur un paiement CDF-natif.
const { setupTestDb, teardownTestDb } = require('./_helpers/testDb');
const dbFile = setupTestDb();

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./_helpers/app');
const { creerClasse, creerEleve, creerPaiementBrut, tokenAdmin } = require('./_helpers/fixtures');

let ctx;
before(async () => { ctx = await startTestServer(tokenAdmin()); });
after(async () => { await ctx.close(); await teardownTestDb(dbFile); });

test('un paiement CDF-natif seul : le panier USD reste a 0, le panier CDF porte tout', async () => {
  const classe = await creerClasse({ frais_scolarite: 1000 });
  const eleve = await creerEleve(classe.id);
  await creerPaiementBrut(eleve.id, {
    type_paiement: 'scolarite', montant: 280000, devise: 'CDF', montant_usd: 100, montant_local: 280000, taux_change: 2800,
  });

  const { body } = await ctx.api('GET', `/api/eleves/${eleve.id}`);
  const rep = body.totaux.totalPayeScolariteParDevise;
  assert.equal(rep.usd, 0);
  assert.equal(rep.cdf, 280000);
  assert.equal(rep.cdfEnUsd, 100);
  assert.equal(body.totaux.totalPayeScolarite, 100, 'le total blende ne doit pas changer');
});

test('un mix USD + CDF sur le meme eleve se recombine exactement au total blende existant', async () => {
  const classe = await creerClasse({ frais_scolarite: 1000 });
  const eleve = await creerEleve(classe.id);
  await creerPaiementBrut(eleve.id, {
    type_paiement: 'scolarite', montant: 300, devise: 'USD', montant_usd: 300, montant_local: 840000, taux_change: 2800,
  });
  await creerPaiementBrut(eleve.id, {
    type_paiement: 'scolarite', montant: 560000, devise: 'CDF', montant_usd: 200, montant_local: 560000, taux_change: 2800,
  });

  const { body } = await ctx.api('GET', `/api/eleves/${eleve.id}`);
  const rep = body.totaux.totalPayeScolariteParDevise;
  assert.equal(rep.usd, 300);
  assert.equal(rep.cdf, 560000);
  assert.equal(rep.cdfEnUsd, 200);
  assert.equal(body.totaux.totalPayeScolarite, 500);
  assert.equal(rep.usd + rep.cdfEnUsd, body.totaux.totalPayeScolarite, 'usd + cdfEnUsd doit toujours reconcilier exactement au total blende');
});

test('une ligne a devise NULL (insertion directe) tombe dans le panier USD par defaut', async () => {
  const classe = await creerClasse({ frais_scolarite: 1000 });
  const eleve = await creerEleve(classe.id);
  await creerPaiementBrut(eleve.id, {
    type_paiement: 'scolarite', montant: 150, devise: null, montant_usd: 150, montant_local: 420000, taux_change: 2800,
  });

  const { body } = await ctx.api('GET', `/api/eleves/${eleve.id}`);
  const rep = body.totaux.totalPayeScolariteParDevise;
  assert.equal(rep.usd, 150, 'une devise NULL doit etre traitee comme USD, pas ignoree ni jetee en CDF');
  assert.equal(rep.cdf, 0);
});

test('le surplus (toujours en USD) sur un paiement CDF-natif ne doit jamais compter dans le panier CDF', async () => {
  const classe = await creerClasse({ frais_scolarite: 100 });
  const eleve = await creerEleve(classe.id);
  // Paye 280 000 FC (100 USD equivalent) sur une dette de 100 USD via un premier paiement
  // pour l'inscrire, puis un second paiement CDF genere un surplus de 50 USD (140 000 FC).
  await creerPaiementBrut(eleve.id, {
    type_paiement: 'scolarite', montant: 280000, devise: 'CDF', montant_usd: 100, montant_local: 280000, taux_change: 2800, montant_surplus: 0,
  });
  await creerPaiementBrut(eleve.id, {
    type_paiement: 'scolarite', montant: 140000, devise: 'CDF', montant_usd: 0, montant_local: 140000, taux_change: 2800, montant_surplus: 50, surplus_rembourse: 0,
  });

  const { body: dashboard } = await ctx.api('GET', '/api/dashboard');
  const rep = dashboard.stats.totalAnneeParDevise;
  // Le surplus de 50$ doit atterrir dans le panier USD meme si la ligne qui l'a genere est
  // CDF-native -- sinon "usd + cdfEnUsd" ne reconcilierait plus au total blende affiche.
  assert.ok(rep.usd >= 50, `le panier USD (${rep.usd}) doit inclure le surplus de 50$ genere par une ligne CDF-native`);
  assert.equal(Math.round((rep.usd + rep.cdfEnUsd) * 100) / 100, Math.round(dashboard.stats.totalAnnee * 100) / 100, 'usd + cdfEnUsd doit reconcilier exactement au total encaisse affiche');
});
