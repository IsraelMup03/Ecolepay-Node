const express = require('express');
const db = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getParam } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth, requirePermission('rapports'));

// GET /api/rapports?debut=&fin=&classe_id=&annee=  (annee: consulter une annee passee)
router.get('/', async (req, res) => {
  const { debut, fin, classe_id, annee } = req.query;
  const anneeCourante = await getParam('annee_scolaire_courante');
  const modeHistorique = !!(annee && annee !== anneeCourante);
  const anneeCible = modeHistorique ? annee : anneeCourante;

  if (modeHistorique) {
    const classeJoin = classe_id ? `AND p.eleve_id IN (SELECT eleve_id FROM archives_annuelles WHERE annee_scolaire=? AND classe_id=?)` : '';
    const baseParams = classe_id ? [anneeCible, anneeCible, classe_id] : [anneeCible];

    const [[resume]] = await db.query(
      `SELECT COUNT(*) as nb_paiements, COALESCE(SUM(montant_usd),0) as total_usd
       FROM paiements p WHERE p.statut='valide' AND p.annee_scolaire=? ${classeJoin}`,
      baseParams
    );
    const [mensuel] = await db.query(
      `SELECT DATE_FORMAT(p.date_paiement,'%Y-%m') as mois_key, DATE_FORMAT(p.date_paiement,'%b %Y') as mois_lbl,
              SUM(p.montant_usd) as total, COUNT(*) as nb
       FROM paiements p WHERE p.statut='valide' AND p.annee_scolaire=? ${classeJoin}
       GROUP BY DATE_FORMAT(p.date_paiement,'%Y-%m') ORDER BY mois_key ASC`,
      baseParams
    );
    const [parMode] = await db.query(
      `SELECT p.mode_paiement, COUNT(*) as nb, SUM(p.montant_usd) as total
       FROM paiements p WHERE p.statut='valide' AND p.annee_scolaire=? ${classeJoin}
       GROUP BY p.mode_paiement`,
      baseParams
    );
    const [genreParMois] = await db.query(
      `SELECT DATE_FORMAT(p.date_paiement,'%b %Y') as mois, e.genre, SUM(p.montant_usd) as total
       FROM paiements p JOIN eleves e ON e.id=p.eleve_id
       WHERE p.statut='valide' AND p.annee_scolaire=? ${classeJoin}
       GROUP BY DATE_FORMAT(p.date_paiement,'%Y-%m'), e.genre
       ORDER BY DATE_FORMAT(p.date_paiement,'%Y-%m') ASC`,
      baseParams
    );

    const classeFiltreArch = classe_id ? 'AND a.classe_id=?' : '';
    const paramsArch = classe_id ? [anneeCible, classe_id] : [anneeCible];

    const [parClasse] = await db.query(
      `SELECT c.id, c.nom as classe, COUNT(a.id) as nb_eleves,
              COALESCE(SUM(a.total_paye),0) as total_paye,
              COALESCE(SUM(a.frais_scolarite_total),0) as total_attendu,
              SUM(CASE WHEN a.statut_paiement='solde' THEN 1 ELSE 0 END) as nb_soldes
       FROM archives_annuelles a LEFT JOIN classes c ON c.id=a.classe_id
       WHERE a.annee_scolaire=? ${classeFiltreArch}
       GROUP BY a.classe_id ORDER BY c.ordre ASC, c.nom ASC`,
      paramsArch
    );

    const [elevesSoldes] = await db.query(
      `SELECT e.id, e.nom, e.prenom, e.matricule, e.genre, c.nom as classe, a.frais_scolarite_total, a.total_paye
       FROM archives_annuelles a JOIN eleves e ON e.id=a.eleve_id LEFT JOIN classes c ON c.id=a.classe_id
       WHERE a.annee_scolaire=? AND a.statut_paiement='solde' ${classeFiltreArch}
       ORDER BY e.nom ASC`,
      paramsArch
    );
    const [elevesPartiels] = await db.query(
      `SELECT e.id, e.nom, e.prenom, e.matricule, e.genre, c.nom as classe, a.frais_scolarite_total, a.total_paye
       FROM archives_annuelles a JOIN eleves e ON e.id=a.eleve_id LEFT JOIN classes c ON c.id=a.classe_id
       WHERE a.annee_scolaire=? AND a.statut_paiement='partiel' ${classeFiltreArch}
       ORDER BY e.nom ASC`,
      paramsArch
    );
    const [elevesNonPayes] = await db.query(
      `SELECT e.id, e.nom, e.prenom, e.matricule, e.genre, c.nom as classe, a.frais_scolarite_total, a.total_paye
       FROM archives_annuelles a JOIN eleves e ON e.id=a.eleve_id LEFT JOIN classes c ON c.id=a.classe_id
       WHERE a.annee_scolaire=? AND a.statut_paiement='non_paye' ${classeFiltreArch}
       ORDER BY e.nom ASC`,
      paramsArch
    );
    const elevesNonSoldes = [...elevesPartiels, ...elevesNonPayes];

    const [[{ nb: totalElevesActifs }]] = await db.query(
      `SELECT COUNT(*) as nb FROM archives_annuelles a WHERE a.annee_scolaire=? ${classeFiltreArch}`,
      paramsArch
    );
    const [classes] = await db.query('SELECT id, nom FROM classes WHERE actif=1 ORDER BY ordre, nom');

    return res.json({
      resume, mensuel, parClasse, parMode, genreParMois,
      elevesSoldes, elevesNonSoldes, elevesPartiels, elevesNonPayes,
      previsions: { conservateur: 0, realiste: 0, optimiste: 0 },
      totalElevesActifs, classes, modeHistorique, annee: anneeCible,
    });
  }

  const where = ["p.statut='valide'", 'p.annee_scolaire=?'];
  const params = [anneeCible];
  if (debut) { where.push('DATE(p.date_paiement)>=?'); params.push(debut); }
  if (fin) { where.push('DATE(p.date_paiement)<=?'); params.push(fin); }
  if (classe_id) { where.push('e.classe_id=?'); params.push(classe_id); }
  const whereStr = `WHERE ${where.join(' AND ')}`;

  // Resume global de la periode
  const [[resume]] = await db.query(
    `SELECT COUNT(p.id) as nb_paiements, COALESCE(SUM(p.montant_usd),0) as total_usd
     FROM paiements p JOIN eleves e ON e.id=p.eleve_id ${whereStr}`,
    params
  );

  // Evolution mensuelle (courbe)
  const [mensuel] = await db.query(
    `SELECT DATE_FORMAT(p.date_paiement,'%Y-%m') as mois_key, DATE_FORMAT(p.date_paiement,'%b %Y') as mois_lbl,
            SUM(p.montant_usd) as total, COUNT(*) as nb
     FROM paiements p JOIN eleves e ON e.id=p.eleve_id ${whereStr}
     GROUP BY DATE_FORMAT(p.date_paiement,'%Y-%m') ORDER BY mois_key ASC`,
    params
  );

  // Recouvrement par classe (barres)
  const classeFiltre = classe_id ? 'AND c.id=?' : '';
  const [parClasse] = await db.query(
    `SELECT c.id, c.nom as classe,
            COUNT(DISTINCT e.id) as nb_eleves,
            COALESCE(SUM((SELECT COALESCE(SUM(p2.montant_usd),0) FROM paiements p2 WHERE p2.eleve_id=e.id AND p2.statut='valide' AND p2.annee_scolaire=e.annee_scolaire)),0) as total_paye,
            COALESCE(SUM(e.frais_scolarite_total),0) as total_attendu,
            SUM(CASE WHEN (SELECT COALESCE(SUM(p3.montant_usd),0) FROM paiements p3 WHERE p3.eleve_id=e.id AND p3.statut='valide' AND p3.annee_scolaire=e.annee_scolaire) >= e.frais_scolarite_total THEN 1 ELSE 0 END) as nb_soldes
     FROM classes c LEFT JOIN eleves e ON e.classe_id=c.id AND e.statut='actif'
     WHERE c.actif=1 ${classeFiltre}
     GROUP BY c.id ORDER BY c.ordre ASC, c.nom ASC`,
    classe_id ? [classe_id] : []
  );

  // Repartition par mode de paiement (donut)
  const [parMode] = await db.query(
    `SELECT p.mode_paiement, COUNT(*) as nb, SUM(p.montant_usd) as total
     FROM paiements p JOIN eleves e ON e.id=p.eleve_id ${whereStr}
     GROUP BY p.mode_paiement`,
    params
  );

  // Filles vs garcons par mois (horizontal)
  const [genreParMois] = await db.query(
    `SELECT DATE_FORMAT(p.date_paiement,'%b %Y') as mois, e.genre, SUM(p.montant_usd) as total
     FROM paiements p JOIN eleves e ON e.id=p.eleve_id ${whereStr}
     GROUP BY DATE_FORMAT(p.date_paiement,'%Y-%m'), e.genre
     ORDER BY DATE_FORMAT(p.date_paiement,'%Y-%m') ASC`,
    params
  );

  // Eleves soldes / non soldes (listes detaillees)
  const [elevesSoldes] = await db.query(
    `SELECT e.id, e.nom, e.prenom, e.matricule, e.genre, c.nom as classe, e.frais_scolarite_total,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye
     FROM eleves e JOIN classes c ON c.id=e.classe_id
     WHERE e.statut='actif' ${classe_id ? 'AND e.classe_id=?' : ''}
     AND e.frais_scolarite_total <= (SELECT COALESCE(SUM(p.montant_usd),0) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.annee_scolaire=e.annee_scolaire)
     ORDER BY e.nom ASC`,
    classe_id ? [classe_id] : []
  );
  const [elevesNonSoldes] = await db.query(
    `SELECT e.id, e.nom, e.prenom, e.matricule, e.genre, c.nom as classe, e.frais_scolarite_total,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye
     FROM eleves e JOIN classes c ON c.id=e.classe_id
     WHERE e.statut='actif' ${classe_id ? 'AND e.classe_id=?' : ''}
     AND e.frais_scolarite_total > (SELECT COALESCE(SUM(p.montant_usd),0) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.annee_scolaire=e.annee_scolaire)
     ORDER BY e.nom ASC`,
    classe_id ? [classe_id] : []
  );
  // Parmi les non-soldes, distinguer ceux qui n'ont rien paye de ceux qui ont paye partiellement
  const elevesPartiels = elevesNonSoldes.filter((e) => parseFloat(e.total_paye) > 0);
  const elevesNonPayes = elevesNonSoldes.filter((e) => parseFloat(e.total_paye) <= 0);

  // Previsions financieres - 3 scenarios bases sur la moyenne mensuelle observee
  const moisEcoules = Math.max(1, mensuel.length);
  const moyenneMensuelle = mensuel.reduce((s, m) => s + parseFloat(m.total), 0) / moisEcoules;
  const moisRestants = 6; // approx. mois restants de l'annee scolaire
  const previsions = {
    conservateur: Math.round(moyenneMensuelle * moisRestants * 0.8),
    realiste: Math.round(moyenneMensuelle * moisRestants),
    optimiste: Math.round(moyenneMensuelle * moisRestants * 1.2),
  };

  const [totalElevesActifs] = await db.query(
    `SELECT COUNT(*) as nb FROM eleves WHERE statut='actif' ${classe_id ? 'AND classe_id=?' : ''}`,
    classe_id ? [classe_id] : []
  );
  const [classes] = await db.query('SELECT id, nom FROM classes WHERE actif=1 ORDER BY ordre, nom');

  res.json({
    resume,
    mensuel,
    parClasse,
    parMode,
    genreParMois,
    elevesSoldes,
    elevesNonSoldes,
    elevesPartiels,
    elevesNonPayes,
    previsions,
    totalElevesActifs: totalElevesActifs[0].nb,
    classes,
    modeHistorique,
    annee: anneeCible,
  });
});

// --- CSV export endpoints ---
// GET /api/rapports/download/eleves.csv?classe_id=&status=solde|non_solde|partiel|non_paye&annee=
router.get('/download/eleves.csv', async (req, res) => {
  try {
    const { classe_id, status, annee } = req.query;
    const anneeCourante = await getParam('annee_scolaire_courante');
    const modeHistorique = !!(annee && annee !== anneeCourante);

    const [classRows] = classe_id ? await db.query('SELECT nom FROM classes WHERE id=?', [classe_id]) : [[]];
    const className = classe_id ? (classRows[0]?.nom || classe_id) : 'Toutes';
    const statusLabels = { solde: 'Soldés', non_solde: 'Non soldés', partiel: 'Partiels', non_paye: 'Non payés' };
    let rows;

    if (modeHistorique) {
      const statutMap = { solde: 'solde', partiel: 'partiel', non_paye: 'non_paye' };
      const params = [annee];
      let statusCond = '';
      if (status === 'solde' || status === 'partiel' || status === 'non_paye') {
        statusCond = 'AND a.statut_paiement=?'; params.push(statutMap[status]);
      } else if (status === 'non_solde') {
        statusCond = "AND a.statut_paiement IN ('partiel','non_paye')";
      }
      if (classe_id) { params.push(classe_id); }
      [rows] = await db.query(
        `SELECT e.matricule, e.nom, e.prenom, c.nom as classe, a.total_paye,
                (a.frais_scolarite_total - a.total_paye) as reste, NULL as date_paiement, NULL as perce_par
         FROM archives_annuelles a JOIN eleves e ON e.id=a.eleve_id LEFT JOIN classes c ON c.id=a.classe_id
         WHERE a.annee_scolaire=? ${statusCond} ${classe_id ? 'AND a.classe_id=?' : ''}
         ORDER BY e.nom ASC`,
        params
      );
    } else {
      const dbClient = (process.env.DB_CLIENT || '').toLowerCase();
      const payerName = dbClient === 'sqlite'
        ? "COALESCE(u.prenom,'') || ' ' || COALESCE(u.nom,'')"
        : "CONCAT_WS(' ', u.prenom, u.nom)";
      const payerConcat = dbClient === 'sqlite'
        ? `REPLACE(GROUP_CONCAT(DISTINCT ${payerName}), ',', ', ')`
        : `GROUP_CONCAT(DISTINCT ${payerName} SEPARATOR ', ')`;
      const dateExpr = dbClient === 'sqlite'
        ? 'p2.date_paiement'
        : "DATE_FORMAT(p2.date_paiement, '%Y-%m-%d %H:%i:%s')";

      const params = [];
      const paidSub = `(SELECT COALESCE(SUM(p.montant_usd),0) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.annee_scolaire=e.annee_scolaire)`;
      let statusCondition = '';
      if (status === 'solde') {
        statusCondition = `AND e.frais_scolarite_total <= ${paidSub}`;
      } else if (status === 'non_solde') {
        statusCondition = `AND e.frais_scolarite_total > ${paidSub}`;
      } else if (status === 'partiel') {
        statusCondition = `AND e.frais_scolarite_total > ${paidSub} AND ${paidSub} > 0`;
      } else if (status === 'non_paye') {
        statusCondition = `AND ${paidSub} <= 0`;
      }
      if (classe_id) params.push(classe_id);

      [rows] = await db.query(
        `SELECT e.matricule, e.nom, e.prenom, c.nom as classe,
                COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye,
                COALESCE(e.frais_scolarite_total,0) - COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.annee_scolaire=e.annee_scolaire),0) as reste,
                (SELECT ${dateExpr} FROM paiements p2 WHERE p2.eleve_id=e.id AND p2.statut='valide' ORDER BY p2.date_paiement DESC LIMIT 1) as date_paiement,
                (SELECT ${payerConcat} FROM paiements p2 JOIN utilisateurs u ON u.id=p2.comptable_id WHERE p2.eleve_id=e.id AND p2.statut='valide') as perce_par
         FROM eleves e JOIN classes c ON c.id=e.classe_id
         WHERE e.statut='actif' ${classe_id ? 'AND e.classe_id=?' : ''} ${statusCondition}
         ORDER BY e.nom ASC`,
        params
      );
    }

    const meta = [];
    meta.push(`# Rapport: Liste des élèves (${statusLabels[status] || 'Tous'})${modeHistorique ? ` — année ${annee}` : ''}`);
    meta.push(`# Classe: ${className}`);
    meta.push(`# Généré le: ${new Date().toLocaleString()}`);
    meta.push('# Colonnes: Matricule;Nom;Prénom;Total payé;Reste;Date paiement;Perçu par;Classe');

    const header = ['Matricule', 'Nom', 'Prénom', 'Total payé', 'Reste', 'Date paiement', 'Perçu par', 'Classe'];
    const lines = [header.join(';')];
    rows.forEach((e) => {
      lines.push([
        e.matricule || '',
        e.nom || '',
        e.prenom || '',
        e.total_paye || 0,
        e.reste || 0,
        e.date_paiement || '',
        e.perce_par || '',
        e.classe || '',
      ].join(';'));
    });

    res.setHeader('Content-Type', 'text/csv; charset=UTF-8');
    res.setHeader('Content-Disposition', `attachment; filename="eleves_${status || 'liste'}_${Date.now()}.csv"`);
    res.send('﻿' + meta.join('\n') + '\n' + lines.join('\n'));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la generation du CSV.' });
  }
});

// GET /api/rapports/download/par-classe.csv?classe_id=&annee=
router.get('/download/par-classe.csv', async (req, res) => {
  try {
    const { classe_id, annee } = req.query;
    const anneeCourante = await getParam('annee_scolaire_courante');
    const modeHistorique = !!(annee && annee !== anneeCourante);
    let rows;

    if (modeHistorique) {
      const classeFiltreArch = classe_id ? 'AND a.classe_id=?' : '';
      const paramsArch = classe_id ? [annee, classe_id] : [annee];
      [rows] = await db.query(
        `SELECT c.nom as classe, COUNT(a.id) as nb_eleves,
                COALESCE(SUM(a.total_paye),0) as total_paye,
                COALESCE(SUM(a.frais_scolarite_total),0) as total_attendu,
                SUM(CASE WHEN a.statut_paiement='solde' THEN 1 ELSE 0 END) as nb_soldes
         FROM archives_annuelles a LEFT JOIN classes c ON c.id=a.classe_id
         WHERE a.annee_scolaire=? ${classeFiltreArch}
         GROUP BY a.classe_id ORDER BY c.ordre ASC, c.nom ASC`,
        paramsArch
      );
    } else {
      const classeFiltre = classe_id ? 'AND c.id=?' : '';
      [rows] = await db.query(
        `SELECT c.nom as classe,
                COUNT(DISTINCT e.id) as nb_eleves,
                COALESCE(SUM((SELECT COALESCE(SUM(p2.montant_usd),0) FROM paiements p2 WHERE p2.eleve_id=e.id AND p2.statut='valide' AND p2.annee_scolaire=e.annee_scolaire)),0) as total_paye,
                COALESCE(SUM(e.frais_scolarite_total),0) as total_attendu,
                SUM(CASE WHEN (SELECT COALESCE(SUM(p3.montant_usd),0) FROM paiements p3 WHERE p3.eleve_id=e.id AND p3.statut='valide' AND p3.annee_scolaire=e.annee_scolaire) >= e.frais_scolarite_total THEN 1 ELSE 0 END) as nb_soldes
         FROM classes c LEFT JOIN eleves e ON e.classe_id=c.id AND e.statut='actif'
         WHERE c.actif=1 ${classeFiltre}
         GROUP BY c.id ORDER BY c.ordre ASC, c.nom ASC`,
        classe_id ? [classe_id] : []
      );
    }

    const meta = [
      `# Rapport: Recouvrement par classe${modeHistorique ? ` — année ${annee}` : ''}`,
      `# Généré le: ${new Date().toLocaleString()}`,
      '# Colonnes: Classe;Effectif;Payé(USD);Attendu(USD);% Recouvrement;Élèves soldés',
    ];
    const header = ['Classe', 'Effectif', 'Payé(USD)', 'Attendu(USD)', '% Recouvrement', 'Élèves soldés'];
    const lines = [header.join(';')];
    rows.forEach((r) => {
      const pct = r.total_attendu > 0 ? Math.round((r.total_paye / r.total_attendu) * 1000) / 10 : 0;
      lines.push([r.classe, r.nb_eleves, r.total_paye, r.total_attendu, pct, r.nb_soldes].join(';'));
    });

    res.setHeader('Content-Type', 'text/csv; charset=UTF-8');
    res.setHeader('Content-Disposition', `attachment; filename="recouvrement_par_classe_${Date.now()}.csv"`);
    res.send('﻿' + meta.join('\n') + '\n' + lines.join('\n'));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la generation du CSV.' });
  }
});

// GET /api/rapports/download/par-mode.csv?debut=&fin=&classe_id=&annee=
router.get('/download/par-mode.csv', async (req, res) => {
  try {
    const { debut, fin, classe_id, annee } = req.query;
    const anneeCourante = await getParam('annee_scolaire_courante');
    const anneeCible = annee || anneeCourante;
    const modeHistorique = !!(annee && annee !== anneeCourante);

    const where = ["p.statut='valide'", 'p.annee_scolaire=?'];
    const params = [anneeCible];
    if (!modeHistorique) {
      if (debut) { where.push('DATE(p.date_paiement)>=?'); params.push(debut); }
      if (fin) { where.push('DATE(p.date_paiement)<=?'); params.push(fin); }
    }
    if (classe_id) { where.push('e.classe_id=?'); params.push(classe_id); }
    const whereStr = `WHERE ${where.join(' AND ')}`;

    const [rows] = await db.query(
      `SELECT p.mode_paiement, COUNT(*) as nb, SUM(p.montant_usd) as total
       FROM paiements p JOIN eleves e ON e.id=p.eleve_id ${whereStr}
       GROUP BY p.mode_paiement`,
      params
    );
    const MODE_LABELS = { especes: 'Espèces', mobile_money: 'Mobile Money', virement: 'Virement', cheque: 'Chèque' };

    const meta = [
      '# Rapport: Répartition par mode de paiement',
      `# Année: ${anneeCible}${!modeHistorique ? ` (période: ${debut || 'début'} → ${fin || "aujourd'hui"})` : ''}`,
      `# Généré le: ${new Date().toLocaleString()}`,
      '# Colonnes: Mode;Nombre de paiements;Total(USD)',
    ];
    const header = ['Mode', 'Nombre de paiements', 'Total(USD)'];
    const lines = [header.join(';')];
    rows.forEach((r) => {
      lines.push([MODE_LABELS[r.mode_paiement] || r.mode_paiement, r.nb, r.total || 0].join(';'));
    });

    res.setHeader('Content-Type', 'text/csv; charset=UTF-8');
    res.setHeader('Content-Disposition', `attachment; filename="repartition_par_mode_${Date.now()}.csv"`);
    res.send('﻿' + meta.join('\n') + '\n' + lines.join('\n'));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la generation du CSV.' });
  }
});

// GET /api/rapports/download/paiements-today.csv?date=YYYY-MM-DD
router.get('/download/paiements-today.csv', async (req, res) => {
  try {
    const date = req.query.date || null;
    const params = [];
    const dateFilter = date ? 'DATE(p.date_paiement)=?' : 'DATE(p.date_paiement)=CURDATE()';
    if (date) params.push(date);

    const [rows] = await db.query(
      `SELECT p.reference, p.montant_usd as montant_usd, p.devise, p.mode_paiement, p.type_paiement, p.statut,
              p.date_paiement, e.matricule, e.nom, e.prenom, c.nom as classe
       FROM paiements p JOIN eleves e ON e.id=p.eleve_id JOIN classes c ON c.id=e.classe_id
       WHERE ${dateFilter} AND p.statut='valide' ORDER BY p.date_paiement ASC`,
      params
    );

    const total = rows.reduce((s, r) => s + parseFloat(r.montant_usd || 0), 0);

    const meta = [];
    meta.push('# Rapport: Paiements du jour');
    meta.push(`# Date: ${date || new Date().toISOString().slice(0,10)}`);
    meta.push(`# Nombre de paiements: ${rows.length}`);
    meta.push(`# Total (USD): ${total.toFixed(2)}`);
    meta.push('# Colonnes: Reference;Montant(USD);Devise;Mode;Type;Statut;Date;Matricule;Nom;Prenom;Classe');

    const header = ['Reference', 'Montant(USD)', 'Devise', 'Mode', 'Type', 'Statut', 'Date', 'Matricule', 'Nom', 'Prenom', 'Classe'];
    const lines = [header.join(';')];
    rows.forEach((p) => {
      lines.push([p.reference, p.montant_usd || 0, p.devise || '', p.mode_paiement || '', p.type_paiement || '', p.statut || '', p.date_paiement || '', p.matricule || '', p.nom || '', p.prenom || '', p.classe || ''].join(';'));
    });

    res.setHeader('Content-Type', 'text/csv; charset=UTF-8');
    res.setHeader('Content-Disposition', `attachment; filename="paiements_${date || 'today'}_${Date.now()}.csv"`);
    res.send('﻿' + meta.join('\n') + '\n' + lines.join('\n'));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la generation du CSV.' });
  }
});

module.exports = router;
