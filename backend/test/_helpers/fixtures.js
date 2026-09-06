// Petites aides pour construire des donnees de test (classe, eleve, jeton admin) sans
// repeter le SQL brut dans chaque fichier de test. Utilisent le meme module de connexion
// (src/config/db.js) que l'application -- donc la meme base de test que les routes appellent.
const jwt = require('jsonwebtoken');
const db = require('../../src/config/db');

let compteur = 0;
function unique(prefix) {
  compteur += 1;
  return `${prefix}-${Date.now()}-${compteur}`;
}

// '2024-2025' : doit correspondre a annee_scolaire_courante seedee par migrate-sqlite.js,
// sinon les routes qui filtrent sur l'annee active (dashboard, rapports...) ne verraient
// jamais les eleves/paiements crees par les fixtures.
const ANNEE_COURANTE = '2024-2025';

async function creerClasse(overrides = {}) {
  const c = {
    nom: unique('Classe'),
    niveau_id: 2,
    frais_scolarite: 500,
    frais_inscription: 50,
    annee_scolaire: ANNEE_COURANTE,
    classe_superieure_id: null,
    classe_inferieure_id: null,
    est_pivot: 0,
    ...overrides,
  };
  const [res] = await db.query(
    `INSERT INTO classes (nom, niveau_id, classe_superieure_id, classe_inferieure_id, frais_inscription, frais_scolarite, devise, effectif_max, ordre, annee_scolaire, actif, est_pivot)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
    [c.nom, c.niveau_id, c.classe_superieure_id, c.classe_inferieure_id, c.frais_inscription, c.frais_scolarite, 'USD', 50, 0, c.annee_scolaire, c.est_pivot ? 1 : 0]
  );
  return { id: res.insertId, ...c };
}

async function creerEleve(classeId, overrides = {}) {
  const [[cls]] = await db.query('SELECT frais_scolarite, frais_inscription, annee_scolaire FROM classes WHERE id=?', [classeId]);
  const e = {
    nom: 'Test', prenom: 'Eleve', genre: 'M', statut: 'actif', redoublant: false, section_id: null, remise_pourcentage: 0, en_attente_orientation: 0,
    annee_scolaire: cls.annee_scolaire,
    frais_scolarite_total: cls.frais_scolarite,
    frais_inscription_total: cls.frais_inscription,
    ...overrides,
  };
  const matricule = unique('MAT');
  const [res] = await db.query(
    `INSERT INTO eleves (matricule, nom, prenom, genre, classe_id, section_id, statut, redoublant, remise_pourcentage, en_attente_orientation, annee_scolaire, frais_scolarite_total, frais_inscription_total, date_inscription)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,date('now'))`,
    [matricule, e.nom, e.prenom, e.genre, classeId, e.section_id, e.statut, e.redoublant ? 1 : 0, e.remise_pourcentage, e.en_attente_orientation ? 1 : 0, e.annee_scolaire, e.frais_scolarite_total, e.frais_inscription_total]
  );
  return { id: res.insertId, classeId, ...e };
}

async function creerSection(classeId, nom, ordre = 0) {
  const [res] = await db.query('INSERT INTO sections (classe_id, nom, ordre) VALUES (?,?,?)', [classeId, nom, ordre]);
  return { id: res.insertId, classeId, nom, ordre };
}

async function creerTranche(classeId, numero, montant) {
  const [res] = await db.query('INSERT INTO classe_tranches (classe_id, numero, montant) VALUES (?,?,?)', [classeId, numero, montant]);
  return { id: res.insertId, classeId, numero, montant };
}

// Insere un paiement directement en base (sans passer par la route) : utile pour preparer
// un etat prealable (ex: un paiement d'une AUTRE annee scolaire) que la route de creation
// refuserait normalement de laisser construire dans ce contexte.
async function creerPaiementBrut(eleveId, overrides = {}) {
  const p = {
    type_paiement: 'scolarite', montant: 100, devise: 'USD', montant_usd: 100, montant_local: 280000,
    taux_change: 2800, mode_paiement: 'especes', statut: 'valide', annee_scolaire: ANNEE_COURANTE,
    montant_surplus: 0, surplus_rembourse: 0,
    ...overrides,
  };
  const reference = unique('PAY');
  const [res] = await db.query(
    `INSERT INTO paiements (reference, eleve_id, type_paiement, montant, devise, montant_usd, montant_local, taux_change, mode_paiement, statut, annee_scolaire, montant_surplus, surplus_rembourse, date_paiement)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [reference, eleveId, p.type_paiement, p.montant, p.devise, p.montant_usd, p.montant_local, p.taux_change, p.mode_paiement, p.statut, p.annee_scolaire, p.montant_surplus, p.surplus_rembourse]
  );
  return { id: res.insertId, reference, ...p };
}

function tokenAdmin() {
  // id=1 : le seul utilisateur cree par migrate-sqlite.js (compte admin par defaut), donc
  // toujours le premier auto-increment sur une base de test fraiche.
  return jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

module.exports = { creerClasse, creerEleve, creerSection, creerTranche, creerPaiementBrut, tokenAdmin, db, ANNEE_COURANTE };
