const express = require('express');
const db = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { genererReferenceRemboursement, logActivite } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth);

// GET /api/remboursements
router.get('/', async (req, res) => {
  const [rows] = await db.query(
    `SELECT r.*, p.reference as pay_ref, p.montant as pay_montant, p.devise as pay_devise,
            e.nom, e.prenom, e.matricule, c.nom as classe,
            u.prenom as approv_prenom, u.nom as approv_nom
     FROM remboursements r
     JOIN paiements p ON p.id=r.paiement_id
     JOIN eleves e ON e.id=r.eleve_id
     JOIN classes c ON c.id=e.classe_id
     LEFT JOIN utilisateurs u ON u.id=r.approuve_par
     ORDER BY r.date_remboursement DESC`
  );
  res.json(rows);
});

// POST /api/remboursements  (demande)
router.post('/', requirePermission('remboursements'), async (req, res) => {
  const { paiement_id, motif } = req.body;
  if (!paiement_id || !motif) {
    return res.status(400).json({ error: 'Paiement et motif requis.' });
  }
  const [[pay]] = await db.query("SELECT * FROM paiements WHERE id=? AND statut='valide'", [paiement_id]);
  if (!pay) return res.status(400).json({ error: 'Paiement introuvable ou deja traite.' });

  const ref = genererReferenceRemboursement();
  const [result] = await db.query(
    `INSERT INTO remboursements (paiement_id, eleve_id, montant, devise, motif, reference_remboursement, approuve_par, statut)
     VALUES (?,?,?,?,?,?,?, 'en_attente')`,
    [paiement_id, pay.eleve_id, pay.montant, pay.devise, motif, ref, req.user.id]
  );
  await logActivite(req.user.id, 'Remboursement demande', `Paiement ID: ${paiement_id}`, req.ip);
  res.status(201).json({ id: result.insertId, reference: ref });
});

// POST /api/remboursements/:id/approuver  (admin uniquement)
router.post('/:id/approuver', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Reserve aux administrateurs.' });
  const { id } = req.params;
  const [[r]] = await db.query('SELECT * FROM remboursements WHERE id=?', [id]);
  if (!r) return res.status(404).json({ error: 'Remboursement introuvable.' });

  await db.query("UPDATE remboursements SET statut='approuve', approuve_par=? WHERE id=?", [req.user.id, id]);
  await db.query("UPDATE paiements SET statut='rembourse', motif_remboursement=? WHERE id=?", [r.motif, r.paiement_id]);
  await logActivite(req.user.id, 'Remboursement approuve', `ID: ${id}`, req.ip);
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
