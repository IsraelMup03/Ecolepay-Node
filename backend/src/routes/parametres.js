const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const { requireAuth, requireAdmin, requirePermission } = require('../middleware/auth');
const { logActivite, getEcole } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth);

const LOGO_DIR = path.join(__dirname, '../../uploads/logos');
fs.mkdirSync(LOGO_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, LOGO_DIR),
    filename: (req, file, cb) => cb(null, `logo_${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Seules les images sont acceptees.'));
  },
});

// GET /api/parametres  (infos ecole + parametres systeme)
router.get('/', async (req, res) => {
  const ecole = await getEcole();
  const [rows] = await db.query('SELECT cle, valeur FROM parametres');
  const params = {};
  rows.forEach((r) => { params[r.cle] = r.valeur; });
  res.json({ ecole, params });
});

// PUT /api/parametres/ecole  (infos ecole, avec upload logo optionnel)
router.put('/ecole', requirePermission('parametres'), upload.single('logo'), async (req, res) => {
  const { nom, adresse, telephone, email, annee_scolaire, devise, devise_locale, slogan } = req.body;
  const fields = [nom, adresse || null, telephone || null, email || null, annee_scolaire || null, devise || 'USD', devise_locale || 'CDF', slogan || null];
  let sql = `UPDATE ecole SET nom=?, adresse=?, telephone=?, email=?, annee_scolaire=?, devise=?, devise_locale=?, slogan=?`;
  if (req.file) {
    sql += ', logo=?';
    fields.push(req.file.filename);
  }
  const [[ecoleRow]] = await db.query('SELECT id FROM ecole LIMIT 1');
  sql += ' WHERE id=?';
  fields.push(ecoleRow.id);
  await db.query(sql, fields);
  await logActivite(req.user.id, "Parametres ecole modifies", null, req.ip);
  res.json({ success: true, ecole: await getEcole() });
});

// PUT /api/parametres/systeme
router.put('/systeme', requirePermission('parametres'), async (req, res) => {
  const { taux_usd_cdf, delai_corbeille, mois_debut_annee, format_matricule, promotion_automatique } = req.body;
  const updates = { taux_usd_cdf, delai_corbeille, mois_debut_annee, format_matricule, promotion_automatique };
  for (const [cle, valeur] of Object.entries(updates)) {
    if (valeur !== undefined) {
      await db.query('UPDATE parametres SET valeur=? WHERE cle=?', [String(valeur), cle]);
    }
  }
  await logActivite(req.user.id, 'Parametres systeme modifies', null, req.ip);
  res.json({ success: true });
});

// POST /api/parametres/reinitialiser  (danger zone : supprime eleves/classes/paiements)
router.post('/reinitialiser', requireAdmin, async (req, res) => {
  const { confirmation } = req.body;
  if (confirmation !== 'CONFIRMER') {
    return res.status(400).json({ error: 'Confirmation invalide. Tapez exactement CONFIRMER.' });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    await conn.query('TRUNCATE TABLE remboursements');
    await conn.query('TRUNCATE TABLE paiements');
    await conn.query('TRUNCATE TABLE archives_annuelles');
    await conn.query('TRUNCATE TABLE eleves');
    await conn.query('TRUNCATE TABLE classes');
    await conn.query('TRUNCATE TABLE corbeille');
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
    await conn.commit();
    await logActivite(req.user.id, 'Application reinitialisee', 'Suppression definitive: eleves, classes, paiements', req.ip);
    res.json({ success: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
