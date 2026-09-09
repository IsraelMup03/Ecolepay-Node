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
  // Repartition par devise saisie (pas seulement le total deja converti en USD) : le
  // COALESCE(devise,'USD') protege une eventuelle ligne sans devise (jamais cense arriver,
  // le schema la defaut deja a 'USD', mais on ne veut pas qu'une telle ligne disparaisse
  // silencieusement des deux paniers). Les deux paniers se recombinent toujours exactement
  // au total_encaisse existant, par construction (meme expression, juste partitionnee).
  const [[resume]] = await db.query(
    `SELECT COUNT(*) as nb_paiements,
            COALESCE(SUM(CASE WHEN statut='valide' THEN montant_usd ELSE 0 END),0) as total_encaisse,
            COALESCE(SUM(CASE WHEN statut='valide' AND COALESCE(devise,'USD')='USD' THEN montant_usd ELSE 0 END),0) as usd_natif,
            COALESCE(SUM(CASE WHEN statut='valide' AND COALESCE(devise,'USD')='CDF' THEN montant ELSE 0 END),0) as cdf_natif,
            COALESCE(SUM(CASE WHEN statut='valide' AND COALESCE(devise,'USD')='CDF' THEN montant_usd ELSE 0 END),0) as cdf_natif_equiv_usd
     FROM paiements WHERE annee_scolaire=?`,
    [annee]
  );
  // Recettes diverses (dons, subventions...) de cette annee scolaire : doivent gonfler
  // "Total encaisse" ici aussi, exactement comme dans Comptabilite/Tableau de bord --
  // sinon un don recu une annee resterait invisible dans son propre historique.
  const [[recDiv]] = await db.query(
    `SELECT COALESCE(SUM(montant_usd),0) as total,
            COALESCE(SUM(CASE WHEN COALESCE(devise,'USD')='USD' THEN montant_usd ELSE 0 END),0) as usd_natif,
            COALESCE(SUM(CASE WHEN COALESCE(devise,'USD')='CDF' THEN montant ELSE 0 END),0) as cdf_natif,
            COALESCE(SUM(CASE WHEN COALESCE(devise,'USD')='CDF' THEN montant_usd ELSE 0 END),0) as cdf_natif_equiv_usd
     FROM recettes_diverses WHERE annee_scolaire=?`, [annee]
  );
  resume.total_encaisse = (parseFloat(resume.total_encaisse) || 0) + (parseFloat(recDiv.total) || 0);
  resume.total_encaisseParDevise = {
    usd: (parseFloat(resume.usd_natif) || 0) + (parseFloat(recDiv.usd_natif) || 0),
    cdf: (parseFloat(resume.cdf_natif) || 0) + (parseFloat(recDiv.cdf_natif) || 0),
    cdfEnUsd: (parseFloat(resume.cdf_natif_equiv_usd) || 0) + (parseFloat(recDiv.cdf_natif_equiv_usd) || 0),
  };
  delete resume.usd_natif; delete resume.cdf_natif; delete resume.cdf_natif_equiv_usd;
  const [paiements] = await db.query(
    `SELECT p.id, p.reference, p.type_paiement, p.montant, p.devise, p.montant_usd, p.montant_local, p.taux_change, p.mode_paiement, p.statut, p.date_paiement,
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

  // remboursements n'a pas ses propres montant_local/taux_change (contrairement a paiements/
  // depenses/recettes_diverses) : on reprend le taux_change du PAIEMENT d'origine (deja
  // joint) pour deriver l'equivalent dans l'autre devise avec le taux historiquement
  // applicable, plutot que le taux courant qui pourrait avoir change depuis.
  const [remboursementsBruts] = await db.query(
    `SELECT r.id, r.reference_remboursement, r.montant, r.montant_usd, r.devise, r.motif, r.statut, r.date_remboursement,
            e.nom, e.prenom, e.matricule, p.reference as pay_ref, p.taux_change as source_taux_change, u.prenom as appr_prenom, u.nom as appr_nom
     FROM remboursements r
     JOIN paiements p ON p.id=r.paiement_id
     JOIN eleves e ON e.id=r.eleve_id
     LEFT JOIN utilisateurs u ON u.id=r.approuve_par
     WHERE p.annee_scolaire=?
     ORDER BY r.date_remboursement DESC`,
    [annee]
  );
  const remboursementsFormels = remboursementsBruts.map((r) => ({
    ...r,
    type: 'remboursement',
    montant_local: r.devise === 'CDF' ? parseFloat(r.montant) : parseFloat(r.montant) * (parseFloat(r.source_taux_change) || 1),
  }));

  // Les surplus de paiement (depassement du du, rendus ou non) sont un deuxieme mecanisme
  // de remboursement a part entiere -- voir remboursements.js GET / qui les fusionne deja
  // avec les demandes formelles pour la page "Remboursements". Sans cette fusion ici, une
  // annee ou tous les remboursements se sont faits via des surplus (aucune demande formelle)
  // afficherait "0 remboursement" en Historique alors que des surplus ont bien ete rendus.
  const [surplusBruts] = await db.query(
    `SELECT p.id as paiement_id, p.reference as pay_ref, p.montant_surplus, p.surplus_rembourse,
            p.date_paiement, p.taux_change,
            e.nom, e.prenom, e.matricule
     FROM paiements p JOIN eleves e ON e.id=p.eleve_id
     WHERE p.annee_scolaire=? AND p.montant_surplus>0
     ORDER BY p.date_paiement DESC`,
    [annee]
  );
  const surplus = surplusBruts.map((p) => ({
    id: `surplus-${p.paiement_id}`,
    type: 'surplus',
    paiement_id: p.paiement_id,
    reference_remboursement: `SURPLUS-${p.pay_ref}`,
    pay_ref: p.pay_ref,
    nom: p.nom, prenom: p.prenom, matricule: p.matricule,
    montant: p.montant_surplus,
    montant_usd: p.montant_surplus,
    montant_local: parseFloat(p.montant_surplus) * (parseFloat(p.taux_change) || 1),
    devise: 'USD',
    motif: `Surplus à rendre sur le paiement ${p.pay_ref}`,
    statut: p.surplus_rembourse ? 'rendu' : 'en_attente',
    date_remboursement: p.date_paiement,
  }));

  const remboursements = [...remboursementsFormels, ...surplus].sort((a, b) => new Date(b.date_remboursement) - new Date(a.date_remboursement));

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
