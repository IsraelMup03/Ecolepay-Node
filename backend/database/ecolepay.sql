-- ============================================================
-- EcolePay v2.0 (Node.js/Express/MySQL)
-- Base de données - Système de gestion des paiements scolaires
-- ============================================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

CREATE DATABASE IF NOT EXISTS `ecolepay` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `ecolepay`;

-- ============================================================
-- TABLE: ecole (informations de l'école)
-- ============================================================
CREATE TABLE IF NOT EXISTS `ecole` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nom` varchar(200) NOT NULL,
  `adresse` text DEFAULT NULL,
  `telephone` varchar(50) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `devise` varchar(10) DEFAULT 'USD',
  `devise_locale` varchar(10) DEFAULT 'CDF',
  `logo` varchar(255) DEFAULT NULL,
  `slogan` varchar(300) DEFAULT NULL,
  `annee_scolaire` varchar(20) DEFAULT NULL,
  `sceau` varchar(255) DEFAULT NULL,
  `date_creation` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `ecole` (`nom`, `adresse`, `telephone`, `email`, `devise`, `devise_locale`, `annee_scolaire`)
SELECT * FROM (SELECT 'Mon École' as a, 'Kinshasa, RDC' as b, '+243 000 000 000' as c, 'ecole@example.com' as d, 'USD' as e, 'CDF' as f, '2024-2025' as g) AS tmp
WHERE NOT EXISTS (SELECT 1 FROM `ecole`);

-- ============================================================
-- TABLE: utilisateurs
-- ============================================================
CREATE TABLE IF NOT EXISTS `utilisateurs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nom` varchar(100) NOT NULL,
  `prenom` varchar(100) NOT NULL,
  `email` varchar(150) NOT NULL,
  `mot_de_passe` varchar(255) NOT NULL,
  `role` enum('admin','comptable','directeur','caissier') NOT NULL DEFAULT 'comptable',
  `permissions` text DEFAULT NULL COMMENT 'JSON des permissions',
  `avatar` varchar(255) DEFAULT NULL,
  `telephone` varchar(50) DEFAULT NULL,
  `actif` tinyint(1) DEFAULT 1,
  `premier_connexion` tinyint(1) DEFAULT 1,
  `date_creation` datetime DEFAULT CURRENT_TIMESTAMP,
  `derniere_connexion` datetime DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Admin par défaut: admin@ecolepay.com / Admin@2024
-- (le hash sera régénéré proprement par le script de migration Node : npm run migrate)
INSERT INTO `utilisateurs` (`nom`, `prenom`, `email`, `mot_de_passe`, `role`, `permissions`, `actif`, `premier_connexion`)
SELECT * FROM (SELECT 'Administrateur' as a, 'Système' as b, 'admin@ecolepay.com' as c,
  '$2a$10$CwTycUXWue0Thq9StjUM0uJ8Q9WwR9nZQ.tS0h6C1mI0v6t.mZmZ2' as d, 'admin' as e, '{"tout":true}' as f, 1 as g, 0 as h) AS tmp
WHERE NOT EXISTS (SELECT 1 FROM `utilisateurs` WHERE email = 'admin@ecolepay.com');

-- ============================================================
-- TABLE: niveaux (cycle d'enseignement)
-- ============================================================
CREATE TABLE IF NOT EXISTS `niveaux` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nom` varchar(100) NOT NULL,
  `ordre` int(11) NOT NULL DEFAULT 0,
  `description` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `niveaux` (`id`, `nom`, `ordre`, `description`)
SELECT * FROM (SELECT 1 as a,'Maternelle' as b,1 as c,NULL as d UNION ALL SELECT 2,'Primaire',2,NULL UNION ALL SELECT 3,'Secondaire',3,NULL) as tmp
WHERE NOT EXISTS (SELECT 1 FROM `niveaux`);

-- ============================================================
-- TABLE: classes
-- ============================================================
CREATE TABLE IF NOT EXISTS `classes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nom` varchar(100) NOT NULL,
  `niveau_id` int(11) DEFAULT NULL,
  `classe_superieure_id` int(11) DEFAULT NULL COMMENT 'Classe vers laquelle les eleves passent en fin d annee',
  `classe_inferieure_id` int(11) DEFAULT NULL,
  `frais_inscription` decimal(15,2) DEFAULT 0.00,
  `frais_scolarite` decimal(15,2) DEFAULT 0.00 COMMENT 'Montant total annuel',
  `devise` varchar(10) DEFAULT 'USD',
  `effectif_max` int(11) DEFAULT 50,
  `ordre` int(11) DEFAULT 0,
  `annee_scolaire` varchar(20) DEFAULT NULL,
  `actif` tinyint(1) DEFAULT 1,
  `date_creation` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `niveau_id` (`niveau_id`),
  KEY `classe_superieure_id` (`classe_superieure_id`),
  CONSTRAINT `fk_classe_niveau` FOREIGN KEY (`niveau_id`) REFERENCES `niveaux` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- TABLE: eleves
-- ============================================================
CREATE TABLE IF NOT EXISTS `eleves` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `matricule` varchar(50) NOT NULL,
  `nom` varchar(100) NOT NULL,
  `postnom` varchar(100) DEFAULT NULL,
  `prenom` varchar(100) NOT NULL,
  `genre` enum('M','F') NOT NULL,
  `date_naissance` date DEFAULT NULL,
  `lieu_naissance` varchar(150) DEFAULT NULL,
  `nationalite` varchar(100) DEFAULT 'Congolaise',
  `classe_id` int(11) NOT NULL,
  `photo` varchar(255) DEFAULT NULL,
  `nom_parent` varchar(200) DEFAULT NULL,
  `telephone_parent` varchar(50) DEFAULT NULL,
  `email_parent` varchar(150) DEFAULT NULL,
  `adresse` text DEFAULT NULL,
  `statut` enum('actif','redoublant','transfere','diplome','suspendu') DEFAULT 'actif',
  `redoublant` tinyint(1) DEFAULT 0 COMMENT 'Redouble sa classe actuelle cette annee (reste actif, redemarre a 0 a la prochaine promotion)',
  `date_inscription` date DEFAULT NULL,
  `annee_scolaire` varchar(20) DEFAULT NULL,
  `frais_scolarite_total` decimal(15,2) DEFAULT 0.00 COMMENT 'Copie depuis la classe a l inscription',
  `frais_inscription_total` decimal(15,2) DEFAULT 0.00,
  `notes` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `date_creation` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `matricule` (`matricule`),
  KEY `classe_id` (`classe_id`),
  KEY `idx_eleves_statut_annee` (`statut`,`annee_scolaire`),
  KEY `idx_eleves_classe_statut` (`classe_id`,`statut`),
  CONSTRAINT `fk_eleve_classe` FOREIGN KEY (`classe_id`) REFERENCES `classes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- TABLE: paiements
-- ============================================================
CREATE TABLE IF NOT EXISTS `paiements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `reference` varchar(50) NOT NULL COMMENT 'Numero de recu unique',
  `eleve_id` int(11) NOT NULL,
  `type_paiement` enum('scolarite','inscription','autre') NOT NULL DEFAULT 'scolarite',
  `montant` decimal(15,2) NOT NULL,
  `montant_usd` decimal(15,4) DEFAULT 0.0000 COMMENT 'Montant toujours converti en USD pour comparaison uniforme',
  `devise` varchar(10) DEFAULT 'USD',
  `taux_change` decimal(15,4) DEFAULT 1.0000,
  `montant_local` decimal(15,2) DEFAULT 0.00 COMMENT 'Montant en devise locale',
  `mode_paiement` enum('especes','mobile_money','virement','cheque') DEFAULT 'especes',
  `statut` enum('valide','rembourse','annule','partiel') DEFAULT 'valide',
  `motif_remboursement` text DEFAULT NULL,
  `date_paiement` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `periode` varchar(30) DEFAULT NULL COMMENT 'Ex: Septembre 2024, Trimestre 1',
  `description` text DEFAULT NULL,
  `comptable_id` int(11) DEFAULT NULL,
  `imprime` tinyint(1) DEFAULT 0,
  `annee_scolaire` varchar(20) DEFAULT NULL,
  `montant_surplus` decimal(15,4) DEFAULT 0.0000 COMMENT 'Surplus encaisse au-dela du du (USD), a rendre',
  `surplus_rembourse` tinyint(1) DEFAULT 0,
  `date_creation` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `reference` (`reference`),
  KEY `eleve_id` (`eleve_id`),
  KEY `comptable_id` (`comptable_id`),
  KEY `idx_paiements_eleve_statut_annee` (`eleve_id`,`statut`,`annee_scolaire`),
  KEY `idx_paiements_annee_statut_type` (`annee_scolaire`,`statut`,`type_paiement`),
  KEY `idx_paiements_date` (`date_paiement`),
  CONSTRAINT `fk_paiement_eleve` FOREIGN KEY (`eleve_id`) REFERENCES `eleves` (`id`),
  CONSTRAINT `fk_paiement_comptable` FOREIGN KEY (`comptable_id`) REFERENCES `utilisateurs` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- TABLE: remboursements
-- ============================================================
CREATE TABLE IF NOT EXISTS `remboursements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `paiement_id` int(11) NOT NULL,
  `eleve_id` int(11) NOT NULL,
  `montant` decimal(15,2) NOT NULL,
  `montant_usd` decimal(15,4) DEFAULT 0.0000,
  `devise` varchar(10) DEFAULT 'USD',
  `motif` text NOT NULL,
  `reference_remboursement` varchar(50) NOT NULL,
  `date_remboursement` datetime DEFAULT CURRENT_TIMESTAMP,
  `approuve_par` int(11) DEFAULT NULL,
  `statut` enum('en_attente','approuve','rejete') DEFAULT 'en_attente',
  PRIMARY KEY (`id`),
  KEY `paiement_id` (`paiement_id`),
  KEY `eleve_id` (`eleve_id`),
  KEY `idx_remb_paiement_statut` (`paiement_id`,`statut`),
  CONSTRAINT `fk_remb_paiement` FOREIGN KEY (`paiement_id`) REFERENCES `paiements` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- TABLE: corbeille (donnees supprimees - 30 jours)
-- ============================================================
CREATE TABLE IF NOT EXISTS `corbeille` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `table_source` varchar(100) NOT NULL,
  `donnees` longtext NOT NULL COMMENT 'JSON des donnees supprimees',
  `supprime_par` int(11) DEFAULT NULL,
  `date_suppression` datetime DEFAULT CURRENT_TIMESTAMP,
  `date_expiration` datetime NOT NULL,
  `restaure` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- TABLE: logs_activite
-- ============================================================
CREATE TABLE IF NOT EXISTS `logs_activite` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `utilisateur_id` int(11) DEFAULT NULL,
  `action` varchar(200) NOT NULL,
  `details` text DEFAULT NULL,
  `ip` varchar(50) DEFAULT NULL,
  `date_action` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- TABLE: parametres (configuration generale)
-- ============================================================
CREATE TABLE IF NOT EXISTS `parametres` (
  `cle` varchar(100) NOT NULL,
  `valeur` text DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`cle`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `parametres` (`cle`,`valeur`,`description`)
SELECT * FROM (
  SELECT 'annee_scolaire_courante' as a, '2024-2025' as b, 'Annee scolaire active' as c
  UNION ALL SELECT 'mois_debut_annee', '9', 'Mois de debut de l annee scolaire'
  UNION ALL SELECT 'promotion_automatique', '1', 'Promotion automatique en fin d annee'
  UNION ALL SELECT 'delai_corbeille', '30', 'Jours avant suppression definitive'
  UNION ALL SELECT 'format_matricule', 'EP-{ANNEE}-{NUM}', 'Format des matricules'
  UNION ALL SELECT 'compteur_matricule', '1', 'Compteur pour les matricules'
  UNION ALL SELECT 'taux_usd_cdf', '2800', 'Taux de change USD vers CDF'
  UNION ALL SELECT 'rappel_paiement', '1', 'Activer les rappels de paiement'
) AS tmp
WHERE NOT EXISTS (SELECT 1 FROM `parametres` WHERE `cle` = tmp.a);

-- ============================================================
-- TABLE: archives_annuelles (historique financier par annee)
-- ============================================================
CREATE TABLE IF NOT EXISTS `archives_annuelles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `annee_scolaire` varchar(20) NOT NULL,
  `eleve_id` int(11) NOT NULL,
  `classe_id` int(11) NOT NULL,
  `frais_scolarite_total` decimal(15,2) DEFAULT 0.00,
  `total_paye` decimal(15,2) DEFAULT 0.00,
  `statut_paiement` enum('solde','partiel','non_paye') DEFAULT 'non_paye',
  `date_archive` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `annee_eleve` (`annee_scolaire`,`eleve_id`),
  KEY `idx_archives_annee_classe` (`annee_scolaire`,`classe_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- TABLE: depenses (sorties de caisse / comptabilite de l'etablissement)
-- ============================================================
CREATE TABLE IF NOT EXISTS `depenses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `reference` varchar(50) NOT NULL,
  `categorie` varchar(50) NOT NULL DEFAULT 'autre',
  `montant` decimal(15,2) NOT NULL,
  `devise` varchar(10) DEFAULT 'USD',
  `montant_usd` decimal(15,4) DEFAULT 0.0000,
  `montant_local` decimal(15,2) DEFAULT 0.00,
  `taux_change` decimal(15,4) DEFAULT 1.0000,
  `mode_paiement` enum('especes','mobile_money','virement','cheque') DEFAULT 'especes',
  `beneficiaire` varchar(200) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `date_depense` datetime DEFAULT CURRENT_TIMESTAMP,
  `comptable_id` int(11) DEFAULT NULL,
  `annee_scolaire` varchar(20) DEFAULT NULL,
  `date_creation` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `reference` (`reference`),
  KEY `idx_depenses_date` (`date_depense`),
  KEY `idx_depenses_annee_categorie` (`annee_scolaire`,`categorie`),
  CONSTRAINT `fk_depense_comptable` FOREIGN KEY (`comptable_id`) REFERENCES `utilisateurs` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
