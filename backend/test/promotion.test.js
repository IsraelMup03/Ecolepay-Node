// Verrouille le vrai comportement de la promotion annuelle (voir le guide utilisateur,
// corrige pour refleter ceci) : le marquage "redoublant" est informatif, il n'empeche PAS
// a lui seul la promotion automatique -- tous les eleves actifs avancent, sans exception.
const { setupTestDb, teardownTestDb } = require('./_helpers/testDb');
const dbFile = setupTestDb();

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./_helpers/app');
const { creerClasse, creerEleve, tokenAdmin, db } = require('./_helpers/fixtures');

let ctx;
before(async () => { ctx = await startTestServer(tokenAdmin()); });
after(async () => { await ctx.close(); await teardownTestDb(dbFile); });

test('la promotion avance TOUS les eleves actifs, y compris ceux marques redoublants', async () => {
  const classeSup = await creerClasse({ frais_scolarite: 600, nom: 'Classe superieure' });
  const classeDep = await creerClasse({ frais_scolarite: 500, nom: 'Classe de depart', classe_superieure_id: classeSup.id });

  const eleveNormal = await creerEleve(classeDep.id, { redoublant: false });
  const eleveRedoublant = await creerEleve(classeDep.id, { redoublant: true });

  const res = await ctx.api('POST', '/api/promotion/executer', { nouvelle_annee: '2025-2026' });
  assert.equal(res.status, 200);
  assert.equal(res.body.nbPromus, 2, 'les 2 eleves actifs (redoublant inclus) doivent etre promus');

  const [[apresNormal]] = await db.query('SELECT classe_id, redoublant, annee_scolaire FROM eleves WHERE id=?', [eleveNormal.id]);
  const [[apresRedoublant]] = await db.query('SELECT classe_id, redoublant, annee_scolaire FROM eleves WHERE id=?', [eleveRedoublant.id]);

  assert.equal(apresNormal.classe_id, classeSup.id);
  assert.equal(apresRedoublant.classe_id, classeSup.id, 'un redoublant avance quand meme automatiquement (a retrograder manuellement si besoin)');
  assert.equal(apresRedoublant.redoublant, 0, 'le marquage redoublant doit etre remis a zero pour la nouvelle annee');
  assert.equal(apresNormal.annee_scolaire, '2025-2026');
});

test('un eleve dans une classe sans classe superieure est diplome, pas promu', async () => {
  const classeTerminale = await creerClasse({ frais_scolarite: 700, nom: 'Terminale', classe_superieure_id: null });
  const finissant = await creerEleve(classeTerminale.id);

  // La promotion precedente a deja avance annee_scolaire_courante : on part de la valeur
  // reelle du moment plutot que de l'annee de depart figee, puisque ce test s'execute apres
  // le premier dans le meme fichier/meme base (chaque promotion mute cet etat global).
  const res = await ctx.api('POST', '/api/promotion/executer', { nouvelle_annee: '2026-2027' });
  assert.equal(res.status, 200);
  assert.ok(res.body.nbDiplomes >= 1);

  const [[apres]] = await db.query('SELECT statut, classe_id FROM eleves WHERE id=?', [finissant.id]);
  assert.equal(apres.statut, 'diplome');
  assert.equal(apres.classe_id, classeTerminale.id, 'un diplome reste rattache a sa derniere classe, il n\'est pas deplace');
});

test('la promotion archive la situation financiere de l\'annee qui se termine, base uniquement sur la scolarite', async () => {
  const classeSup = await creerClasse({ frais_scolarite: 300 });
  const classe = await creerClasse({ frais_scolarite: 400, classe_superieure_id: classeSup.id });
  const eleveSolde = await creerEleve(classe.id);
  const eleveNonPaye = await creerEleve(classe.id);

  await ctx.api('POST', '/api/paiements', { eleve_id: eleveSolde.id, montant: 400, devise: 'USD', type_paiement: 'scolarite' });
  // Paiement "autre" pur pour eleveNonPaye : ne doit pas le faire compter comme solde/partiel.
  await ctx.api('POST', '/api/paiements', { eleve_id: eleveNonPaye.id, montant: 200, devise: 'USD', type_paiement: 'autre' });

  // L'annee qui va etre archivee est celle en cours AU MOMENT de cet appel (deja avancee
  // deux fois par les tests precedents dans ce meme fichier) : on la lit dynamiquement au
  // lieu de supposer la constante de depart ANNEE_COURANTE.
  const [[{ valeur: anneeArchivee }]] = await db.query("SELECT valeur FROM parametres WHERE cle='annee_scolaire_courante'");
  await ctx.api('POST', '/api/promotion/executer', { nouvelle_annee: '2027-2028' });

  const [[archiveSolde]] = await db.query('SELECT statut_paiement, total_paye FROM archives_annuelles WHERE eleve_id=? AND annee_scolaire=?', [eleveSolde.id, anneeArchivee]);
  const [[archiveNonPaye]] = await db.query('SELECT statut_paiement, total_paye FROM archives_annuelles WHERE eleve_id=? AND annee_scolaire=?', [eleveNonPaye.id, anneeArchivee]);

  assert.equal(archiveSolde.statut_paiement, 'solde');
  assert.equal(archiveNonPaye.statut_paiement, 'non_paye', 'un paiement "autre" seul ne doit jamais compter comme scolarite payee dans l\'archive');
  assert.equal(Number(archiveNonPaye.total_paye), 0);
});
