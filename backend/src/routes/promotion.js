const express = require('express');
const db = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivite, getParam } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth);

// GET /api/promotion/preview
router.get('/preview', requirePermission('promotion'), async (req, res) => {
  const [rows] = await db.query(
    `SELECT e.id, e.nom, e.prenom, e.statut, e.frais_scolarite_total,
            c.nom as classe_actuelle, cs.nom as classe_suivante, cs.id as classe_suivante_id,
            cs.frais_scolarite as nouveaux_frais, cs.frais_inscription as nouvelle_inscription,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye
     FROM eleves e
     JOIN classes c ON c.id=e.classe_id
     LEFT JOIN classes cs ON cs.id=c.classe_superieure_id
     WHERE e.statut='actif'
     ORDER BY c.ordre ASC, e.nom ASC`
  );
  const anneeCourante = await getParam('annee_scolaire_courante');
  res.json({ eleves: rows, anneeCourante });
});

// POST /api/promotion/executer  { nouvelle_annee }
router.post('/executer', requirePermission('promotion'), async (req, res) => {
  const { nouvelle_annee } = req.body;
  if (!nouvelle_annee) return res.status(400).json({ error: 'Saisissez la nouvelle annee scolaire.' });

  const annee = await getParam('annee_scolaire_courante');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Archiver la situation financiere de l'annee qui se termine
    const [elevesActifs] = await conn.query(
      `SELECT e.id, e.classe_id, e.frais_scolarite_total,
              COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.annee_scolaire=?),0) as total_paye
       FROM eleves e WHERE e.statut='actif'`,
      [annee]
    );
    for (const ea of elevesActifs) {
      const statutPay = ea.total_paye >= ea.frais_scolarite_total ? 'solde' : (ea.total_paye > 0 ? 'partiel' : 'non_paye');
      const [[existante]] = await conn.query(
        'SELECT id FROM archives_annuelles WHERE annee_scolaire=? AND eleve_id=?',
        [annee, ea.id]
      );
      if (existante) {
        await conn.query(
          'UPDATE archives_annuelles SET classe_id=?, frais_scolarite_total=?, total_paye=?, statut_paiement=? WHERE id=?',
          [ea.classe_id, ea.frais_scolarite_total, ea.total_paye, statutPay, existante.id]
        );
      } else {
        await conn.query(
          `INSERT INTO archives_annuelles (annee_scolaire, eleve_id, classe_id, frais_scolarite_total, total_paye, statut_paiement)
           VALUES (?,?,?,?,?,?)`,
          [annee, ea.id, ea.classe_id, ea.frais_scolarite_total, ea.total_paye, statutPay]
        );
      }
    }

    // 2. Promouvoir les eleves actifs ayant une classe superieure
    const [elevesProm] = await conn.query(
      `SELECT e.id, c.classe_superieure_id, cs.frais_scolarite as new_frais_s, cs.frais_inscription as new_frais_i
       FROM eleves e
       JOIN classes c ON c.id=e.classe_id
       JOIN classes cs ON cs.id=c.classe_superieure_id
       WHERE e.statut='actif' AND c.classe_superieure_id IS NOT NULL`
    );
    let nbPromus = 0;
    for (const ep of elevesProm) {
      await conn.query(
        `UPDATE eleves SET classe_id=?, statut='actif', annee_scolaire=?, frais_scolarite_total=?, frais_inscription_total=? WHERE id=?`,
        [ep.classe_superieure_id, nouvelle_annee, ep.new_frais_s, ep.new_frais_i, ep.id]
      );
      nbPromus++;
    }

    // 3. Eleves en classe terminale (pas de classe superieure) -> diplomes
    const [diplomesResult] = await conn.query(
      `UPDATE eleves SET statut='diplome', annee_scolaire=?
       WHERE statut='actif' AND classe_id IN (SELECT id FROM classes WHERE classe_superieure_id IS NULL)`,
      [nouvelle_annee]
    );
    const nbDiplomes = diplomesResult.affectedRows;

    // 4. Mettre a jour l'annee scolaire courante
    await conn.query("UPDATE parametres SET valeur=? WHERE cle='annee_scolaire_courante'", [nouvelle_annee]);
    await conn.query('UPDATE ecole SET annee_scolaire=?', [nouvelle_annee]);

    await conn.commit();
    await logActivite(req.user.id, 'Promotion annuelle', `Ancienne: ${annee} -> Nouvelle: ${nouvelle_annee} - ${nbPromus} promus`, req.ip);

    res.json({
      success: true,
      nbPromus,
      nbDiplomes,
      message: `${nbPromus} eleves promus, ${nbDiplomes} diplomes. Nouvelle annee: ${nouvelle_annee}. L'historique de l'annee ${annee} est conserve.`,
    });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: `Erreur lors de la promotion: ${e.message}` });
  } finally {
    conn.release();
  }
});

module.exports = router;
