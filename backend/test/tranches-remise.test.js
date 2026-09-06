const { setupTestDb, teardownTestDb } = require('./_helpers/testDb');
const dbFile = setupTestDb();

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./_helpers/app');
const { creerClasse, creerEleve, creerTranche, tokenAdmin, db } = require('./_helpers/fixtures');

let ctx;
before(async () => { ctx = await startTestServer(tokenAdmin()); });
after(async () => { await ctx.close(); teardownTestDb(dbFile); });

test('creer une classe avec des tranches : le total est la somme, les lignes classe_tranches sont creees', async () => {
  const { status, body } = await ctx.api('POST', '/api/classes', {
    nom: '1ere Secondaire', frais_inscription: 80, tranches: [400, 200, 150],
  });
  assert.equal(status, 201);
  assert.equal(Number(body.frais_scolarite), 750);

  const { body: tranches } = await ctx.api('GET', `/api/classes/${body.id}/tranches`);
  assert.deepEqual(tranches.map((t) => [t.numero, Number(t.montant)]), [[1, 400], [2, 200], [3, 150]]);
});

test('modifier une classe sans le champ tranches ne touche pas a son decoupage existant', async () => {
  const classe = await creerClasse({ frais_scolarite: 750 });
  await creerTranche(classe.id, 1, 400);
  await creerTranche(classe.id, 2, 350);

  await ctx.api('PUT', `/api/classes/${classe.id}`, { nom: classe.nom, frais_scolarite: 750, frais_inscription: 50, effectif_max: 50, ordre: 0 });

  const { body: tranches } = await ctx.api('GET', `/api/classes/${classe.id}/tranches`);
  assert.equal(tranches.length, 2, 'les tranches existantes doivent survivre a une modification qui ne fournit pas le champ tranches');
});

test('modifier une classe avec un nouveau tableau de tranches remplace l\'ancien decoupage', async () => {
  const classe = await creerClasse({ frais_scolarite: 750 });
  await creerTranche(classe.id, 1, 400);
  await creerTranche(classe.id, 2, 350);

  const res = await ctx.api('PUT', `/api/classes/${classe.id}`, { nom: classe.nom, frais_inscription: 50, effectif_max: 50, ordre: 0, tranches: [300, 300, 300] });
  assert.equal(Number(res.body.frais_scolarite), 900);

  const { body: tranches } = await ctx.api('GET', `/api/classes/${classe.id}/tranches`);
  assert.equal(tranches.length, 3);
});

test('remise : PUT /eleves/:id/remise recalcule frais_scolarite_total', async () => {
  const classe = await creerClasse({ frais_scolarite: 600 });
  const eleve = await creerEleve(classe.id);

  const res = await ctx.api('PUT', `/api/eleves/${eleve.id}/remise`, { remise_pourcentage: 10 });
  assert.equal(res.status, 200);

  const [[apres]] = await db.query('SELECT remise_pourcentage, frais_scolarite_total FROM eleves WHERE id=?', [eleve.id]);
  assert.equal(Number(apres.remise_pourcentage), 10);
  assert.equal(Number(apres.frais_scolarite_total), 540, '600 - 10% doit donner 540');
});

test('remise : rejette une valeur hors de 0-100', async () => {
  const classe = await creerClasse({ frais_scolarite: 500 });
  const eleve = await creerEleve(classe.id);
  const res = await ctx.api('PUT', `/api/eleves/${eleve.id}/remise`, { remise_pourcentage: 150 });
  assert.equal(res.status, 400);
});

test('progression par tranche : calcul en cascade, avec et sans remise', async () => {
  const classe = await creerClasse({ frais_scolarite: 750 });
  await creerTranche(classe.id, 1, 400);
  await creerTranche(classe.id, 2, 200);
  await creerTranche(classe.id, 3, 150);
  const eleve = await creerEleve(classe.id);

  // Paye 500$ : tranche 1 (400) entierement couverte, tranche 2 a 100/200 (50%), tranche 3 a 0%.
  await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 500, devise: 'USD', type_paiement: 'scolarite' });

  const { body } = await ctx.api('GET', `/api/eleves/${eleve.id}`);
  const t = body.tranches;
  assert.equal(t.length, 3);
  assert.equal(t[0].pct, 100);
  assert.equal(t[1].pct, 50);
  assert.equal(t[2].pct, 0);
});

test('progression par tranche : la derniere tranche affiche 100% quand l\'eleve est reellement solde (pas d\'arrondi flottant)', async () => {
  const classe = await creerClasse({ frais_scolarite: 750 });
  await creerTranche(classe.id, 1, 400);
  await creerTranche(classe.id, 2, 200);
  await creerTranche(classe.id, 3, 150);
  const eleve = await creerEleve(classe.id, { remise_pourcentage: 10 });

  // Doit desormais devoir 750 * 0.9 = 675 au total.
  await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 675, devise: 'USD', type_paiement: 'scolarite' });

  const { body } = await ctx.api('GET', `/api/eleves/${eleve.id}`);
  const derniere = body.tranches[body.tranches.length - 1];
  assert.equal(derniere.pct, 100, 'un eleve reellement solde doit toujours voir 100% sur sa derniere tranche');
});

test('transferer conserve la remise deja accordee sur le nouveau montant', async () => {
  const classeA = await creerClasse({ frais_scolarite: 300 });
  const classeB = await creerClasse({ frais_scolarite: 1000 });
  const eleve = await creerEleve(classeA.id, { remise_pourcentage: 20 });

  const res = await ctx.api('POST', `/api/eleves/${eleve.id}/transferer`, { classe_id: classeB.id });
  assert.equal(res.status, 200);

  const [[apres]] = await db.query('SELECT remise_pourcentage, frais_scolarite_total FROM eleves WHERE id=?', [eleve.id]);
  assert.equal(Number(apres.remise_pourcentage), 20, 'la remise elle-meme ne doit pas etre touchee par un transfert');
  assert.equal(Number(apres.frais_scolarite_total), 800, '1000 - 20% doit donner 800');
});

// A partir d'ici, les tests touchent a la promotion annuelle, qui avance
// annee_scolaire_courante (un parametre global partage par toute la base de ce fichier) --
// les placer en dernier evite de fausser les tests precedents, qui dependent tous de
// coincider avec l'annee scolaire courante au moment ou ils creent leurs eleves/paiements.

test('promotion conserve la remise deja accordee sur le nouveau montant', async () => {
  const classeSup = await creerClasse({ frais_scolarite: 1000 });
  const classeDep = await creerClasse({ frais_scolarite: 500, classe_superieure_id: classeSup.id });
  const eleve = await creerEleve(classeDep.id, { remise_pourcentage: 15 });

  const res = await ctx.api('POST', '/api/promotion/executer', { nouvelle_annee: '2025-2026' });
  assert.equal(res.status, 200);

  const [[apres]] = await db.query('SELECT remise_pourcentage, frais_scolarite_total FROM eleves WHERE id=?', [eleve.id]);
  assert.equal(Number(apres.remise_pourcentage), 15);
  assert.equal(Number(apres.frais_scolarite_total), 850, '1000 - 15% doit donner 850');
});

test('reinitialiser ne plante pas quand des sections et des tranches existent (regression)', async () => {
  const classe = await creerClasse({ frais_scolarite: 750 });
  await creerTranche(classe.id, 1, 400);
  await ctx.api('POST', `/api/classes/${classe.id}/sections`, { nom: 'A' });

  const res = await ctx.api('POST', '/api/parametres/reinitialiser', { confirmation: 'CONFIRMER' });
  assert.equal(res.status, 200);

  const [[{ n }]] = await db.query('SELECT COUNT(*) as n FROM classes');
  assert.equal(n, 0);
});
