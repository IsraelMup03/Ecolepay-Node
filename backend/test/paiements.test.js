const { setupTestDb, teardownTestDb } = require('./_helpers/testDb');
const dbFile = setupTestDb(); // doit rester avant tout require touchant src/config/db.js

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./_helpers/app');
const { creerClasse, creerEleve, tokenAdmin, db } = require('./_helpers/fixtures');

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

test('annuler un paiement exige un motif', async () => {
  const classe = await creerClasse({ frais_scolarite: 300 });
  const eleve = await creerEleve(classe.id);
  const paiement = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 100, devise: 'USD', type_paiement: 'scolarite' });

  const res = await ctx.api('POST', `/api/paiements/${paiement.body.id}/annuler`, {});
  assert.equal(res.status, 400);
});

test('annuler un paiement le retire de tous les calculs (fiche eleve, exactement comme un remboursement total)', async () => {
  const classe = await creerClasse({ frais_scolarite: 300 });
  const eleve = await creerEleve(classe.id);
  const paiement = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 100, devise: 'USD', type_paiement: 'scolarite' });

  const avant = await ctx.api('GET', `/api/eleves/${eleve.id}`);
  assert.equal(Number(avant.body.totaux.totalPayeScolarite), 100);

  const annulation = await ctx.api('POST', `/api/paiements/${paiement.body.id}/annuler`, { motif: 'Double saisie par erreur' });
  assert.equal(annulation.status, 200);

  const apres = await ctx.api('GET', `/api/eleves/${eleve.id}`);
  assert.equal(Number(apres.body.totaux.totalPayeScolarite), 0, 'un paiement annule ne doit plus compter dans le total paye');

  const [[row]] = await db.query('SELECT statut, motif_annulation, annule_par FROM paiements WHERE id=?', [paiement.body.id]);
  assert.equal(row.statut, 'annule');
  assert.equal(row.motif_annulation, 'Double saisie par erreur');
  assert.equal(row.annule_par, 1);
});

test('impossible d\'annuler deux fois le meme paiement', async () => {
  const classe = await creerClasse({ frais_scolarite: 300 });
  const eleve = await creerEleve(classe.id);
  const paiement = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 100, devise: 'USD', type_paiement: 'scolarite' });

  const premiere = await ctx.api('POST', `/api/paiements/${paiement.body.id}/annuler`, { motif: 'Erreur' });
  assert.equal(premiere.status, 200);

  const seconde = await ctx.api('POST', `/api/paiements/${paiement.body.id}/annuler`, { motif: 'Encore' });
  assert.equal(seconde.status, 400);
});

test('annuler un paiement fait bouger le tableau de bord (Total encaisse) exactement du montant annule', async () => {
  const classe = await creerClasse({ frais_scolarite: 300 });
  const eleve = await creerEleve(classe.id);
  const paiement = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 120, devise: 'USD', type_paiement: 'scolarite' });

  const avant = await ctx.api('GET', '/api/dashboard');
  await ctx.api('POST', `/api/paiements/${paiement.body.id}/annuler`, { motif: 'Test coherence tableau de bord' });
  const apres = await ctx.api('GET', '/api/dashboard');

  assert.equal(Math.round((avant.body.stats.totalAnnee - apres.body.stats.totalAnnee) * 100) / 100, 120);
});

test('annuler un paiement avec un surplus non rendu le marque automatiquement comme rendu', async () => {
  const classe = await creerClasse({ frais_scolarite: 100 });
  const eleve = await creerEleve(classe.id);
  const paiement = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 150, devise: 'USD', type_paiement: 'scolarite' });
  assert.equal(paiement.body.surplus, 50);

  await ctx.api('POST', `/api/paiements/${paiement.body.id}/annuler`, { motif: 'Erreur de saisie' });

  const [[row]] = await db.query('SELECT surplus_rembourse FROM paiements WHERE id=?', [paiement.body.id]);
  assert.equal(Number(row.surplus_rembourse), 1, 'un surplus sur un paiement annule ne doit plus rester "a rendre"');
});

test('annuler un paiement cree une entree dans la corbeille', async () => {
  const classe = await creerClasse({ frais_scolarite: 300 });
  const eleve = await creerEleve(classe.id);
  const paiement = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 100, devise: 'USD', type_paiement: 'scolarite' });

  await ctx.api('POST', `/api/paiements/${paiement.body.id}/annuler`, { motif: 'Erreur de saisie' });

  const [[row]] = await db.query("SELECT id, donnees FROM corbeille WHERE table_source='paiements' AND restaure=0 ORDER BY id DESC LIMIT 1");
  assert.ok(row, 'une entree de corbeille doit exister pour ce paiement annule');
  assert.equal(JSON.parse(row.donnees).id, paiement.body.id);
});

test('restaurer un paiement annule depuis la corbeille le remet valide et recompte dans les totaux', async () => {
  const classe = await creerClasse({ frais_scolarite: 300 });
  const eleve = await creerEleve(classe.id);
  const paiement = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 100, devise: 'USD', type_paiement: 'scolarite' });
  await ctx.api('POST', `/api/paiements/${paiement.body.id}/annuler`, { motif: 'Erreur de saisie' });

  const pendantAnnulation = await ctx.api('GET', `/api/eleves/${eleve.id}`);
  assert.equal(Number(pendantAnnulation.body.totaux.totalPayeScolarite), 0);

  const [[corbeilleRow]] = await db.query("SELECT id FROM corbeille WHERE table_source='paiements' AND restaure=0 ORDER BY id DESC LIMIT 1");
  const restore = await ctx.api('POST', `/api/corbeille/${corbeilleRow.id}/restaurer`);
  assert.equal(restore.status, 200);

  const [[row]] = await db.query('SELECT statut, motif_annulation, annule_par FROM paiements WHERE id=?', [paiement.body.id]);
  assert.equal(row.statut, 'valide');
  assert.equal(row.motif_annulation, null);
  assert.equal(row.annule_par, null);

  const apresRestauration = await ctx.api('GET', `/api/eleves/${eleve.id}`);
  assert.equal(Number(apresRestauration.body.totaux.totalPayeScolarite), 100, 'le paiement restaure doit de nouveau compter');
});

test('restaurer un paiement annule redonne son surplus_rembourse d\'origine (pas force a rendu)', async () => {
  const classe = await creerClasse({ frais_scolarite: 100 });
  const eleve = await creerEleve(classe.id);
  const paiement = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 150, devise: 'USD', type_paiement: 'scolarite' });
  assert.equal(paiement.body.surplus, 50);

  await ctx.api('POST', `/api/paiements/${paiement.body.id}/annuler`, { motif: 'Erreur' });
  const [[corbeilleRow]] = await db.query("SELECT id FROM corbeille WHERE table_source='paiements' AND restaure=0 ORDER BY id DESC LIMIT 1");
  await ctx.api('POST', `/api/corbeille/${corbeilleRow.id}/restaurer`);

  const [[row]] = await db.query('SELECT surplus_rembourse FROM paiements WHERE id=?', [paiement.body.id]);
  assert.equal(Number(row.surplus_rembourse), 0, 'avant l\'annulation le surplus n\'avait pas encore ete rendu');
});
