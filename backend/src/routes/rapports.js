const express = require('express');
const db = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getParam, getEcole } = require('../utils/helpers');
const { newWorkbook, addLetterhead, addTable, sendWorkbook, deviseLabel } = require('../utils/excelReport');

// Lit devise=USD|CDF (ou autre code local) depuis la query et le taux de change courant,
// pour que les exports Excel respectent le meme bascule USD<->devise locale que le reste
// du logiciel (voir DeviseContext cote frontend).
async function resolveDevise(req) {
  const devise = req.query.devise === 'CDF' || (req.query.devise && req.query.devise !== 'USD') ? req.query.devise : 'USD';
  const taux = parseFloat(await getParam('taux_usd_cdf', '1')) || 1;
  return { devise, taux };
}

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

// --- Exports Excel (.xlsx) ---
// GET /api/rapports/download/eleves.xlsx?classe_id=&status=solde|non_solde|partiel|non_paye&annee=
router.get('/download/eleves.xlsx', async (req, res) => {
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

    const ecole = await getEcole();
    const { devise, taux } = await resolveDevise(req);
    const workbook = newWorkbook();
    const sheet = workbook.addWorksheet('Élèves', { views: [{ state: 'frozen', ySplit: 8 }] });
    const columns = [
      { header: 'Matricule', key: 'matricule', width: 16, type: 'text' },
      { header: 'Nom', key: 'nom', width: 18, type: 'text' },
      { header: 'Prénom', key: 'prenom', width: 18, type: 'text' },
      { header: 'Classe', key: 'classe', width: 22, type: 'text' },
      { header: 'Total payé', key: 'total_paye', width: 16, type: 'currency', totalize: true },
      { header: 'Reste', key: 'reste', width: 16, type: 'currency', totalize: true },
      { header: 'Dernier paiement', key: 'date_paiement', width: 20, type: 'text' },
      { header: 'Perçu par', key: 'perce_par', width: 20, type: 'text' },
    ];
    const nextRow = addLetterhead(sheet, {
      ecole,
      title: `Liste des élèves — ${statusLabels[status] || 'Tous'}${modeHistorique ? ` (année ${annee})` : ''}`,
      subtitle: `Classe : ${className}`,
      generatedBy: req.user ? `${req.user.prenom || ''} ${req.user.nom || ''}`.trim() : null,
      numCols: columns.length,
    });
    addTable(sheet, nextRow, columns, rows.map((e) => ({
      matricule: e.matricule || '', nom: e.nom || '', prenom: e.prenom || '', classe: e.classe || '',
      total_paye: parseFloat(e.total_paye) || 0, reste: parseFloat(e.reste) || 0,
      date_paiement: e.date_paiement ? new Date(e.date_paiement).toLocaleDateString('fr-FR') : '—',
      perce_par: e.perce_par || '—',
    })), { showTotals: true, devise, taux });

    await sendWorkbook(res, workbook, `eleves_${status || 'liste'}_${Date.now()}.xlsx`);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la generation du rapport.' });
  }
});

// GET /api/rapports/download/par-classe.xlsx?classe_id=&annee=
router.get('/download/par-classe.xlsx', async (req, res) => {
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

    const ecole = await getEcole();
    const { devise, taux } = await resolveDevise(req);
    const workbook = newWorkbook();
    const sheet = workbook.addWorksheet('Recouvrement par classe');
    const columns = [
      { header: 'Classe', key: 'classe', width: 26, type: 'text' },
      { header: 'Effectif', key: 'nb_eleves', width: 12, type: 'number', totalize: true },
      { header: 'Payé', key: 'total_paye', width: 16, type: 'currency', totalize: true },
      { header: 'Attendu', key: 'total_attendu', width: 16, type: 'currency', totalize: true },
      { header: 'Recouvrement', key: 'pct', width: 14, type: 'percent' },
      { header: 'Élèves soldés', key: 'nb_soldes', width: 14, type: 'number', totalize: true },
    ];
    const nextRow = addLetterhead(sheet, {
      ecole,
      title: `Recouvrement par classe${modeHistorique ? ` — année ${annee}` : ''}`,
      subtitle: null,
      generatedBy: req.user ? `${req.user.prenom || ''} ${req.user.nom || ''}`.trim() : null,
      numCols: columns.length,
    });
    addTable(sheet, nextRow, columns, rows.map((r) => ({
      classe: r.classe || '—', nb_eleves: r.nb_eleves || 0,
      total_paye: parseFloat(r.total_paye) || 0, total_attendu: parseFloat(r.total_attendu) || 0,
      pct: r.total_attendu > 0 ? Math.round((r.total_paye / r.total_attendu) * 1000) / 10 : 0,
      nb_soldes: r.nb_soldes || 0,
    })), { showTotals: true, devise, taux });

    await sendWorkbook(res, workbook, `recouvrement_par_classe_${Date.now()}.xlsx`);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la generation du rapport.' });
  }
});

// GET /api/rapports/download/par-mode.xlsx?debut=&fin=&classe_id=&annee=
router.get('/download/par-mode.xlsx', async (req, res) => {
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

    const ecole = await getEcole();
    const { devise, taux } = await resolveDevise(req);
    const workbook = newWorkbook();
    const sheet = workbook.addWorksheet('Répartition par mode');
    const columns = [
      { header: 'Mode de paiement', key: 'mode', width: 24, type: 'text' },
      { header: 'Nombre de paiements', key: 'nb', width: 20, type: 'number', totalize: true },
      { header: 'Total', key: 'total', width: 18, type: 'currency', totalize: true },
    ];
    const nextRow = addLetterhead(sheet, {
      ecole,
      title: `Répartition par mode de paiement — ${anneeCible}`,
      subtitle: !modeHistorique ? `Période : ${debut || 'début'} → ${fin || "aujourd'hui"}` : null,
      generatedBy: req.user ? `${req.user.prenom || ''} ${req.user.nom || ''}`.trim() : null,
      numCols: columns.length,
    });
    addTable(sheet, nextRow, columns, rows.map((r) => ({
      mode: MODE_LABELS[r.mode_paiement] || r.mode_paiement, nb: r.nb || 0, total: parseFloat(r.total) || 0,
    })), { showTotals: true, devise, taux });

    await sendWorkbook(res, workbook, `repartition_par_mode_${Date.now()}.xlsx`);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la generation du rapport.' });
  }
});

// GET /api/rapports/download/periode.xlsx?type=jour|semaine|mois&date=YYYY-MM-DD
// Rapport de caisse (journalier / hebdomadaire / mensuel), scope a l'annee scolaire en cours.
router.get('/download/periode.xlsx', async (req, res) => {
  try {
    const type = ['jour', 'semaine', 'mois'].includes(req.query.type) ? req.query.type : 'jour';
    const refDate = req.query.date ? new Date(`${req.query.date}T00:00:00`) : new Date();

    let debut, fin, labelType;
    if (type === 'jour') {
      debut = new Date(refDate); debut.setHours(0, 0, 0, 0);
      fin = new Date(refDate); fin.setHours(23, 59, 59, 999);
      labelType = 'Rapport journalier';
    } else if (type === 'semaine') {
      const jourSemaine = (refDate.getDay() + 6) % 7; // 0 = lundi
      debut = new Date(refDate); debut.setDate(refDate.getDate() - jourSemaine); debut.setHours(0, 0, 0, 0);
      fin = new Date(debut); fin.setDate(debut.getDate() + 6); fin.setHours(23, 59, 59, 999);
      labelType = 'Rapport hebdomadaire';
    } else {
      debut = new Date(refDate.getFullYear(), refDate.getMonth(), 1, 0, 0, 0, 0);
      fin = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0, 23, 59, 59, 999);
      labelType = 'Rapport mensuel';
    }
    const sqlFmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    const periodeLabel = type === 'jour'
      ? debut.toLocaleDateString('fr-FR')
      : `${debut.toLocaleDateString('fr-FR')} → ${fin.toLocaleDateString('fr-FR')}`;

    // Scope a l'annee scolaire en cours : un rapport de caisse melangeant des paiements
    // d'une annee deja archivee avec l'annee en cours ne serait plus coherent avec le
    // reste du logiciel (Dashboard, Rapports) qui raisonnent toujours par annee scolaire.
    const anneeCourante = await getParam('annee_scolaire_courante');

    const [paiements] = await db.query(
      `SELECT p.reference, p.montant_usd, p.devise, p.mode_paiement, p.type_paiement, p.date_paiement,
              e.matricule, e.nom, e.prenom, c.nom as classe, u.prenom as cpt_prenom, u.nom as cpt_nom
       FROM paiements p JOIN eleves e ON e.id=p.eleve_id LEFT JOIN classes c ON c.id=e.classe_id
       LEFT JOIN utilisateurs u ON u.id=p.comptable_id
       WHERE p.statut='valide' AND p.annee_scolaire=? AND p.date_paiement BETWEEN ? AND ?
       ORDER BY p.date_paiement ASC`,
      [anneeCourante, sqlFmt(debut), sqlFmt(fin)]
    );
    const [parMode] = await db.query(
      `SELECT mode_paiement, COUNT(*) as nb, SUM(montant_usd) as total FROM paiements
       WHERE statut='valide' AND annee_scolaire=? AND date_paiement BETWEEN ? AND ? GROUP BY mode_paiement`,
      [anneeCourante, sqlFmt(debut), sqlFmt(fin)]
    );
    const [parMotif] = await db.query(
      `SELECT type_paiement, COUNT(*) as nb, SUM(montant_usd) as total FROM paiements
       WHERE statut='valide' AND annee_scolaire=? AND date_paiement BETWEEN ? AND ? GROUP BY type_paiement ORDER BY total DESC`,
      [anneeCourante, sqlFmt(debut), sqlFmt(fin)]
    );
    const [parClasse] = await db.query(
      `SELECT c.nom as classe, COUNT(*) as nb, SUM(p.montant_usd) as total
       FROM paiements p JOIN eleves e ON e.id=p.eleve_id LEFT JOIN classes c ON c.id=e.classe_id
       WHERE p.statut='valide' AND p.annee_scolaire=? AND p.date_paiement BETWEEN ? AND ? GROUP BY e.classe_id ORDER BY total DESC`,
      [anneeCourante, sqlFmt(debut), sqlFmt(fin)]
    );

    const totalEncaisse = paiements.reduce((s, p) => s + (parseFloat(p.montant_usd) || 0), 0);
    const ecole = await getEcole();
    const { devise, taux } = await resolveDevise(req);
    const generatedBy = req.user ? `${req.user.prenom || ''} ${req.user.nom || ''}`.trim() : null;
    const MODE_LABELS = { especes: 'Espèces', mobile_money: 'Mobile Money', virement: 'Virement', cheque: 'Chèque' };
    const MOTIF_LABELS = { scolarite: 'Scolarité', inscription: 'Inscription', uniforme: 'Uniforme', fournitures: 'Fournitures', cantine: 'Cantine', transport: 'Transport', excursion: 'Excursion', examen: 'Examen', assurance: 'Assurance', activites: 'Activités', autre: 'Autre' };
    const totalEncaisseAffiche = devise === 'USD' ? totalEncaisse : totalEncaisse * taux;
    const decimalesTotal = devise === 'USD' ? 2 : 0;

    const workbook = newWorkbook();

    // --- Feuille 1 : Résumé ---
    const resume = workbook.addWorksheet('Résumé');
    let r = addLetterhead(resume, {
      ecole, title: `${labelType} — ${periodeLabel}`,
      subtitle: `${paiements.length} paiement(s) — Total encaissé : ${totalEncaisseAffiche.toLocaleString('fr-FR', { minimumFractionDigits: decimalesTotal, maximumFractionDigits: decimalesTotal })} ${deviseLabel(devise)}`,
      generatedBy, numCols: 3,
    });
    r = addTable(resume, r, [
      { header: 'Mode de paiement', key: 'label', width: 24, type: 'text' },
      { header: 'Nombre', key: 'nb', width: 14, type: 'number', totalize: true },
      { header: 'Total', key: 'total', width: 18, type: 'currency', totalize: true },
    ], parMode.map((m) => ({ label: MODE_LABELS[m.mode_paiement] || m.mode_paiement, nb: m.nb, total: parseFloat(m.total) || 0 })), { showTotals: true, devise, taux });

    resume.getCell(`A${r}`).value = 'Répartition par motif';
    resume.getCell(`A${r}`).font = { bold: true, size: 11, color: { argb: 'FF065F46' } };
    r += 1;
    r = addTable(resume, r, [
      { header: 'Motif', key: 'label', width: 24, type: 'text' },
      { header: 'Nombre', key: 'nb', width: 14, type: 'number', totalize: true },
      { header: 'Total', key: 'total', width: 18, type: 'currency', totalize: true },
    ], parMotif.map((m) => ({ label: MOTIF_LABELS[m.type_paiement] || m.type_paiement, nb: m.nb, total: parseFloat(m.total) || 0 })), { showTotals: true, devise, taux });

    resume.getCell(`A${r}`).value = 'Répartition par classe';
    resume.getCell(`A${r}`).font = { bold: true, size: 11, color: { argb: 'FF065F46' } };
    r += 1;
    addTable(resume, r, [
      { header: 'Classe', key: 'classe', width: 24, type: 'text' },
      { header: 'Nombre', key: 'nb', width: 14, type: 'number', totalize: true },
      { header: 'Total', key: 'total', width: 18, type: 'currency', totalize: true },
    ], parClasse.map((c) => ({ classe: c.classe || '—', nb: c.nb, total: parseFloat(c.total) || 0 })), { showTotals: true, devise, taux });

    // --- Feuille 2 : Détail des paiements ---
    const detail = workbook.addWorksheet('Détail des paiements', { views: [{ state: 'frozen', ySplit: 8 }] });
    const detailCols = [
      { header: 'Référence', key: 'reference', width: 22, type: 'text' },
      { header: 'Élève', key: 'eleve', width: 24, type: 'text' },
      { header: 'Matricule', key: 'matricule', width: 16, type: 'text' },
      { header: 'Classe', key: 'classe', width: 22, type: 'text' },
      { header: 'Motif', key: 'motif', width: 16, type: 'text' },
      { header: 'Mode', key: 'mode', width: 16, type: 'text' },
      { header: 'Montant', key: 'montant', width: 16, type: 'currency', totalize: true },
      { header: 'Date', key: 'date', width: 18, type: 'text' },
      { header: 'Encaissé par', key: 'encaisse_par', width: 20, type: 'text' },
    ];
    const rDetail = addLetterhead(detail, {
      ecole, title: `${labelType} — Détail des paiements`, subtitle: periodeLabel, generatedBy, numCols: detailCols.length,
    });
    addTable(detail, rDetail, detailCols, paiements.map((p) => ({
      reference: p.reference, eleve: `${p.prenom} ${p.nom}`, matricule: p.matricule, classe: p.classe || '—',
      motif: MOTIF_LABELS[p.type_paiement] || p.type_paiement, mode: MODE_LABELS[p.mode_paiement] || p.mode_paiement,
      montant: parseFloat(p.montant_usd) || 0, date: new Date(p.date_paiement).toLocaleString('fr-FR'),
      encaisse_par: p.cpt_prenom ? `${p.cpt_prenom} ${p.cpt_nom}` : '—',
    })), { showTotals: true, devise, taux });

    await sendWorkbook(res, workbook, `rapport_${type}_${sqlFmt(debut).slice(0, 10)}.xlsx`);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la generation du rapport.' });
  }
});

module.exports = router;
