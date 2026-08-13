const express = require('express');
const db = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { genererReferenceRemboursement, logActivite, getParam } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth);

// GET /api/remboursements?annee=  (par defaut: annee scolaire en cours)
router.get('/', async (req, res) => {
  const anneeFiltre = req.query.annee || await getParam('annee_scolaire_courante');
  const [rows] = await db.query(
    `SELECT r.*, p.reference as pay_ref, p.montant as pay_montant, p.devise as pay_devise, p.annee_scolaire,
            e.nom, e.prenom, e.matricule, c.nom as classe,
            u.prenom as approv_prenom, u.nom as approv_nom
     FROM remboursements r
     JOIN paiements p ON p.id=r.paiement_id
     JOIN eleves e ON e.id=r.eleve_id
     JOIN classes c ON c.id=e.classe_id
     LEFT JOIN utilisateurs u ON u.id=r.approuve_par
     WHERE p.annee_scolaire=?
     ORDER BY r.date_remboursement DESC`,
    [anneeFiltre]
  );
  res.json(rows);
});

// POST /api/remboursements  (demande) - { paiement_id, motif, montant? }
// montant est optionnel : par defaut, demande de remboursement total du paiement.
// S'il est fourni, doit etre compris entre 0 (exclu) et le montant actuel du paiement
// (qui peut deja avoir ete reduit par un remboursement partiel precedent).
router.post('/', requirePermission('remboursements'), async (req, res) => {
  const { paiement_id, motif, montant } = req.body;
  if (!paiement_id || !motif) {
    return res.status(400).json({ error: 'Paiement et motif requis.' });
  }
  const [[pay]] = await db.query("SELECT * FROM paiements WHERE id=? AND statut='valide'", [paiement_id]);
  if (!pay) return res.status(400).json({ error: 'Paiement introuvable ou deja traite.' });

  const montantDemande = (montant !== undefined && montant !== null && montant !== '') ? parseFloat(montant) : parseFloat(pay.montant);
  if (!(montantDemande > 0) || montantDemande > parseFloat(pay.montant) + 0.009) {
    return res.status(400).json({ error: `Le montant doit etre compris entre 0 et ${pay.montant} ${pay.devise} (montant actuel du paiement).` });
  }
  const montantUsd = pay.devise === 'USD' ? montantDemande : montantDemande / (parseFloat(pay.taux_change) || 1);

  const ref = genererReferenceRemboursement();
  const [result] = await db.query(
    `INSERT INTO remboursements (paiement_id, eleve_id, montant, montant_usd, devise, motif, reference_remboursement, approuve_par, statut)
     VALUES (?,?,?,?,?,?,?,?, 'en_attente')`,
    [paiement_id, pay.eleve_id, montantDemande, montantUsd, pay.devise, motif, ref, req.user.id]
  );
  await logActivite(req.user.id, 'Remboursement demande', `Paiement ID: ${paiement_id} - Montant: ${montantDemande} ${pay.devise}`, req.ip);
  res.status(201).json({ id: result.insertId, reference: ref });
});

// POST /api/remboursements/:id/approuver  (admin uniquement)
router.post('/:id/approuver', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Reserve aux administrateurs.' });
  const { id } = req.params;
  const [[r]] = await db.query('SELECT * FROM remboursements WHERE id=?', [id]);
  if (!r) return res.status(404).json({ error: 'Remboursement introuvable.' });
  const [[pay]] = await db.query('SELECT * FROM paiements WHERE id=?', [r.paiement_id]);
  if (!pay) return res.status(404).json({ error: 'Paiement associe introuvable.' });

  if (parseFloat(r.montant) > parseFloat(pay.montant) + 0.009) {
    return res.status(400).json({
      error: `Solde du paiement insuffisant : il reste ${pay.montant} ${pay.devise} sur ce paiement (un autre remboursement a peut-etre deja ete approuve entre-temps). Rejetez ou ajustez cette demande.`,
    });
  }

  const montantRestant = Math.round((parseFloat(pay.montant) - parseFloat(r.montant)) * 100) / 100;
  if (montantRestant <= 0) {
    // Remboursement total : le paiement est exclu de tous les calculs, comme avant.
    await db.query("UPDATE paiements SET statut='rembourse', motif_remboursement=? WHERE id=?", [r.motif, r.paiement_id]);
  } else {
    // Remboursement partiel : le paiement reste valide mais son montant net diminue de la
    // somme remboursee (paye 250, rembourse 50 -> le paiement vaut desormais 200). Tous les
    // calculs de total_paye/reste de l'application lisent ce montant, donc la coherence est
    // automatique sans avoir a modifier chaque requete SQL qui agrege les paiements.
    const nouveauMontantUsd = pay.devise === 'USD' ? montantRestant : montantRestant / (parseFloat(pay.taux_change) || 1);
    const nouveauMontantLocal = pay.devise === 'CDF' ? montantRestant : montantRestant * (parseFloat(pay.taux_change) || 1);
    await db.query(
      "UPDATE paiements SET montant=?, montant_usd=?, montant_local=?, motif_remboursement=? WHERE id=?",
      [montantRestant, nouveauMontantUsd, nouveauMontantLocal, r.motif, r.paiement_id]
    );
  }

  await db.query("UPDATE remboursements SET statut='approuve', approuve_par=? WHERE id=?", [req.user.id, id]);
  await logActivite(req.user.id, 'Remboursement approuve', `ID: ${id} - Montant: ${r.montant} ${r.devise}`, req.ip);
  res.json({ success: true });
});

// POST /api/remboursements/:id/rejeter
router.post('/:id/rejeter', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Reserve aux administrateurs.' });
  const { id } = req.params;
  await db.query("UPDATE remboursements SET statut='rejete' WHERE id=?", [id]);
  await logActivite(req.user.id, 'Remboursement rejete', `ID: ${id}`, req.ip);
  res.json({ success: true });
});

module.exports = router;
