/**
 * Migration SQLite complet pour permettre l'execution sans MySQL/XAMPP.
 * Usage: set DB_CLIENT=sqlite (ou export) puis `node src/migrate-sqlite.js`
 */
require('dotenv').config();
if (!process.env.TZ) process.env.TZ = 'Africa/Kinshasa';
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');

// Ajoute une colonne a une table existante si elle n'y est pas deja -- necessaire des qu'un
// champ est ajoute a une table APRES qu'elle ait pu deja exister chez un client (une simple
// "CREATE TABLE IF NOT EXISTS" ne touche jamais une table qui existe deja, meme si sa
// definition a change depuis). Sans ca, il faudrait recreer completement la base a chaque
// mise a jour du logiciel -- ce que ce fichier faisait jusqu'ici (voir commentaire plus bas),
// effacant les donnees de toute ecole qui l'utilisait deja.
async function ensureColumn(db, table, colonne, definitionSql) {
  const colonnes = await db.all(`PRAGMA table_info(${table})`);
  if (!colonnes.some((c) => c.name === colonne)) {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definitionSql}`);
    console.log(`Colonne ajoutee : ${table}.${colonne}`);
  }
}

async function main() {
  const dbFile = process.env.SQLITE_FILE || path.join(__dirname, '../database/ecolepay.sqlite');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  // Important : ce fichier ne supprime plus la base existante avant de la recreer (il le
  // faisait auparavant, ce qui aurait efface toutes les donnees d'une ecole cliente a la
  // moindre mise a jour du logiciel touchant le schema). Tout ce qui suit est ecrit pour
  // etre sans danger a rejouer sur une base deja peuplee : CREATE TABLE IF NOT EXISTS,
  // CREATE INDEX IF NOT EXISTS, INSERT OR IGNORE, et ensureColumn() ci-dessus pour les
  // colonnes ajoutees a une table apres coup.

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
      est_pivot INTEGER DEFAULT 0,
      date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (niveau_id) REFERENCES niveaux(id) ON DELETE SET NULL
    );

    -- Sections (ex: "1ere Secondaire A/B/C") rattachees a une classe : eleves.classe_id
    -- continue de toujours pointer vers une vraie classe, jamais vers une section. La
    -- colonne nom ne stocke que la lettre ("A"), le nom complet affiche est toujours
    -- compose de classe.nom + ' ' + section.nom.
    CREATE TABLE IF NOT EXISTS sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classe_id INTEGER NOT NULL,
      nom TEXT NOT NULL,
      ordre INTEGER DEFAULT 0,
      date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (classe_id) REFERENCES classes(id)
    );

    CREATE TABLE IF NOT EXISTS familles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      pourcentage_reduction NUMERIC DEFAULT 0,
      actif INTEGER DEFAULT 1,
      created_by INTEGER,
      date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES utilisateurs(id) ON DELETE SET NULL
    );

    -- Tranches de scolarite d'une classe (ex: 400$/200$/150$) : classes.frais_scolarite
    -- reste la somme de ces tranches et continue d'etre ce que tout le reste du logiciel
    -- lit -- une classe qui n'utilise pas les tranches n'a simplement aucune ligne ici.
    CREATE TABLE IF NOT EXISTS classe_tranches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classe_id INTEGER NOT NULL,
      numero INTEGER NOT NULL,
      montant NUMERIC NOT NULL DEFAULT 0,
      date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (classe_id) REFERENCES classes(id)
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
      section_id INTEGER,
      famille_id INTEGER,
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
      FOREIGN KEY (classe_id) REFERENCES classes(id),
      FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL,
      FOREIGN KEY (famille_id) REFERENCES familles(id) ON DELETE SET NULL
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
      remise_pourcentage NUMERIC DEFAULT 0,
      famille_reduction_pourcentage NUMERIC DEFAULT 0,
      famille_nom TEXT,
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

    -- Entrees de caisse hors paiements d'eleves (subventions, dons, ventes diverses...) :
    -- meme forme que "depenses" pour rester coherent avec le reste de la comptabilite.
    CREATE TABLE IF NOT EXISTS recettes_diverses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL UNIQUE,
      categorie TEXT NOT NULL DEFAULT 'autre',
      montant NUMERIC NOT NULL,
      devise TEXT DEFAULT 'USD',
      montant_usd NUMERIC DEFAULT 0,
      montant_local NUMERIC DEFAULT 0,
      taux_change NUMERIC DEFAULT 1,
      mode_paiement TEXT DEFAULT 'especes',
      provenance TEXT,
      description TEXT,
      date_recette DATETIME DEFAULT CURRENT_TIMESTAMP,
      comptable_id INTEGER,
      annee_scolaire TEXT,
      date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (comptable_id) REFERENCES utilisateurs(id) ON DELETE SET NULL
    );
  `.replace(/DEFAULT CURRENT_TIMESTAMP/g, "DEFAULT (datetime('now','localtime'))"));

  // Les index dependants des colonnes ajoutees doivent etre crees apres leur
  // migration : sinon une ancienne base echoue avant meme d'atteindre ensureColumn().
  await ensureColumn(db, 'eleves', 'section_id', 'INTEGER REFERENCES sections(id)');
  await ensureColumn(db, 'eleves', 'famille_id', 'INTEGER REFERENCES familles(id)');
  await ensureColumn(db, 'familles', 'actif', 'INTEGER DEFAULT 1');
  await ensureColumn(db, 'eleves', 'remise_pourcentage', 'NUMERIC DEFAULT 0');
  await ensureColumn(db, 'eleves', 'en_attente_orientation', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'classes', 'est_pivot', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'paiements', 'motif_annulation', 'TEXT');
  await ensureColumn(db, 'paiements', 'annule_par', 'INTEGER REFERENCES utilisateurs(id)');
  await ensureColumn(db, 'archives_annuelles', 'remise_pourcentage', 'NUMERIC DEFAULT 0');
  await ensureColumn(db, 'archives_annuelles', 'famille_reduction_pourcentage', 'NUMERIC DEFAULT 0');
  await ensureColumn(db, 'archives_annuelles', 'famille_nom', 'TEXT');

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
    CREATE INDEX IF NOT EXISTS idx_eleves_famille ON eleves(famille_id);
    CREATE INDEX IF NOT EXISTS idx_eleves_section ON eleves(section_id);
    CREATE INDEX IF NOT EXISTS idx_sections_classe ON sections(classe_id);
    CREATE INDEX IF NOT EXISTS idx_classe_tranches_classe ON classe_tranches(classe_id);
    CREATE INDEX IF NOT EXISTS idx_remb_paiement_statut ON remboursements(paiement_id, statut);
    CREATE INDEX IF NOT EXISTS idx_archives_annee_classe ON archives_annuelles(annee_scolaire, classe_id);
    CREATE INDEX IF NOT EXISTS idx_depenses_date ON depenses(date_depense);
    CREATE INDEX IF NOT EXISTS idx_depenses_annee_categorie ON depenses(annee_scolaire, categorie);
    CREATE INDEX IF NOT EXISTS idx_recettes_diverses_date ON recettes_diverses(date_recette);
    CREATE INDEX IF NOT EXISTS idx_recettes_diverses_annee_categorie ON recettes_diverses(annee_scolaire, categorie);
  `);

  // Colonnes ajoutees a "eleves" apres sa creation initiale (voir ensureColumn plus haut) :
  // sans body, une base deja existante chez un client ne les recevrait jamais.
  console.log('Insertion des donnees de base...');
  // "INSERT OR IGNORE" ne protege que contre un conflit sur une colonne UNIQUE/PK -- ici
  // l'id s'auto-incremente et aucune autre colonne n'est unique, donc il inserait une
  // nouvelle ligne "Mon Ecole" a chaque execution de la migration sans ce garde-fou explicite.
  const [{ n: nbEcoles }] = await db.all('SELECT COUNT(*) as n FROM ecole');
  if (nbEcoles === 0) {
    await db.run(`INSERT INTO ecole (nom, adresse, telephone, email, devise, devise_locale, annee_scolaire) VALUES (?,?,?,?,?,?,?)`,
      ['Mon École', 'Kinshasa, RDC', '+243 000 000 000', 'ecole@example.com', 'USD', 'CDF', '2024-2025']);
  }

  // Meme garde-fou que ci-dessus : "nom" n'est pas UNIQUE sur "niveaux", donc "OR IGNORE"
  // n'empechait pas non plus une triplette de doublons a chaque execution.
  const [{ n: nbNiveaux }] = await db.all('SELECT COUNT(*) as n FROM niveaux');
  const niveaux = [
    ['Maternelle', 1, null],
    ['Primaire', 2, null],
    ['Secondaire', 3, null],
  ];
  if (nbNiveaux === 0) for (const [nom, ordre, description] of niveaux) {
    await db.run('INSERT INTO niveaux (nom, ordre, description) VALUES (?,?,?)', [nom, ordre, description]);
  }

  const params = {
    annee_scolaire_courante: '2024-2025',
    mois_debut_annee: '9',
    promotion_automatique: '1',
    delai_corbeille: '30',
    format_matricule: 'EP-{ANNEE}-{NUM}',
    compteur_matricule: '1',
    taux_usd_cdf: '2800',
    rappel_paiement: '1',
    nombre_tranches_scolarite: '1',
  };
  for (const [cle, valeur] of Object.entries(params)) {
    await db.run('INSERT OR IGNORE INTO parametres (cle, valeur, description) VALUES (?,?,?)', [cle, valeur, null]);
  }

  // premier_connexion=1 : une installation neuve (chez un client) doit forcer le
  // changement du mot de passe par defaut avant toute utilisation, sinon chaque
  // installation partagerait le meme mot de passe admin public/connu. INSERT OR IGNORE
  // uniquement (pas d'UPDATE derriere) : ce fichier pouvant desormais etre rejoue sur une
  // base deja utilisee (voir plus haut), reecrire ces valeurs a chaque fois ecraserait le
  // mot de passe qu'une vraie ecole a deja change, et la forcerait a nouveau a le changer.
  const adminHash = await bcrypt.hash('Admin@2024', 10);
  await db.run(`INSERT OR IGNORE INTO utilisateurs (nom, prenom, email, mot_de_passe, role, permissions, actif, premier_connexion) VALUES (?,?,?,?,?,?,?,?)`,
    ['Administrateur', 'Système', 'admin@ecolepay.com', adminHash, 'admin', JSON.stringify({ tout: true }), 1, 1]);

  await db.close();
  console.log('Migration SQLite terminee. Fichier DB:', dbFile);
}

main().catch((err) => {
  console.error('Erreur migration sqlite:', err);
  process.exit(1);
});
