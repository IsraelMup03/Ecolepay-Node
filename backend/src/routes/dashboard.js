const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { getEcole, getParam } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth);

// GET /api/dashboard?annee=  (annee: consulter une annee passee, lecture seule)
router.get('/', async (req, res) => {
  const ecole = await getEcole();
  const anneeCourante = await getParam('annee_scolaire_courante');
  const devise = ecole?.devise || 'USD';
  const modeHistorique = !!(req.query.annee && req.query.annee !== anneeCourante);
  const annee = modeHistorique ? req.query.annee : anneeCourante;

  if (modeHistorique) {
    const [[{ totalEleves }]] = await db.query('SELECT COUNT(*) as totalEleves FROM archives_annuelles WHERE annee_scolaire=?', [annee]);
    const [[{ totalFilles }]] = await db.query(
      `SELECT COUNT(*) as totalFilles FROM archives_annuelles a JOIN eleves e ON e.id=a.eleve_id WHERE a.annee_scolaire=? AND e.genre='F'`,
      [annee]
    );
    const [[{ totalGarcons }]] = await db.query(
      `SELECT COUNT(*) as totalGarcons FROM archives_annuelles a JOIN eleves e ON e.id=a.eleve_id WHERE a.annee_scolaire=? AND e.genre='M'`,
      [annee]
    );
    const [[{ totalClasses }]] = await db.query('SELECT COUNT(DISTINCT classe_id) as totalClasses FROM archives_annuelles WHERE annee_scolaire=?', [annee]);
    const [[{ totalAnnee }]] = await db.query(
      "SELECT COALESCE(SUM(montant_usd),0) as totalAnnee FROM paiements WHERE annee_scolaire=? AND statut='valide'", [annee]
    );
    const [[{ totalAttendu }]] = await db.query('SELECT COALESCE(SUM(frais_scolarite_total),0) as totalAttendu FROM archives_annuelles WHERE annee_scolaire=?', [annee]);
    const taux = totalAttendu > 0 ? Math.round((totalAnnee / totalAttendu) * 1000) / 10 : 0;
    const [[{ elevesSoldes }]] = await db.query(
      "SELECT COUNT(*) as elevesSoldes FROM archives_annuelles WHERE annee_scolaire=? AND statut_paiement='solde'", [annee]
    );
    const elevesNonSoldes = totalEleves - elevesSoldes;

    const [mensuel] = await db.query(
      `SELECT DATE_FORMAT(date_paiement,'%Y-%m') as mk, DATE_FORMAT(date_paiement,'%b %Y') as lbl,
              SUM(montant_usd) as total, COUNT(*) as nb
       FROM paiements WHERE statut='valide' AND annee_scolaire=?
       GROUP BY DATE_FORMAT(date_paiement,'%Y-%m') ORDER BY mk ASC`,
      [annee]
    );

    const [parClasse] = await db.query(
      `SELECT c.nom as classe, COUNT(a.id) as nb_eleves,
              COALESCE(SUM(a.total_paye),0) as total_paye,
              COALESCE(SUM(a.frais_scolarite_total),0) as total_attendu
       FROM archives_annuelles a LEFT JOIN classes c ON c.id=a.classe_id
       WHERE a.annee_scolaire=? GROUP BY a.classe_id ORDER BY total_paye DESC LIMIT 8`,
      [annee]
    );

    const [derniers] = await db.query(
      `SELECT p.*, e.nom, e.prenom, e.matricule, c.nom as classe, u.prenom as cp, u.nom as cn
       FROM paiements p JOIN eleves e ON e.id=p.eleve_id LEFT JOIN classes c ON c.id=e.classe_id
       LEFT JOIN utilisateurs u ON u.id=p.comptable_id
       WHERE p.statut='valide' AND p.annee_scolaire=? ORDER BY p.date_creation DESC LIMIT 8`,
      [annee]
    );

    return res.json({
      ecole, annee, devise, modeHistorique,
      stats: {
        totalEleves, totalFilles, totalGarcons, totalClasses,
        totalAnnee, paiementsAujourdhui: 0, paiementsMois: 0, totalAttendu, taux,
        elevesSoldes, elevesNonSoldes, payF: 0, payM: 0,
      },
      mensuel, parClasse, derniers,
    });
  }

  const [[{ totalEleves }]] = await db.query("SELECT COUNT(*) as totalEleves FROM eleves WHERE statut='actif'");
  const [[{ totalFilles }]] = await db.query("SELECT COUNT(*) as totalFilles FROM eleves WHERE statut='actif' AND genre='F'");
  const [[{ totalGarcons }]] = await db.query("SELECT COUNT(*) as totalGarcons FROM eleves WHERE statut='actif' AND genre='M'");
  const [[{ totalClasses }]] = await db.query('SELECT COUNT(*) as totalClasses FROM classes WHERE actif=1');

  const [[{ totalAnnee }]] = await db.query(
    "SELECT COALESCE(SUM(montant_usd),0) as totalAnnee FROM paiements WHERE annee_scolaire=? AND statut='valide'", [annee]
  );
  const [[{ paiementsAujourdhui }]] = await db.query(
    "SELECT COALESCE(SUM(montant_usd),0) as paiementsAujourdhui FROM paiements WHERE DATE(date_paiement)=CURDATE() AND statut='valide' AND annee_scolaire=?", [annee]
  );
  const [[{ paiementsMois }]] = await db.query(
    "SELECT COALESCE(SUM(montant_usd),0) as paiementsMois FROM paiements WHERE MONTH(date_paiement)=MONTH(CURDATE()) AND YEAR(date_paiement)=YEAR(CURDATE()) AND statut='valide' AND annee_scolaire=?", [annee]
  );
  const [[{ totalAttendu }]] = await db.query(
    "SELECT COALESCE(SUM(frais_scolarite_total),0) as totalAttendu FROM eleves WHERE statut='actif' AND annee_scolaire=?", [annee]
  );
  const taux = totalAttendu > 0 ? Math.round((totalAnnee / totalAttendu) * 1000) / 10 : 0;

  const [[{ elevesSoldes }]] = await db.query(
    `SELECT COUNT(*) as elevesSoldes FROM eleves e WHERE e.statut='actif' AND e.annee_scolaire=?
     AND e.frais_scolarite_total <= (SELECT COALESCE(SUM(p.montant_usd),0) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.annee_scolaire=e.annee_scolaire)`,
    [annee]
  );
  const elevesNonSoldes = totalEleves - elevesSoldes;

  const [mensuel] = await db.query(
    `SELECT DATE_FORMAT(date_paiement,'%Y-%m') as mk, DATE_FORMAT(date_paiement,'%b %Y') as lbl,
            SUM(montant_usd) as total, COUNT(*) as nb
     FROM paiements WHERE statut='valide' AND date_paiement >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
     GROUP BY DATE_FORMAT(date_paiement,'%Y-%m') ORDER BY mk ASC`
  );

  const [parClasse] = await db.query(
    `SELECT c.nom as classe, COUNT(DISTINCT e.id) as nb_eleves,
            COALESCE(SUM((SELECT COALESCE(SUM(p.montant_usd),0) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.annee_scolaire=e.annee_scolaire)),0) as total_paye,
            COALESCE(SUM(e.frais_scolarite_total),0) as total_attendu
     FROM classes c LEFT JOIN eleves e ON e.classe_id=c.id AND e.statut='actif'
     WHERE c.actif=1 GROUP BY c.id ORDER BY total_paye DESC LIMIT 8`
  );

  const [[{ payF }]] = await db.query(
    "SELECT COALESCE(SUM(p.montant_usd),0) as payF FROM paiements p JOIN eleves e ON e.id=p.eleve_id WHERE e.genre='F' AND MONTH(p.date_paiement)=MONTH(CURDATE()) AND p.statut='valide' AND p.annee_scolaire=?", [annee]
  );
  const [[{ payM }]] = await db.query(
    "SELECT COALESCE(SUM(p.montant_usd),0) as payM FROM paiements p JOIN eleves e ON e.id=p.eleve_id WHERE e.genre='M' AND MONTH(p.date_paiement)=MONTH(CURDATE()) AND p.statut='valide' AND p.annee_scolaire=?", [annee]
  );

  const [derniers] = await db.query(
    `SELECT p.*, e.nom, e.prenom, e.matricule, c.nom as classe, u.prenom as cp, u.nom as cn
     FROM paiements p JOIN eleves e ON e.id=p.eleve_id JOIN classes c ON c.id=e.classe_id
     LEFT JOIN utilisateurs u ON u.id=p.comptable_id
     WHERE p.statut='valide' AND p.annee_scolaire=? ORDER BY p.date_creation DESC LIMIT 8`,
    [annee]
  );

  res.json({
    ecole, annee, devise, modeHistorique,
    stats: {
      totalEleves, totalFilles, totalGarcons, totalClasses,
      totalAnnee, paiementsAujourdhui, paiementsMois, totalAttendu, taux,
      elevesSoldes, elevesNonSoldes, payF, payM,
    },
    mensuel, parClasse, derniers,
  });
});

module.exports = router;
