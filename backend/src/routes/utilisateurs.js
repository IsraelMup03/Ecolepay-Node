const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActivite, envoyerCorbeille } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth, requireAdmin); // gestion des utilisateurs = admin uniquement

const DEFAULT_PASSWORD = 'EcoleUser@2024';

const PERMISSIONS_DISPONIBLES = {
  paiements: 'Enregistrer des paiements',
  eleves: 'Gerer les eleves',
  classes: 'Gerer les classes',
  rapports: 'Voir les rapports',
  remboursements: 'Gerer les remboursements',
  promotion: "Lancer la promotion annuelle",
  parametres: 'Modifier les parametres',
  corbeille: 'Acceder a la corbeille',
  historique: "Voir l'historique des annees",
  comptabilite: "Gerer la comptabilite (recettes, depenses, rapports financiers)",
};

// GET /api/utilisateurs
router.get('/', async (req, res) => {
  const [rows] = await db.query(
    'SELECT id, nom, prenom, email, role, permissions, telephone, actif, premier_connexion, derniere_connexion, date_creation FROM utilisateurs ORDER BY date_creation DESC'
  );
  res.json({ users: rows, permissionsDisponibles: PERMISSIONS_DISPONIBLES, defaultPassword: DEFAULT_PASSWORD });
});

// POST /api/utilisateurs (ajouter)
router.post('/', async (req, res) => {
  const { nom, prenom, email, role, telephone, permissions = [] } = req.body;
  if (!nom || !prenom || !email || !role) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }
  const [[exist]] = await db.query('SELECT id FROM utilisateurs WHERE email=?', [email]);
  if (exist) return res.status(400).json({ error: 'Cet email existe deja.' });

  const perms = {};
  permissions.forEach((k) => { perms[k] = true; });
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  const [result] = await db.query(
    `INSERT INTO utilisateurs (nom, prenom, email, mot_de_passe, role, permissions, telephone, actif, premier_connexion, created_by)
     VALUES (?,?,?,?,?,?,?,1,1,?)`,
    [nom, prenom, email, hash, role, JSON.stringify(perms), telephone || null, req.user.id]
  );
  await logActivite(req.user.id, 'Utilisateur cree', `Email:${email}`, req.ip);
  res.status(201).json({ id: result.insertId, defaultPassword: DEFAULT_PASSWORD });
});

// PUT /api/utilisateurs/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { nom, prenom, role, telephone, permissions = [], actif } = req.body;
  const perms = {};
  permissions.forEach((k) => { perms[k] = true; });

  await db.query(
    `UPDATE utilisateurs SET nom=?, prenom=?, role=?, telephone=?, permissions=?, actif=? WHERE id=?`,
    [nom, prenom, role, telephone || null, JSON.stringify(perms), actif === undefined ? 1 : (actif ? 1 : 0), id]
  );
  await logActivite(req.user.id, 'Utilisateur modifie', `ID:${id}`, req.ip);
  res.json({ success: true });
});

// POST /api/utilisateurs/:id/reinitialiser-mdp
router.post('/:id/reinitialiser-mdp', async (req, res) => {
  const { id } = req.params;
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  await db.query('UPDATE utilisateurs SET mot_de_passe=?, premier_connexion=1 WHERE id=?', [hash, id]);
  await logActivite(req.user.id, 'Mot de passe reinitialise', `ID:${id}`, req.ip);
  res.json({ success: true, defaultPassword: DEFAULT_PASSWORD });
});

// DELETE /api/utilisateurs/:id (desactivation + corbeille)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (parseInt(id, 10) === req.user.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
  }
  const [[data]] = await db.query('SELECT * FROM utilisateurs WHERE id=?', [id]);
  if (!data) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  delete data.mot_de_passe;
  await envoyerCorbeille('utilisateurs', data, req.user.id);
  await db.query('UPDATE utilisateurs SET actif=0 WHERE id=?', [id]);
  await logActivite(req.user.id, 'Utilisateur desactive', `ID:${id}`, req.ip);
  res.json({ success: true });
});

module.exports = router;
