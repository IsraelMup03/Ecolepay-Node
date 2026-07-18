const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { hasPermission } = require('../utils/helpers');

/**
 * Verifie le token JWT et charge l'utilisateur courant depuis la base
 * (equivalent de requireAuth() en PHP). Rejette si le compte est inactif.
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Non authentifie.' });

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Session expiree, veuillez vous reconnecter.' });
    }

    const [rows] = await db.query(
      'SELECT id, nom, prenom, email, role, permissions, actif, telephone, avatar, derniere_connexion, premier_connexion FROM utilisateurs WHERE id = ?',
      [payload.id]
    );
    const user = rows[0];
    if (!user || !user.actif) {
      return res.status(401).json({ error: 'Compte introuvable ou desactive.' });
    }
    req.user = user;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

/**
 * Restreint l'acces aux administrateurs uniquement.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acces reserve aux administrateurs.' });
  }
  next();
}

/**
 * Restreint l'acces selon la permission granulaire de l'utilisateur
 * (equivalent de hasPermission() applique en middleware).
 */
function requirePermission(perm) {
  return (req, res, next) => {
    if (!hasPermission(req.user, perm)) {
      return res.status(403).json({ error: `Permission "${perm}" requise.` });
    }
    next();
  };
}

module.exports = { requireAuth, requireAdmin, requirePermission };
