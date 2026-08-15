/**
 * Migration SQLite complet pour permettre l'execution sans MySQL/XAMPP.
 * Usage: set DB_CLIENT=sqlite (ou export) puis `node src/migrate-sqlite.js`
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');

async function main() {
  const dbFile = process.env.SQLITE_FILE || path.join(__dirname, '../database/ecolepay.sqlite');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);

  const db = await open({ filename: dbFile, driver: sqlite3.Database });
  await db.run('PRAGMA foreign_keys = ON');

  console.log('Creation des tables SQLite...');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ecole (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      adresse TEXT,
      telephone TEXT,
      email TEXT,
      devise TEXT DEFAULT 'USD',
      devise_locale TEXT DEFAULT 'CDF',
      logo TEXT,
      slogan TEXT,
      annee_scolaire TEXT,
      sceau TEXT,
      date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS utilisateurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      mot_de_passe TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'comptable',
      permissions TEXT,
      avatar TEXT,
      telephone TEXT,
      actif INTEGER DEFAULT 1,
      premier_connexion INTEGER DEFAULT 1,
      date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
      derniere_connexion DATETIME,
      created_by INTEGER
    );

    CREATE TABLE IF NOT EXISTS niveaux (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      ordre INTEGER NOT NULL DEFAULT 0,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      niveau_id INTEGER,
      classe_superieure_id INTEGER,
      classe_inferieure_id INTEGER,
      frais_inscription NUMERIC DEFAULT 0.00,
      frais_scolarite NUMERIC DEFAULT 0.00,
      devise TEXT DEFAULT 'USD',
      effectif_max INTEGER DEFAULT 50,
      ordre INTEGER DEFAULT 0,
      annee_scolaire TEXT,
      actif INTEGER DEFAULT 1,
      date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (niveau_id) REFERENCES niveaux(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS eleves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matricule TEXT NOT NULL UNIQUE,
      nom TEXT NOT NULL,
      postnom TEXT,
      prenom TEXT NOT NULL,
      genre TEXT NOT NULL,
      date_naissance DATE,
      lieu_naissance TEXT,
      nationalite TEXT DEFAULT 'Congolaise',
      classe_id INTEGER NOT NULL,
      photo TEXT,
      nom_parent TEXT,
      telephone_parent TEXT,
      email_parent TEXT,
      adresse TEXT,
      statut TEXT DEFAULT 'actif',
      redoublant INTEGER DEFAULT 0,
      date_inscription DATE,
      annee_scolaire TEXT,
      frais_scolarite_total NUMERIC DEFAULT 0.00,
      frais_inscription_total NUMERIC DEFAULT 0.00,
      notes TEXT,
      created_by INTEGER,
      date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (classe_id) REFERENCES classes(id)
    );

    CREATE TABLE IF NOT EXISTS paiements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL UNIQUE,
      eleve_id INTEGER NOT NULL,
      type_paiement TEXT NOT NULL DEFAULT 'scolarite',
      montant NUMERIC NOT NULL,
      montant_usd NUMERIC DEFAULT 0.0000,
      devise TEXT DEFAULT 'USD',
      taux_change NUMERIC DEFAULT 1.0000,
      montant_local NUMERIC DEFAULT 0.00,
      mode_paiement TEXT DEFAULT 'especes',
      statut TEXT DEFAULT 'valide',
      motif_remboursement TEXT,
      date_paiement DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      periode TEXT,
      description TEXT,
      comptable_id INTEGER,
      imprime INTEGER DEFAULT 0,
      annee_scolaire TEXT,
      montant_surplus NUMERIC DEFAULT 0,
      surplus_rembourse INTEGER DEFAULT 0,
      date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (eleve_id) REFERENCES eleves(id),
      FOREIGN KEY (comptable_id) REFERENCES utilisateurs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS remboursements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paiement_id INTEGER NOT NULL,
      eleve_id INTEGER NOT NULL,
      montant NUMERIC NOT NULL,
      montant_usd NUMERIC DEFAULT 0,
      devise TEXT DEFAULT 'USD',
      motif TEXT NOT NULL,
      reference_remboursement TEXT NOT NULL,
      date_remboursement DATETIME DEFAULT CURRENT_TIMESTAMP,
      approuve_par INTEGER,
      statut TEXT DEFAULT 'en_attente',
      FOREIGN KEY (paiement_id) REFERENCES paiements(id)
    );

    CREATE TABLE IF NOT EXISTS corbeille (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_source TEXT NOT NULL,
      donnees TEXT NOT NULL,
      supprime_par INTEGER,
      date_suppression DATETIME DEFAULT CURRENT_TIMESTAMP,
      date_expiration DATETIME NOT NULL,
      restaure INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS logs_activite (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      utilisateur_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      ip TEXT,
      date_action DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS parametres (
      cle TEXT PRIMARY KEY,
      valeur TEXT,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS archives_annuelles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      annee_scolaire TEXT NOT NULL,
      eleve_id INTEGER NOT NULL,
      classe_id INTEGER NOT NULL,
      frais_scolarite_total NUMERIC DEFAULT 0.00,
      total_paye NUMERIC DEFAULT 0.00,
      statut_paiement TEXT DEFAULT 'non_paye',
      date_archive DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (annee_scolaire, eleve_id)
    );

    CREATE TABLE IF NOT EXISTS depenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL UNIQUE,
      categorie TEXT NOT NULL DEFAULT 'autre',
      montant NUMERIC NOT NULL,
      devise TEXT DEFAULT 'USD',
      montant_usd NUMERIC DEFAULT 0,
      montant_local NUMERIC DEFAULT 0,
      taux_change NUMERIC DEFAULT 1,
      mode_paiement TEXT DEFAULT 'especes',
      beneficiaire TEXT,
      description TEXT,
      date_depense DATETIME DEFAULT CURRENT_TIMESTAMP,
      comptable_id INTEGER,
      annee_scolaire TEXT,
      date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (comptable_id) REFERENCES utilisateurs(id) ON DELETE SET NULL
    );
  `);

  console.log('Creation des index...');
  // Sans ces index, chaque sous-requete correlee (SUM(...) WHERE eleve_id=...) fait un scan
  // complet de la table paiements pour chaque eleve : instantane a quelques centaines d'eleves,
  // mais devient tres lent (plusieurs secondes sur Dashboard/Rapports) a l'echelle d'une
  // grande ecole (5000+ eleves, milliers de paiements).
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_paiements_eleve_statut_annee ON paiements(eleve_id, statut, annee_scolaire);
    CREATE INDEX IF NOT EXISTS idx_paiements_annee_statut ON paiements(annee_scolaire, statut);
    CREATE INDEX IF NOT EXISTS idx_paiements_annee_statut_type ON paiements(annee_scolaire, statut, type_paiement);
    CREATE INDEX IF NOT EXISTS idx_paiements_date ON paiements(date_paiement);
    CREATE INDEX IF NOT EXISTS idx_eleves_statut_annee ON eleves(statut, annee_scolaire);
    CREATE INDEX IF NOT EXISTS idx_eleves_classe_statut ON eleves(classe_id, statut);
    CREATE INDEX IF NOT EXISTS idx_remb_paiement_statut ON remboursements(paiement_id, statut);
    CREATE INDEX IF NOT EXISTS idx_archives_annee_classe ON archives_annuelles(annee_scolaire, classe_id);
    CREATE INDEX IF NOT EXISTS idx_depenses_date ON depenses(date_depense);
    CREATE INDEX IF NOT EXISTS idx_depenses_annee_categorie ON depenses(annee_scolaire, categorie);
  `);

  console.log('Insertion des donnees de base...');
  await db.run(`INSERT OR IGNORE INTO ecole (nom, adresse, telephone, email, devise, devise_locale, annee_scolaire) VALUES (?,?,?,?,?,?,?)`,
    ['Mon École', 'Kinshasa, RDC', '+243 000 000 000', 'ecole@example.com', 'USD', 'CDF', '2024-2025']);

  const niveaux = [
    ['Maternelle', 1, null],
    ['Primaire', 2, null],
    ['Secondaire', 3, null],
  ];
  for (const [nom, ordre, description] of niveaux) {
    await db.run('INSERT OR IGNORE INTO niveaux (nom, ordre, description) VALUES (?,?,?)', [nom, ordre, description]);
  }

  const params = {
    annee_scolaire_courante: '2024-2025',
    mois_debut_annee: '9',
    promotion_automatique: '1',
    delai_corbeille: '30',
    format_matricule: 'EP-{ANNEE}-{NUM}',
    compteur_matricule: '1',
    taux_usd_cdf: '2800',
    rappel_paiement: '1'
  };
  for (const [cle, valeur] of Object.entries(params)) {
    await db.run('INSERT OR IGNORE INTO parametres (cle, valeur, description) VALUES (?,?,?)', [cle, valeur, null]);
  }

  // premier_connexion=1 : une installation neuve (chez un client) doit forcer le
  // changement du mot de passe par defaut avant toute utilisation, sinon chaque
  // installation partagerait le meme mot de passe admin public/connu.
  const adminHash = await bcrypt.hash('Admin@2024', 10);
  await db.run(`INSERT OR IGNORE INTO utilisateurs (nom, prenom, email, mot_de_passe, role, permissions, actif, premier_connexion) VALUES (?,?,?,?,?,?,?,?)`,
    ['Administrateur', 'Système', 'admin@ecolepay.com', adminHash, 'admin', JSON.stringify({ tout: true }), 1, 1]);

  await db.run(`UPDATE utilisateurs SET mot_de_passe = ?, permissions = ?, actif = 1, premier_connexion = 1 WHERE email = ?`,
    [adminHash, JSON.stringify({ tout: true }), 'admin@ecolepay.com']);

  await db.close();
  console.log('Migration SQLite terminee. Fichier DB:', dbFile);
}

main().catch((err) => {
  console.error('Erreur migration sqlite:', err);
  process.exit(1);
});
