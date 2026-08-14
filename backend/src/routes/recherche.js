const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { nomCompletConditions } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth);

// GET /api/recherche?q=  (recherche globale : eleves, paiements, classes - toutes annees confondues)
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ eleves: [], paiements: [], classes: [] });
  const like = `%${q}%`;
  const { sql: nomSql, count: nomCount } = nomCompletConditions('e');

  const [eleves] = await db.query(
    `SELECT e.id, e.nom, e.postnom, e.prenom, e.matricule, e.genre, c.nom as classe_nom
     FROM eleves e LEFT JOIN classes c ON c.id=e.classe_id
     WHERE e.nom LIKE ? OR e.postnom LIKE ? OR e.prenom LIKE ? OR e.matricule LIKE ? OR ${nomSql}
     ORDER BY e.nom ASC LIMIT 8`,
    [like, like, like, like, ...Array(nomCount).fill(like)]
  );

  const [paiements] = await db.query(
    `SELECT p.id, p.reference, p.montant, p.devise, p.date_paiement, p.annee_scolaire,
            e.nom, e.prenom, e.matricule
     FROM paiements p JOIN eleves e ON e.id=p.eleve_id
     WHERE p.reference LIKE ?
     ORDER BY p.date_paiement DESC LIMIT 8`,
    [like]
  );

  const [classes] = await db.query(
    `SELECT id, nom, frais_scolarite, devise FROM classes WHERE nom LIKE ? ORDER BY nom ASC LIMIT 5`,
    [like]
  );

  res.json({ eleves, paiements, classes });
});

module.exports = router;
