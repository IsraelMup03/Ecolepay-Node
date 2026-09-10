const express = require('express');
const db = require('../config/db');
const { requireAuth, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { logActivite, nomCompletConditions, envoyerCorbeille } = require('../utils/helpers');

const router = express.Router();

async function calculerTotalFamilleParClasse(classeId, remiseIndividuelle, reductionFamille) {
  const [[classe]] = await db.query('SELECT frais_scolarite FROM classes WHERE id=?', [classeId]);
  const base = parseFloat(classe?.frais_scolarite || 0) || 0;
  const [tranches] = await db.query('SELECT numero, montant FROM classe_tranches WHERE classe_id=? ORDER BY numero ASC', [classeId]);
  if (!tranches.length) {
    return base * (1 - (parseFloat(remiseIndividuelle) || 0) / 100);
  }

  let total = 0;
  const remiseIndiv = parseFloat(remiseIndividuelle) || 0;
  const reduction = parseFloat(reductionFamille) || 0;
  for (let i = 0; i < tranches.length; i++) {
    const montant = parseFloat(tranches[i].montant) || 0;
    const remiseTotale = (i === tranches.length - 1 && reduction > 0) ? Math.min(100, remiseIndiv + reduction) : remiseIndiv;
    total += montant * (1 - (remiseTotale / 100));
  }
  return total;
}

router.use(requireAuth);
router.use(requirePermission('eleves'));

router.get('/search', requireAnyPermission('paiements', 'eleves'), async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const { sql: nomSql, count: nomCount } = nomCompletConditions('e');
  const [rows] = await db.query(
    `SELECT e.id, e.nom, e.postnom, e.prenom, e.matricule, e.genre, c.nom as classe,
            e.frais_scolarite_total,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye
     FROM eleves e JOIN classes c ON c.id=e.classe_id
     WHERE e.statut='actif' AND e.famille_id IS NULL AND (e.nom LIKE ? OR e.postnom LIKE ? OR e.prenom LIKE ? OR e.matricule LIKE ? OR ${nomSql})
     ORDER BY e.nom ASC, e.prenom ASC LIMIT 10`,
    [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, ...Array(nomCount).fill(`%${q}%`)]
  );
  res.json(rows.map((e) => ({ ...e, reste: Math.max(0, (parseFloat(e.frais_scolarite_total) || 0) - (parseFloat(e.total_paye) || 0)) })));
});

router.get('/', async (req, res) => {
  const [families] = await db.query('SELECT * FROM familles WHERE actif=1 ORDER BY nom ASC');
  if (!families.length) return res.json([]);

  const ids = families.map((f) => f.id);
  const placeholders = ids.map(() => '?').join(',');
  const [members] = await db.query(
    `SELECT e.id, e.nom, e.postnom, e.prenom, e.matricule, e.genre, e.famille_id, c.nom as classe_nom,
            e.frais_scolarite_total, e.remise_pourcentage,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye
     FROM eleves e LEFT JOIN classes c ON c.id=e.classe_id WHERE e.famille_id IN (${placeholders}) ORDER BY e.nom ASC, e.prenom ASC`,
    ids
  );

  const byFamily = new Map();
  for (const member of members) {
    if (!byFamily.has(member.famille_id)) byFamily.set(member.famille_id, []);
    byFamily.get(member.famille_id).push({
      ...member,
      reste: Math.max(0, (parseFloat(member.frais_scolarite_total) || 0) - (parseFloat(member.total_paye) || 0)),
    });
  }

  res.json(families.map((fam) => ({
    ...fam,
    pourcentage_reduction: parseFloat(fam.pourcentage_reduction) || 0,
    membres: byFamily.get(fam.id) || [],
  })));
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const [[famille]] = await db.query('SELECT * FROM familles WHERE id=? AND actif=1', [id]);
  if (!famille) return res.status(404).json({ error: 'Famille introuvable.' });

  const [membres] = await db.query(
    `SELECT e.*, c.nom as classe_nom,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye
     FROM eleves e LEFT JOIN classes c ON c.id=e.classe_id WHERE e.famille_id=? ORDER BY e.nom ASC, e.prenom ASC`,
    [id]
  );

  res.json({
    ...famille,
    pourcentage_reduction: parseFloat(famille.pourcentage_reduction) || 0,
    membres: membres.map((m) => ({
      ...m,
      reste: Math.max(0, (parseFloat(m.frais_scolarite_total) || 0) - (parseFloat(m.total_paye) || 0)),
    })),
  });
});

router.post('/', async (req, res) => {
  const { nom, pourcentage_reduction, eleve_ids } = req.body;
  if (!nom || !Array.isArray(eleve_ids) || eleve_ids.length === 0) {
    return res.status(400).json({ error: 'Nom et au moins un élève sont requis.' });
  }

  const reduction = Math.min(100, Math.max(0, parseFloat(pourcentage_reduction) || 0));
  const ids = [...new Set(eleve_ids.filter(Boolean).map((id) => Number(id)).filter((id) => !Number.isNaN(id)))];
  if (ids.length === 0) return res.status(400).json({ error: 'Aucun élève valide sélectionné.' });

  const placeholders = ids.map(() => '?').join(',');
  const [eleves] = await db.query(
    `SELECT e.id, e.classe_id, e.remise_pourcentage, e.famille_id FROM eleves e WHERE e.id IN (${placeholders}) AND e.statut='actif'`,
    ids
  );
  if (eleves.length !== ids.length) {
    return res.status(400).json({ error: 'Un ou plusieurs élèves sont introuvables ou inactifs.' });
  }
  if (eleves.some((e) => e.famille_id)) {
    return res.status(400).json({ error: 'Un ou plusieurs élèves appartiennent déjà à une famille.' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query('INSERT INTO familles (nom, pourcentage_reduction, created_by) VALUES (?,?,?)', [String(nom).trim(), reduction, req.user.id]);
    const familleId = result.insertId;

    for (const eleve of eleves) {
      const total = await calculerTotalFamilleParClasse(eleve.classe_id, eleve.remise_pourcentage, reduction);
      await conn.query('UPDATE eleves SET famille_id=?, frais_scolarite_total=? WHERE id=?', [familleId, total, eleve.id]);
    }

    await conn.commit();
    await logActivite(req.user.id, 'Famille creee', `Nom: ${String(nom).trim()} (${ids.length} eleves)`, req.ip);
    const [[created]] = await db.query('SELECT * FROM familles WHERE id=?', [familleId]);
    res.status(201).json({ ...created, pourcentage_reduction: parseFloat(created.pourcentage_reduction) || 0, eleve_ids: ids });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la creation de la famille.' });
  } finally {
    conn.release();
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { nom, pourcentage_reduction, eleve_ids } = req.body;
  if (!nom || !Array.isArray(eleve_ids) || eleve_ids.length === 0) return res.status(400).json({ error: 'Nom et au moins un élève sont requis.' });
  const reduction = Math.min(100, Math.max(0, parseFloat(pourcentage_reduction) || 0));
  const ids = [...new Set(eleve_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  const [[famille]] = await db.query('SELECT * FROM familles WHERE id=? AND actif=1', [id]);
  if (!famille || !ids.length) return res.status(404).json({ error: 'Famille introuvable ou membres invalides.' });
  const placeholders = ids.map(() => '?').join(',');
  const [eleves] = await db.query(`SELECT id, classe_id, remise_pourcentage, famille_id FROM eleves WHERE id IN (${placeholders}) AND statut='actif'`, ids);
  if (eleves.length !== ids.length || eleves.some((e) => e.famille_id && Number(e.famille_id) !== Number(id))) return res.status(400).json({ error: 'Un ou plusieurs élèves sont déjà rattachés à une autre famille ou inactifs.' });
  const [anciens] = await db.query('SELECT id, classe_id, remise_pourcentage FROM eleves WHERE famille_id=?', [id]);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE familles SET nom=?, pourcentage_reduction=? WHERE id=?', [String(nom).trim(), reduction, id]);
    for (const eleve of anciens) if (!ids.includes(Number(eleve.id))) {
      const total = await calculerTotalFamilleParClasse(eleve.classe_id, eleve.remise_pourcentage, 0);
      await conn.query('UPDATE eleves SET famille_id=NULL, frais_scolarite_total=? WHERE id=?', [total, eleve.id]);
    }
    for (const eleve of eleves) {
      const total = await calculerTotalFamilleParClasse(eleve.classe_id, eleve.remise_pourcentage, reduction);
      await conn.query('UPDATE eleves SET famille_id=?, frais_scolarite_total=? WHERE id=?', [id, total, eleve.id]);
    }
    await conn.commit();
    await logActivite(req.user.id, 'Famille modifiee', `ID:${id}`, req.ip);
    const [[updated]] = await db.query('SELECT * FROM familles WHERE id=?', [id]);
    res.json(updated);
  } catch (e) { await conn.rollback(); console.error(e); res.status(500).json({ error: 'Erreur lors de la modification de la famille.' }); } finally { conn.release(); }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const [[famille]] = await db.query('SELECT * FROM familles WHERE id=? AND actif=1', [id]);
  if (!famille) return res.status(404).json({ error: 'Famille introuvable.' });
  const [membres] = await db.query('SELECT id, classe_id, remise_pourcentage, frais_scolarite_total FROM eleves WHERE famille_id=?', [id]);
  await envoyerCorbeille('familles', { famille, membres }, req.user.id);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE familles SET actif=0 WHERE id=?', [id]);
    for (const eleve of membres) {
      const total = await calculerTotalFamilleParClasse(eleve.classe_id, eleve.remise_pourcentage, 0);
      await conn.query('UPDATE eleves SET famille_id=NULL, frais_scolarite_total=? WHERE id=?', [total, eleve.id]);
    }
    await conn.commit();
    await logActivite(req.user.id, 'Famille archivee', `ID:${id}`, req.ip);
    res.json({ success: true });
  } catch (e) { await conn.rollback(); console.error(e); res.status(500).json({ error: 'Erreur lors de l archivage de la famille.' }); }
  finally { conn.release(); }
});

module.exports = router;