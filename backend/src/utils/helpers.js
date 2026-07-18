const db = require('../config/db');

/**
 * Genere un matricule unique du type EP-2026-0001, en incrementant le
 * compteur stocke dans les parametres (equivalent de genererMatricule()).
 */
async function genererMatricule(annee) {
  const year = annee || new Date().getFullYear();
  const [rows] = await db.query("SELECT valeur FROM parametres WHERE cle = 'compteur_matricule'");
  const num = parseInt((rows[0] && rows[0].valeur) || '1', 10);
  await db.query("UPDATE parametres SET valeur = ? WHERE cle = 'compteur_matricule'", [num + 1]);
  return `EP-${year}-${String(num).padStart(4, '0')}`;
}

/**
 * Genere une reference de paiement unique (equivalent de genererReferencePaiement()).
 */
function genererReferencePaiement() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(-6).toUpperCase();
  return `PAY-${y}${m}${d}-${rand}`;
}

function genererReferenceRemboursement() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(-5).toUpperCase();
  return `RMB-${y}${m}${d}-${rand}`;
}

/**
 * Enregistre une action dans le journal d'activite (equivalent de logActivite()).
 */
async function logActivite(userId, action, details, ip) {
  try {
    await db.query(
      'INSERT INTO logs_activite (utilisateur_id, action, details, ip) VALUES (?,?,?,?)',
      [userId || null, action, details || null, ip || null]
    );
  } catch (e) {
    // Ne bloque jamais le flux principal si le log echoue
    console.error('logActivite error:', e.message);
  }
}

/**
 * Envoie un enregistrement supprime vers la corbeille (soft-delete), avec
 * une expiration configurable (equivalent de envoyerCorbeille()).
 */
async function envoyerCorbeille(table, data, userId) {
  const delaiJours = parseInt(await getParam('delai_corbeille', '30'), 10);
  const exp = new Date(Date.now() + delaiJours * 24 * 60 * 60 * 1000);
  await db.query(
    'INSERT INTO corbeille (table_source, donnees, supprime_par, date_expiration) VALUES (?,?,?,?)',
    [table, JSON.stringify(data), userId || null, exp]
  );
}

async function getEcole() {
  const [rows] = await db.query('SELECT * FROM ecole LIMIT 1');
  return rows[0] || null;
}

async function getParam(cle, defaut = null) {
  const [rows] = await db.query('SELECT valeur FROM parametres WHERE cle = ?', [cle]);
  return rows.length ? rows[0].valeur : defaut;
}

async function setParam(cle, valeur) {
  await db.query(
    'INSERT INTO parametres (cle, valeur) VALUES (?, ?) ON DUPLICATE KEY UPDATE valeur = VALUES(valeur)',
    [cle, valeur]
  );
}

/**
 * Convertit un montant vers la devise principale ou locale selon le taux
 * (equivalent de convertirVersDevise()).
 */
function convertirVersDevise(montant, deviseSrc, deviseDst, taux) {
  const m = parseFloat(montant) || 0;
  const t = parseFloat(taux) || 1;
  if (deviseSrc === deviseDst) return m;
  if (deviseSrc === 'USD') return m * t; // USD -> CDF
  if (deviseSrc === 'CDF' && t > 0) return m / t; // CDF -> USD
  return m;
}

/**
 * Verifie les permissions d'un utilisateur (equivalent de hasPermission()).
 * - admin => tout
 * - autres => doit avoir la permission explicite, ou permissions={"tout":true}
 */
function hasPermission(user, perm) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  let perms = {};
  try {
    perms = typeof user.permissions === 'string' ? JSON.parse(user.permissions || '{}') : (user.permissions || {});
  } catch (e) {
    perms = {};
  }
  if (perms.tout) return true;
  return !!perms[perm];
}

module.exports = {
  genererMatricule,
  genererReferencePaiement,
  genererReferenceRemboursement,
  logActivite,
  envoyerCorbeille,
  getEcole,
  getParam,
  setParam,
  convertirVersDevise,
  hasPermission,
};
