const express = require('express');
const db = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivite, envoyerCorbeille, getEcole, getParam } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth);

// GET /api/classes?all=&annee=  (annee: consulter une annee archivee)
router.get('/', async (req, res) => {
  const { all, annee } = req.query;

  if (annee) {
    const anneeCourante = await getParam('annee_scolaire_courante');
    if (annee !== anneeCourante) {
      // Les classes ne sont pas versionnees par annee : on derive la liste "de cette
      // annee-la" des elleves qui y etaient archives, pour rester coherent avec le
      // Dashboard/Historique qui comptent les classes de la meme facon.
      const [rows] = await db.query(
        `SELECT c.id, c.nom, c.devise, c.ordre, c.frais_scolarite, c.frais_inscription, c.effectif_max, c.classe_superieure_id,
                COUNT(a.id) as nb_eleves_annee
         FROM archives_annuelles a
         JOIN classes c ON c.id = a.classe_id
         WHERE a.annee_scolaire = ?
         GROUP BY c.id
         ORDER BY c.ordre ASC, c.nom ASC`,
        [annee]
      );
      return res.json(rows.map((r) => ({ ...r, archive: true })));
    }
    // Annee courante non encore archivee -> la liste live ci-dessous est deja correcte.
  }

  const where = all ? '' : 'WHERE actif=1';
  const [rows] = await db.query(`SELECT * FROM classes ${where} ORDER BY ordre ASC, nom ASC`);
  res.json(rows);
});

// GET /api/classes/:id/stats -> effectif + recouvrement pour une classe
router.get('/:id/stats', async (req, res) => {
  const { id } = req.params;
  const [[cls]] = await db.query('SELECT * FROM classes WHERE id=?', [id]);
  if (!cls) return res.status(404).json({ error: 'Classe introuvable.' });
  const [[stats]] = await db.query(
    `SELECT COUNT(*) as nb_eleves,
            COALESCE(SUM(frais_scolarite_total),0) as total_attendu,
            COALESCE(SUM((SELECT COALESCE(SUM(p.montant_usd),0) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide')),0) as total_paye
     FROM eleves e WHERE e.classe_id=? AND e.statut='actif'`,
    [id]
  );
  res.json({ classe: cls, stats });
});

// POST /api/classes  { action: 'creer' | ... }
router.post('/', requirePermission('classes'), async (req, res) => {
  const { nom, frais_scolarite, frais_inscription, classe_superieure_id, classe_inferieure_id, effectif_max, niveau_id, ordre } = req.body;
  if (!nom) return res.status(400).json({ error: 'Nom de classe requis.' });

  const ecole = await getEcole();
  const annee = await getParam('annee_scolaire_courante');

  const [result] = await db.query(
    `INSERT INTO classes (nom, niveau_id, classe_superieure_id, classe_inferieure_id, frais_inscription, frais_scolarite, devise, effectif_max, ordre, annee_scolaire)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      nom,
      niveau_id || null,
      classe_superieure_id || null,
      classe_inferieure_id || null,
      parseFloat(frais_inscription) || 0,
      parseFloat(frais_scolarite) || 0,
      ecole?.devise || 'USD',
      parseInt(effectif_max, 10) || 50,
      parseInt(ordre, 10) || 0,
      annee,
    ]
  );
  await logActivite(req.user.id, 'Classe creee', `Nom: ${nom}`, req.ip);
  const [[created]] = await db.query('SELECT * FROM classes WHERE id=?', [result.insertId]);
  res.status(201).json(created);
});

// PUT /api/classes/:id
router.put('/:id', requirePermission('classes'), async (req, res) => {
  const { id } = req.params;
  const { nom, frais_scolarite, frais_inscription, classe_superieure_id, classe_inferieure_id, effectif_max, niveau_id, ordre, actif } = req.body;

  await db.query(
    `UPDATE classes SET nom=?, frais_scolarite=?, frais_inscription=?, classe_superieure_id=?, classe_inferieure_id=?, effectif_max=?, niveau_id=?, ordre=?, actif=?
     WHERE id=?`,
    [
      nom,
      parseFloat(frais_scolarite) || 0,
      parseFloat(frais_inscription) || 0,
      classe_superieure_id || null,
      classe_inferieure_id || null,
      parseInt(effectif_max, 10) || 50,
      niveau_id || null,
      parseInt(ordre, 10) || 0,
      actif === undefined ? 1 : (actif ? 1 : 0),
      id,
    ]
  );
  // Repercute le nouveau montant sur les eleves actuellement actifs dans cette classe
  // (les eleves.frais_scolarite_total/frais_inscription_total sont une copie prise a
  // l'inscription/promotion, pas une reference live vers la classe). On ne touche pas
  // aux annees archivees : leur situation financiere passee doit rester figee.
  await db.query(
    `UPDATE eleves SET frais_scolarite_total=?, frais_inscription_total=? WHERE classe_id=? AND statut='actif'`,
    [parseFloat(frais_scolarite) || 0, parseFloat(frais_inscription) || 0, id]
  );

  await logActivite(req.user.id, 'Classe modifiee', `ID:${id}`, req.ip);
  const [[updated]] = await db.query('SELECT * FROM classes WHERE id=?', [id]);
  res.json(updated);
});

// DELETE /api/classes/:id (archivage -> corbeille, soft delete)
router.delete('/:id', requirePermission('classes'), async (req, res) => {
  const { id } = req.params;
  const [[data]] = await db.query('SELECT * FROM classes WHERE id=?', [id]);
  if (!data) return res.status(404).json({ error: 'Classe introuvable.' });

  const [[{ nb }]] = await db.query("SELECT COUNT(*) as nb FROM eleves WHERE classe_id=? AND statut='actif'", [id]);
  if (nb > 0) {
    return res.status(400).json({ error: `Impossible d'archiver: ${nb} eleve(s) actif(s) dans cette classe.` });
  }

  await envoyerCorbeille('classes', data, req.user.id);
  await db.query('UPDATE classes SET actif=0 WHERE id=?', [id]);
  await logActivite(req.user.id, 'Classe archivee', `ID:${id}`, req.ip);
  res.json({ success: true });
});

module.exports = router;
