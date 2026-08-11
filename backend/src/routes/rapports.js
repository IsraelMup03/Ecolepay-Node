const express = require('express');
const db = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requirePermission('rapports'));

// GET /api/rapports?debut=&fin=&classe_id=
router.get('/', async (req, res) => {
  const { debut, fin, classe_id } = req.query;

  const where = ["p.statut='valide'"];
  const params = [];
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
  const classeFiltre = classe_id ? `AND c.id=${db.escape(classe_id)}` : '';
  const [parClasse] = await db.query(
    `SELECT c.id, c.nom as classe,
            COUNT(DISTINCT e.id) as nb_eleves,
            COALESCE(SUM((SELECT COALESCE(SUM(p2.montant_usd),0) FROM paiements p2 WHERE p2.eleve_id=e.id AND p2.statut='valide')),0) as total_paye,
            COALESCE(SUM(e.frais_scolarite_total),0) as total_attendu,
            SUM(CASE WHEN (SELECT COALESCE(SUM(p3.montant_usd),0) FROM paiements p3 WHERE p3.eleve_id=e.id AND p3.statut='valide') >= e.frais_scolarite_total THEN 1 ELSE 0 END) as nb_soldes
     FROM classes c LEFT JOIN eleves e ON e.classe_id=c.id AND e.statut='actif'
     WHERE c.actif=1 ${classeFiltre}
     GROUP BY c.id ORDER BY c.ordre ASC, c.nom ASC`
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
    `SELECT e.id, e.nom, e.prenom, e.matricule, e.genre, c.nom as classe
     FROM eleves e JOIN classes c ON c.id=e.classe_id
     WHERE e.statut='actif' ${classe_id ? 'AND e.classe_id=?' : ''}
     AND e.frais_scolarite_total <= (SELECT COALESCE(SUM(p.montant_usd),0) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide')
     ORDER BY e.nom ASC`,
    classe_id ? [classe_id] : []
  );
  const [elevesNonSoldes] = await db.query(
    `SELECT e.id, e.nom, e.prenom, e.matricule, e.genre, c.nom as classe, e.frais_scolarite_total,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide'),0) as total_paye
     FROM eleves e JOIN classes c ON c.id=e.classe_id
     WHERE e.statut='actif' ${classe_id ? 'AND e.classe_id=?' : ''}
     AND e.frais_scolarite_total > (SELECT COALESCE(SUM(p.montant_usd),0) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide')
     ORDER BY e.nom ASC`,
    classe_id ? [classe_id] : []
  );

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
    previsions,
    totalElevesActifs: totalElevesActifs[0].nb,
    classes,
  });
});

// --- CSV export endpoints ---
// GET /api/rapports/download/eleves.csv?classe_id=&status=solde|non_solde
router.get('/download/eleves.csv', async (req, res) => {
  try {
    const { classe_id, status } = req.query;
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

    const [classRows] = classe_id ? await db.query('SELECT nom FROM classes WHERE id=?', [classe_id]) : [[]];
    const className = classe_id ? (classRows[0]?.nom || classe_id) : 'Toutes';

    const params = [];
    let statusCondition = '';
    if (status === 'solde') {
      statusCondition = `AND e.frais_scolarite_total <= (SELECT COALESCE(SUM(p.montant_usd),0) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide')`;
    } else if (status === 'non_solde') {
      statusCondition = `AND e.frais_scolarite_total > (SELECT COALESCE(SUM(p.montant_usd),0) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide')`;
    }
    if (classe_id) params.push(classe_id);

    const [rows] = await db.query(
      `SELECT e.matricule, e.nom, e.prenom, c.nom as classe,
              COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide'),0) as total_paye,
              COALESCE(e.frais_scolarite_total,0) - COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide'),0) as reste,
              (SELECT ${dateExpr} FROM paiements p2 WHERE p2.eleve_id=e.id AND p2.statut='valide' ORDER BY p2.date_paiement DESC LIMIT 1) as date_paiement,
              (SELECT ${payerConcat} FROM paiements p2 JOIN utilisateurs u ON u.id=p2.comptable_id WHERE p2.eleve_id=e.id AND p2.statut='valide') as perce_par
       FROM eleves e JOIN classes c ON c.id=e.classe_id
       WHERE e.statut='actif' ${classe_id ? 'AND e.classe_id=?' : ''} ${statusCondition}
       ORDER BY e.nom ASC`,
      params
    );

    const meta = [];
    meta.push(`# Rapport: Liste des élèves (${status === 'solde' ? 'Soldés' : status === 'non_solde' ? 'Non soldés' : 'Tous'})`);
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
    res.send('\uFEFF' + meta.join('\n') + '\n' + lines.join('\n'));
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
    res.send('\uFEFF' + meta.join('\n') + '\n' + lines.join('\n'));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la generation du CSV.' });
  }
});

module.exports = router;
