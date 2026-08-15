const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const { requireAuth, requireAdmin, requirePermission } = require('../middleware/auth');
const { logActivite, getEcole } = require('../utils/helpers');

const router = express.Router();

// Route publique: exposer des infos basiques de l'école (logo, nom, contact)
router.get('/ecole-public', async (req, res) => {
  const ecole = await getEcole();
  res.json({ ecole });
});

router.use(requireAuth);

const LOGO_DIR = path.join(__dirname, '../../uploads/logos');
fs.mkdirSync(LOGO_DIR, { recursive: true });

// Allowlist stricte (pas de SVG : risque XSS via <script> embarque) et extension
// deduite du mimetype detecte par multer, jamais du nom de fichier fourni par le
// client (qui pourrait sinon deguiser un .php en image pour un serveur Apache/XAMPP
// colocalise sur le meme dossier htdocs).
const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, LOGO_DIR),
    filename: (req, file, cb) => cb(null, `logo_${Date.now()}${MIME_EXT[file.mimetype] || ''}`),
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (MIME_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('Seules les images PNG, JPEG, GIF ou WEBP sont acceptees.'));
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

// POST /api/parametres/reinitialiser  (danger zone : remet le logiciel a l'etat d'un
// tout premier lancement, avant toute configuration. Tout est supprime : eleves, classes,
// paiements, remboursements, depenses, historique, corbeille, journal d'activite, et tous
// les comptes utilisateurs SAUF celui qui declenche la reinitialisation (sinon plus personne
// ne pourrait se reconnecter). Le profil de l'ecole (nom/logo/adresse/devise/taux) et les
// parametres systeme sont aussi remis a leurs valeurs par defaut.
router.post('/reinitialiser', requireAdmin, async (req, res) => {
  const { confirmation } = req.body;
  if (confirmation !== 'CONFIRMER') {
    return res.status(400).json({ error: 'Confirmation invalide. Tapez exactement CONFIRMER.' });
  }
  const conn = await db.getConnection();
  try {
    // Annee scolaire "fraiche" calculee a partir de la date reelle du jour (pas une valeur
    // figee) : un logiciel remis a neuf doit demarrer sur l'annee scolaire en cours reelle.
    const now = new Date();
    const debutAnnee = (now.getMonth() + 1) >= 9 ? now.getFullYear() : now.getFullYear() - 1;
    const anneeFraiche = `${debutAnnee}-${debutAnnee + 1}`;

    const [[ecoleRow]] = await conn.query('SELECT id, logo FROM ecole LIMIT 1');

    await conn.beginTransaction();
    await conn.query('DELETE FROM remboursements');
    await conn.query('DELETE FROM paiements');
    await conn.query('DELETE FROM archives_annuelles');
    await conn.query('DELETE FROM depenses');
    await conn.query('DELETE FROM corbeille');
    await conn.query('DELETE FROM logs_activite');
    await conn.query('DELETE FROM eleves');
    await conn.query('DELETE FROM classes');
    await conn.query('DELETE FROM utilisateurs WHERE id != ?', [req.user.id]);

    if (ecoleRow) {
      await conn.query(
        `UPDATE ecole SET nom='', adresse=NULL, telephone=NULL, email=NULL, devise='USD', devise_locale='CDF',
                logo=NULL, slogan=NULL, annee_scolaire=?, sceau=NULL WHERE id=?`,
        [anneeFraiche, ecoleRow.id]
      );
    }
    const parametresDefaut = {
      annee_scolaire_courante: anneeFraiche,
      mois_debut_annee: '9',
      promotion_automatique: '1',
      delai_corbeille: '30',
      format_matricule: 'EP-{ANNEE}-{NUM}',
      compteur_matricule: '1',
      taux_usd_cdf: '2800',
      rappel_paiement: '1',
    };
    for (const [cle, valeur] of Object.entries(parametresDefaut)) {
      await conn.query('UPDATE parametres SET valeur=? WHERE cle=?', [valeur, cle]);
    }

    await conn.commit();

    // Supprime le fichier logo uploade (le champ en base vient d'etre vide) : sinon le
    // fichier reste orphelin sur le disque indefiniment.
    if (ecoleRow?.logo) {
      const logoPath = path.join(LOGO_DIR, ecoleRow.logo);
      fs.unlink(logoPath, () => {});
    }

    await logActivite(req.user.id, 'Application reinitialisee', 'Remise a neuf complete : donnees, comptes, profil ecole et parametres', req.ip);
    res.json({ success: true, anneeFraiche });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
