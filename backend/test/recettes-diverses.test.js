const { setupTestDb, teardownTestDb } = require('./_helpers/testDb');
const dbFile = setupTestDb();

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { startTestServer } = require('./_helpers/app');
const { tokenAdmin, db, ANNEE_COURANTE } = require('./_helpers/fixtures');

let ctx;
before(async () => { ctx = await startTestServer(tokenAdmin()); });
after(async () => { await ctx.close(); teardownTestDb(dbFile); });

test('creer une recette diverse : reference generee, montant_usd calcule', async () => {
  const res = await ctx.api('POST', '/api/comptabilite/recettes-diverses', {
    categorie: 'subvention', montant: 300, devise: 'USD', provenance: 'Ministere', description: 'Appui trimestriel',
  });
  assert.equal(res.status, 201);
  assert.ok(res.body.reference.startsWith('REC-'));

  const [[row]] = await db.query('SELECT * FROM recettes_diverses WHERE id=?', [res.body.id]);
  assert.equal(Number(row.montant_usd), 300);
  assert.equal(row.categorie, 'subvention');
});

test('categorie invalide est rejetee', async () => {
  const res = await ctx.api('POST', '/api/comptabilite/recettes-diverses', { categorie: 'inexistante', montant: 50, devise: 'USD' });
  assert.equal(res.status, 400);
});

test('GET /comptabilite/resume : totalRecettes et solde incluent les recettes diverses', async () => {
  await ctx.api('POST', '/api/comptabilite/depenses', { categorie: 'autre', montant: 40, devise: 'USD', beneficiaire: 'Fournisseur' });
  await ctx.api('POST', '/api/comptabilite/recettes-diverses', { categorie: 'don', montant: 120, devise: 'USD', provenance: 'Association parents' });

  const res = await ctx.api('GET', `/api/comptabilite/resume?annee=${ANNEE_COURANTE}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.totalRecettes >= 120, 'la recette diverse doit compter dans totalRecettes');
  assert.equal(Math.round((res.body.totalRecettes - res.body.totalDepenses) * 100) / 100, Math.round(res.body.solde * 100) / 100);
  const parCat = res.body.recettesDiversesParCategorie.find((c) => c.categorie === 'Don');
  assert.ok(parCat && parCat.total >= 120);
});

test('GET /dashboard : soldeNet reflete lui aussi les recettes diverses (coherence avec Comptabilite)', async () => {
  const comptaAvant = await ctx.api('GET', `/api/comptabilite/resume?annee=${ANNEE_COURANTE}`);
  await ctx.api('POST', '/api/comptabilite/recettes-diverses', { categorie: 'vente', montant: 75, devise: 'USD', provenance: 'Vente uniformes' });
  const comptaApres = await ctx.api('GET', `/api/comptabilite/resume?annee=${ANNEE_COURANTE}`);
  assert.equal(Math.round((comptaApres.body.solde - comptaAvant.body.solde) * 100) / 100, 75);

  const dashboard = await ctx.api('GET', '/api/dashboard');
  assert.equal(dashboard.status, 200);
  assert.equal(Math.round(dashboard.body.stats.soldeNet * 100) / 100, Math.round(comptaApres.body.solde * 100) / 100);
});

test('GET /dashboard : une recette diverse creee aujourd\'hui compte dans "Aujourd\'hui" et "Ce mois"', async () => {
  const avant = await ctx.api('GET', '/api/dashboard');
  await ctx.api('POST', '/api/comptabilite/recettes-diverses', { categorie: 'don', montant: 45, devise: 'USD', provenance: 'Donateur test' });
  const apres = await ctx.api('GET', '/api/dashboard');
  assert.equal(Math.round((apres.body.stats.paiementsAujourdhui - avant.body.stats.paiementsAujourdhui) * 100) / 100, 45);
  assert.equal(Math.round((apres.body.stats.paiementsMois - avant.body.stats.paiementsMois) * 100) / 100, 45);
});

test('GET /dashboard : "Evolution des encaissements" (mensuel) inclut les recettes diverses du mois', async () => {
  const avant = await ctx.api('GET', '/api/dashboard');
  const cleAvant = new Date().toISOString().slice(0, 7);
  const totalAvant = (avant.body.mensuel.find((m) => m.mk === cleAvant) || { total: 0 }).total;

  await ctx.api('POST', '/api/comptabilite/recettes-diverses', { categorie: 'don', montant: 33, devise: 'USD' });

  const apres = await ctx.api('GET', '/api/dashboard');
  const totalApres = (apres.body.mensuel.find((m) => m.mk === cleAvant) || { total: 0 }).total;
  assert.equal(Math.round((totalApres - totalAvant) * 100) / 100, 33);
});

test('GET /historique/:annee : total_encaisse inclut les recettes diverses de l\'annee', async () => {
  const avant = await ctx.api('GET', `/api/historique/${ANNEE_COURANTE}`);
  await ctx.api('POST', '/api/comptabilite/recettes-diverses', { categorie: 'subvention', montant: 88, devise: 'USD', provenance: 'Test historique' });
  const apres = await ctx.api('GET', `/api/historique/${ANNEE_COURANTE}`);
  assert.equal(Math.round((apres.body.resume.total_encaisse - avant.body.resume.total_encaisse) * 100) / 100, 88);
});

test('GET /rapports/download/periode.xlsx : le total encaisse et la feuille detail incluent une recette diverse du jour', async () => {
  await ctx.api('POST', '/api/comptabilite/recettes-diverses', { categorie: 'don', montant: 27, devise: 'USD', mode_paiement: 'especes', provenance: 'Test rapport periode' });

  const port = ctx.server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/rapports/download/periode.xlsx?type=jour`, {
    headers: { Authorization: `Bearer ${tokenAdmin()}` },
  });
  assert.equal(res.status, 200);
  const buffer = Buffer.from(await res.arrayBuffer());

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const noms = workbook.worksheets.map((ws) => ws.name);
  assert.ok(noms.includes('Détail des recettes diverses'), 'la feuille de detail des recettes diverses doit exister');

  const detail = workbook.getWorksheet('Détail des recettes diverses');
  let trouve = false;
  detail.eachRow((row) => {
    if (row.getCell(3).value === 'Test rapport periode') trouve = true;
  });
  assert.ok(trouve, 'la recette de test doit apparaitre dans le detail');
});

test('DELETE puis restauration depuis la corbeille remet la recette en place', async () => {
  const creation = await ctx.api('POST', '/api/comptabilite/recettes-diverses', { categorie: 'autre', montant: 60, devise: 'USD' });
  const del = await ctx.api('DELETE', `/api/comptabilite/recettes-diverses/${creation.body.id}`);
  assert.equal(del.status, 200);
  const [[disparue]] = await db.query('SELECT * FROM recettes_diverses WHERE id=?', [creation.body.id]);
  assert.equal(disparue, undefined);

  const [[corbeilleRow]] = await db.query("SELECT id FROM corbeille WHERE table_source='recettes_diverses' ORDER BY id DESC LIMIT 1");
  const restore = await ctx.api('POST', `/api/corbeille/${corbeilleRow.id}/restaurer`);
  assert.equal(restore.status, 200);
  const [[restauree]] = await db.query('SELECT * FROM recettes_diverses WHERE id=?', [creation.body.id]);
  assert.ok(restauree);
  assert.equal(Number(restauree.montant_usd), 60);
});
