const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { logActivite, getEcole } = require('../utils/helpers');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Veuillez remplir tous les champs.' });
  }

  const [rows] = await db.query('SELECT * FROM utilisateurs WHERE email = ?', [email]);
  const user = rows[0];

  if (!user) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
  }

  const validPassword = await bcrypt.compare(password, user.mot_de_passe);
  if (!validPassword) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
  }
  if (!user.actif) {
    return res.status(403).json({ error: "Ce compte a ete desactive. Contactez l'administrateur." });
  }

  await db.query('UPDATE utilisateurs SET derniere_connexion = NOW() WHERE id = ?', [user.id]);
  await logActivite(user.id, 'Connexion', 'Connexion reussie', req.ip);

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );

  const ecole = await getEcole();

  delete user.mot_de_passe;
  res.json({
    token,
    user,
    mustChangePassword: !!user.premier_connexion,
    ecole,
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/change-password
// Utilise a la fois pour le changement force de premiere connexion (sans
// verifier l'ancien mot de passe) et le changement volontaire depuis le profil.
router.post('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;

  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit avoir au moins 8 caracteres.' });
  }
  if (new_password !== confirm_password) {
    return res.status(400).json({ error: 'Les mots de passe ne correspondent pas.' });
  }

  const [rows] = await db.query('SELECT mot_de_passe, premier_connexion FROM utilisateurs WHERE id = ?', [req.user.id]);
  const user = rows[0];

  // Si ce n'est pas la premiere connexion, l'ancien mot de passe doit etre verifie
  if (!user.premier_connexion) {
    if (!current_password) {
      return res.status(400).json({ error: 'Mot de passe actuel requis.' });
    }
    const ok = await bcrypt.compare(current_password, user.mot_de_passe);
    if (!ok) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect.' });
    }
  }

  const hash = await bcrypt.hash(new_password, 10);
  await db.query('UPDATE utilisateurs SET mot_de_passe = ?, premier_connexion = 0 WHERE id = ?', [hash, req.user.id]);
  await logActivite(req.user.id, 'Mot de passe change', null, req.ip);

  res.json({ success: true });
});

module.exports = router;
