const { setupTestDb, teardownTestDb } = require('./_helpers/testDb');
const dbFile = setupTestDb();

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./_helpers/app');
const { creerClasse, creerEleve, creerSection, tokenAdmin, db } = require('./_helpers/fixtures');

let ctx;
before(async () => { ctx = await startTestServer(tokenAdmin()); });
after(async () => { await ctx.close(); teardownTestDb(dbFile); });

test('creer une classe avec nb_sections genere automatiquement les sections A/B/C', async () => {
  const { status, body } = await ctx.api('POST', '/api/classes', {
    nom: '1ere Secondaire', frais_scolarite: 600, frais_inscription: 80, nb_sections: 3,
  });
  assert.equal(status, 201);

  const { body: sections } = await ctx.api('GET', `/api/classes/${body.id}/sections`);
  assert.deepEqual(sections.map((s) => s.nom), ['A', 'B', 'C']);
});

test('promotion : un eleve promu perd sa section (doit la re-choisir au premier paiement)', async () => {
  const classeSup = await creerClasse({ frais_scolarite: 600 });
  await creerSection(classeSup.id, 'A');
  await creerSection(classeSup.id, 'B');
  const classeDep = await creerClasse({ frais_scolarite: 500, classe_superieure_id: classeSup.id });
  const sectionDep = await creerSection(classeDep.id, 'A');
  const eleve = await creerEleve(classeDep.id, { section_id: sectionDep.id });

  await ctx.api('POST', '/api/promotion/executer', { nouvelle_annee: '2025-2026' });

  const [[apres]] = await db.query('SELECT classe_id, section_id FROM eleves WHERE id=?', [eleve.id]);
  assert.equal(apres.classe_id, classeSup.id);
  assert.equal(apres.section_id, null, 'la section de l\'ancienne classe ne doit jamais survivre dans la nouvelle');
});

test('paiement scolarite sur une classe a sections : refuse sans section, accepte avec, puis n\'exige plus rien ensuite', async () => {
  const classe = await creerClasse({ frais_scolarite: 500 });
  const sectionA = await creerSection(classe.id, 'A');
  await creerSection(classe.id, 'B');
  const eleve = await creerEleve(classe.id);

  const sansSection = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 100, devise: 'USD', type_paiement: 'scolarite' });
  assert.equal(sansSection.status, 400);
  assert.ok(Array.isArray(sansSection.body.sectionsDisponibles) && sansSection.body.sectionsDisponibles.length === 2);

  const avecSection = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 100, devise: 'USD', type_paiement: 'scolarite', section_id: sectionA.id });
  assert.equal(avecSection.status, 201);

  const [[apres]] = await db.query('SELECT section_id FROM eleves WHERE id=?', [eleve.id]);
  assert.equal(apres.section_id, sectionA.id);

  // Deuxieme paiement : la section est deja fixee, plus besoin de la repreciser.
  const second = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 50, devise: 'USD', type_paiement: 'scolarite' });
  assert.equal(second.status, 201);
});

test('un paiement "autre" ne force jamais le choix de section', async () => {
  const classe = await creerClasse({ frais_scolarite: 500 });
  await creerSection(classe.id, 'A');
  const eleve = await creerEleve(classe.id);

  const res = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 20, devise: 'USD', type_paiement: 'cantine' });
  assert.equal(res.status, 201);
  const [[apres]] = await db.query('SELECT section_id FROM eleves WHERE id=?', [eleve.id]);
  assert.equal(apres.section_id, null);
});

test('une inscription neuve peut choisir directement sa section', async () => {
  const classe = await creerClasse({ frais_scolarite: 500 });
  const sectionB = await creerSection(classe.id, 'B');

  const res = await ctx.api('POST', '/api/eleves', {
    nom: 'Kalonji', prenom: 'Grace', genre: 'F', classe_id: classe.id, section_id: sectionB.id,
  });
  assert.equal(res.status, 201);
  const [[eleve]] = await db.query('SELECT section_id FROM eleves WHERE id=?', [res.body.eleve.id]);
  assert.equal(eleve.section_id, sectionB.id);
});

test('retrograder reinitialise la section', async () => {
  const classeInf = await creerClasse({ frais_scolarite: 400 });
  const classe = await creerClasse({ frais_scolarite: 500, classe_inferieure_id: classeInf.id });
  const section = await creerSection(classe.id, 'A');
  const eleve = await creerEleve(classe.id, { section_id: section.id });

  const res = await ctx.api('POST', `/api/eleves/${eleve.id}/retrograder`, {});
  assert.equal(res.status, 200);
  const [[apres]] = await db.query('SELECT classe_id, section_id FROM eleves WHERE id=?', [eleve.id]);
  assert.equal(apres.classe_id, classeInf.id);
  assert.equal(apres.section_id, null);
});

test('transferer change de classe et de section, synchronise les frais', async () => {
  const classeA = await creerClasse({ frais_scolarite: 300 });
  const classeB = await creerClasse({ frais_scolarite: 700 });
  const sectionB = await creerSection(classeB.id, 'A');
  const eleve = await creerEleve(classeA.id);

  const res = await ctx.api('POST', `/api/eleves/${eleve.id}/transferer`, { classe_id: classeB.id, section_id: sectionB.id });
  assert.equal(res.status, 200);

  const [[apres]] = await db.query('SELECT classe_id, section_id, frais_scolarite_total FROM eleves WHERE id=?', [eleve.id]);
  assert.equal(apres.classe_id, classeB.id);
  assert.equal(apres.section_id, sectionB.id);
  assert.equal(Number(apres.frais_scolarite_total), 700);
});

test('transferer sans jeton admin est refuse (403)', async () => {
  // Reutilise l'app mais signe un jeton non-admin pour cet appel precis.
  const jwt = require('jsonwebtoken');
  const classe = await creerClasse({ frais_scolarite: 300 });
  const cible = await creerClasse({ frais_scolarite: 300 });
  const eleve = await creerEleve(classe.id);
  const [res] = await db.query(
    `INSERT INTO utilisateurs (nom, prenom, email, mot_de_passe, role, permissions, actif, premier_connexion) VALUES (?,?,?,?,?,?,1,0)`,
    ['Caissier', 'Test', 'caissier-test@ecolepay.com', 'x', 'caissier', JSON.stringify({ eleves: true, paiements: true })]
  );
  const tokenNonAdmin = jwt.sign({ id: res.insertId, role: 'caissier' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const ctxNonAdmin = await require('./_helpers/app').startTestServer(tokenNonAdmin);
  try {
    const r = await ctxNonAdmin.api('POST', `/api/eleves/${eleve.id}/transferer`, { classe_id: cible.id });
    assert.equal(r.status, 403);
  } finally {
    await ctxNonAdmin.close();
  }
});
