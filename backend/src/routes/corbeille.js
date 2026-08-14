const express = require('express');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActivite } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// GET /api/corbeille
router.get('/', async (req, res) => {
  await db.query('DELETE FROM corbeille WHERE date_expiration < NOW() AND restaure=0');
  const [rows] = await db.query(
    `SELECT cb.*, u.prenom as supp_prenom, u.nom as supp_nom
     FROM corbeille cb LEFT JOIN utilisateurs u ON u.id=cb.supprime_par
     WHERE cb.restaure=0 AND cb.date_expiration > NOW()
     ORDER BY cb.date_suppression DESC`
  );
  res.json(rows);
});

// POST /api/corbeille/:id/restaurer
router.post('/:id/restaurer', async (req, res) => {
  const { id } = req.params;
  const [[item]] = await db.query('SELECT * FROM corbeille WHERE id=?', [id]);
  if (!item) return res.status(404).json({ error: 'Element introuvable.' });

  const data = JSON.parse(item.donnees);

  if (item.table_source === 'eleves') {
    // La suppression d'un eleve est un soft-delete (statut='transfere'), la ligne
    // n'a jamais quitte la table : il faut donc remettre le statut, pas re-inserer
    // (une re-insertion entrerait en collision avec le matricule, deja pris par la
    // ligne existante, et ferait planter tout le serveur via une exception non geree).
    await db.query("UPDATE eleves SET statut='actif' WHERE id=?", [data.id]);
    await db.query('UPDATE corbeille SET restaure=1 WHERE id=?', [id]);
    await logActivite(req.user.id, 'Eleve restaure', `Corbeille ID:${id}`, req.ip);
    return res.json({ success: true, message: 'Eleve restaure avec succes.' });
  }

  if (item.table_source === 'classes') {
    await db.query('UPDATE classes SET actif=1 WHERE id=?', [data.id]);
    await db.query('UPDATE corbeille SET restaure=1 WHERE id=?', [id]);
    await logActivite(req.user.id, 'Classe restauree', `Corbeille ID:${id}`, req.ip);
    return res.json({ success: true, message: 'Classe restauree.' });
  }

  if (item.table_source === 'utilisateurs') {
    await db.query('UPDATE utilisateurs SET actif=1 WHERE id=?', [data.id]);
    await db.query('UPDATE corbeille SET restaure=1 WHERE id=?', [id]);
    await logActivite(req.user.id, 'Utilisateur restaure', `Corbeille ID:${id}`, req.ip);
    return res.json({ success: true, message: 'Utilisateur restaure.' });
  }

  if (item.table_source === 'depenses') {
    // Contrairement aux autres types, la suppression d'une depense est un vrai DELETE (pas
    // de statut a restaurer) : on reinsere la ligne telle quelle depuis le snapshot JSON.
    // Sans risque de collision de cle (id AUTOINCREMENT, jamais reutilise apres suppression).
    const cols = Object.keys(data);
    const placeholders = cols.map(() => '?').join(',');
    await db.query(`INSERT INTO depenses (${cols.join(',')}) VALUES (${placeholders})`, Object.values(data));
    await db.query('UPDATE corbeille SET restaure=1 WHERE id=?', [id]);
    await logActivite(req.user.id, 'Depense restauree', `Corbeille ID:${id}`, req.ip);
    return res.json({ success: true, message: 'Dépense restaurée.' });
  }

  res.status(400).json({ error: 'Type de donnees inconnu.' });
});

// DELETE /api/corbeille/:id (suppression definitive)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  await db.query('DELETE FROM corbeille WHERE id=?', [id]);
  await logActivite(req.user.id, 'Suppression definitive corbeille', `ID:${id}`, req.ip);
  res.json({ success: true });
});

module.exports = router;
