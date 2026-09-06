const { setupTestDb, teardownTestDb } = require('./_helpers/testDb');
const dbFile = setupTestDb();

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./_helpers/app');
const { creerClasse, creerEleve, tokenAdmin, db } = require('./_helpers/fixtures');

let ctx;
before(async () => { ctx = await startTestServer(tokenAdmin()); });
after(async () => { await ctx.close(); teardownTestDb(dbFile); });

test('creer une classe pivot force classe_superieure_id a null meme si fourni', async () => {
  const cible = await creerClasse({ frais_scolarite: 400 });
  const { status, body } = await ctx.api('POST', '/api/classes', {
    nom: '8eme Secondaire', frais_scolarite: 500, frais_inscription: 60,
    classe_superieure_id: cible.id, est_pivot: true,
  });
  assert.equal(status, 201);
  assert.equal(body.est_pivot, 1);
  assert.equal(body.classe_superieure_id, null);
});

test('modifier une classe existante en pivot efface sa classe_superieure_id', async () => {
  const cible = await creerClasse({ frais_scolarite: 400 });
  const classe = await creerClasse({ frais_scolarite: 500, classe_superieure_id: cible.id });

  const { status, body } = await ctx.api('PUT', `/api/classes/${classe.id}`, {
    nom: classe.nom, frais_scolarite: 500, frais_inscription: 50,
    classe_superieure_id: cible.id, est_pivot: true, effectif_max: 50, ordre: 0, actif: 1,
  });
  assert.equal(status, 200);
  assert.equal(body.est_pivot, 1);
  assert.equal(body.classe_superieure_id, null);
});

test('promotion : un eleve d\'une classe pivot n\'est ni promu ni diplome, seulement son annee avance', async () => {
  const pivot = await creerClasse({ frais_scolarite: 500, est_pivot: 1 });
  const eleve = await creerEleve(pivot.id, { redoublant: true });

  const preview = await ctx.api('GET', '/api/promotion/preview');
  const ligne = preview.body.eleves.find((e) => e.id === eleve.id);
  assert.equal(ligne.est_pivot, 1);
  assert.equal(ligne.classe_suivante, null);

  const res = await ctx.api('POST', '/api/promotion/executer', { nouvelle_annee: '2025-2026' });
  assert.equal(res.status, 200);
  assert.equal(res.body.nbEnAttenteOrientation, 1);

  const [[apres]] = await db.query('SELECT classe_id, section_id, statut, redoublant, annee_scolaire FROM eleves WHERE id=?', [eleve.id]);
  assert.equal(apres.classe_id, pivot.id, 'reste dans sa classe pivot');
  assert.equal(apres.statut, 'actif');
  assert.equal(Number(apres.redoublant), 0);
  assert.equal(apres.annee_scolaire, '2025-2026', 'son annee avance quand meme');
});

test('apres promotion, un transfert manuel deplace bien l\'eleve en attente vers la classe choisie', async () => {
  const pivot = await creerClasse({ frais_scolarite: 500, est_pivot: 1 });
  const optionSciences = await creerClasse({ frais_scolarite: 650, frais_inscription: 70 });
  const eleve = await creerEleve(pivot.id);

  await ctx.api('POST', '/api/promotion/executer', { nouvelle_annee: '2025-2026' });

  const res = await ctx.api('POST', `/api/eleves/${eleve.id}/transferer`, { classe_id: optionSciences.id });
  assert.equal(res.status, 200);

  const [[apres]] = await db.query('SELECT classe_id, frais_scolarite_total FROM eleves WHERE id=?', [eleve.id]);
  assert.equal(apres.classe_id, optionSciences.id);
  assert.equal(Number(apres.frais_scolarite_total), 650);
});
