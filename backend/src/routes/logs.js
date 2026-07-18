const express = require('express');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// GET /api/logs?p=&q=
router.get('/', async (req, res) => {
  const { p = 1, q } = req.query;
  const page = Math.max(1, parseInt(p, 10));
  const perPage = 30;
  const offset = (page - 1) * perPage;

  let where = '1=1';
  const params = [];
  if (q) { where += ' AND (l.action LIKE ? OR l.details LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }

  const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM logs_activite l WHERE ${where}`, params);
  const [rows] = await db.query(
    `SELECT l.*, u.prenom, u.nom, u.role
     FROM logs_activite l LEFT JOIN utilisateurs u ON u.id=l.utilisateur_id
     WHERE ${where} ORDER BY l.date_action DESC LIMIT ${perPage} OFFSET ${offset}`,
    params
  );

  res.json({ logs: rows, total, page, totalPages: Math.ceil(total / perPage) });
});

module.exports = router;
