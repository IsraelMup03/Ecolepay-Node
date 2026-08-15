const express = require('express');
const db = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getParam } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth, requirePermission('historique'));

// GET /api/historique/annees  (liste des annees scolaires ayant des donnees)
router.get('/annees', async (req, res) => {
  const [rows] = await db.query(
    `SELECT annee_scolaire FROM paiements WHERE annee_scolaire IS NOT NULL AND annee_scolaire != ''
     UNION
     SELECT annee_scolaire FROM archives_annuelles WHERE annee_scolaire IS NOT NULL AND annee_scolaire != ''
     UNION
     SELECT annee_scolaire FROM eleves WHERE annee_scolaire IS NOT NULL AND annee_scolaire != ''
     ORDER BY annee_scolaire DESC`
  );
  const anneeCourante = await getParam('annee_scolaire_courante');
  const annees = rows.map((r) => r.annee_scolaire);
  if (anneeCourante && !annees.includes(anneeCourante)) annees.unshift(anneeCourante);
  res.json({ annees, anneeCourante });
});

// GET /api/historique/:annee?p=1&ps=1  (tout ce qui s'est passe durant une annee scolaire)
router.get('/:annee', async (req, res) => {
  const { annee } = req.params;
  const page = Math.max(1, parseInt(req.query.p, 10) || 1);
  const perPage = 25;
  const offset = (page - 1) * perPage;
  // Pagination separee pour l'onglet "Situation par eleve" : une grosse ecole apres
  // plusieurs annees peut avoir des milliers d'eleves archives sur une meme annee, un
  // tableau non pagine cote client devient alors injouable (des milliers de <tr>).
  const pageSituation = Math.max(1, parseInt(req.query.ps, 10) || 1);
  const perPageSituation = 50;
  const offsetSituation = (pageSituation - 1) * perPageSituation;
  const anneeCourante = await getParam('annee_scolaire_courante');

  const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM paiements WHERE annee_scolaire=?', [annee]);
  const [[resume]] = await db.query(
    `SELECT COUNT(*) as nb_paiements, COALESCE(SUM(CASE WHEN statut='valide' THEN montant_usd ELSE 0 END),0) as total_encaisse
     FROM paiements WHERE annee_scolaire=?`,
    [annee]
  );
  const [paiements] = await db.query(
    `SELECT p.id, p.reference, p.type_paiement, p.montant, p.devise, p.montant_usd, p.mode_paiement, p.statut, p.date_paiement,
            p.montant_surplus, p.surplus_rembourse,
            e.nom, e.prenom, e.matricule, c.nom as classe, u.prenom as cpt_prenom, u.nom as cpt_nom,
            COALESCE((SELECT SUM(r.montant_usd) FROM remboursements r WHERE r.paiement_id=p.id AND r.statut='approuve'),0) as montant_rembourse_usd
     FROM paiements p
     JOIN eleves e ON e.id=p.eleve_id
     LEFT JOIN classes c ON c.id=e.classe_id
     LEFT JOIN utilisateurs u ON u.id=p.comptable_id
     WHERE p.annee_scolaire=?
     ORDER BY p.date_paiement DESC LIMIT ${perPage} OFFSET ${offset}`,
    [annee]
  );

  const [remboursements] = await db.query(
    `SELECT r.id, r.reference_remboursement, r.montant, r.montant_usd, r.devise, r.motif, r.statut, r.date_remboursement,
            e.nom, e.prenom, e.matricule, p.reference as pay_ref, u.prenom as appr_prenom, u.nom as appr_nom
     FROM remboursements r
     JOIN paiements p ON p.id=r.paiement_id
     JOIN eleves e ON e.id=r.eleve_id
     LEFT JOIN utilisateurs u ON u.id=r.approuve_par
     WHERE p.annee_scolaire=?
     ORDER BY r.date_remboursement DESC`,
    [annee]
  );

  // Situation financiere par eleve : archive figee si l'annee est cloturee,
  // sinon calcul live pour l'annee scolaire en cours (pas encore archivee).
  let situation = [];
  let situationTotal = 0;
  const [[{ nb: archiveCount }]] = await db.query('SELECT COUNT(*) as nb FROM archives_annuelles WHERE annee_scolaire=?', [annee]);
  if (archiveCount > 0) {
    situationTotal = archiveCount;
    [situation] = await db.query(
      `SELECT a.eleve_id, a.classe_id, a.frais_scolarite_total, a.total_paye, a.statut_paiement,
              e.nom, e.prenom, e.matricule, e.genre, c.nom as classe_nom
       FROM archives_annuelles a
       JOIN eleves e ON e.id=a.eleve_id
       LEFT JOIN classes c ON c.id=a.classe_id
       WHERE a.annee_scolaire=?
       ORDER BY e.nom ASC LIMIT ${perPageSituation} OFFSET ${offsetSituation}`,
      [annee]
    );
  } else if (annee === anneeCourante) {
    const [[{ nb: liveCount }]] = await db.query("SELECT COUNT(*) as nb FROM eleves WHERE statut='actif'");
    situationTotal = liveCount;
    const [liveRows] = await db.query(
      `SELECT e.id as eleve_id, e.classe_id, e.nom, e.prenom, e.matricule, e.genre, c.nom as classe_nom,
              e.frais_scolarite_total,
              COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite' AND p.annee_scolaire=?),0) as total_paye
       FROM eleves e LEFT JOIN classes c ON c.id=e.classe_id
       WHERE e.statut='actif'
       ORDER BY e.nom ASC LIMIT ${perPageSituation} OFFSET ${offsetSituation}`,
      [annee]
    );
    situation = liveRows.map((r) => ({
      ...r,
      statut_paiement: r.total_paye >= r.frais_scolarite_total ? 'solde' : (r.total_paye > 0 ? 'partiel' : 'non_paye'),
    }));
  }

  res.json({
    annee,
    estAnneeCourante: annee === anneeCourante,
    resume: { ...resume, nb_remboursements: remboursements.length, nb_eleves: situationTotal },
    paiements,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    remboursements,
    situation,
    situationTotal,
    pageSituation,
    situationTotalPages: Math.max(1, Math.ceil(situationTotal / perPageSituation)),
  });
});

module.exports = router;
