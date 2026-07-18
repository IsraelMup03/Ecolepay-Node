const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { logActivite } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth);

// GET /api/profil
router.get('/', async (req, res) => {
  const [[user]] = await db.query('SELECT * FROM utilisateurs WHERE id=?', [req.user.id]);
  delete user.mot_de_passe;
  const [[{ nb }]] = await db.query("SELECT COUNT(*) as nb FROM paiements WHERE comptable_id=? AND statut='valide'", [req.user.id]);
  res.json({ user, nbPaiements: nb });
});

// PUT /api/profil
router.put('/', async (req, res) => {
  const { nom, prenom, telephone } = req.body;
  await db.query('UPDATE utilisateurs SET nom=?, prenom=?, telephone=? WHERE id=?', [nom, prenom, telephone || null, req.user.id]);
  await logActivite(req.user.id, 'Profil mis a jour', null, req.ip);
  res.json({ success: true });
});

module.exports = router;
