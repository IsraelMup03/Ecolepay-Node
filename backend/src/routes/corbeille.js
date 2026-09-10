const express = require('express');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActivite } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth, requireAdmin);

async function totalEleveAvecRemise(eleve, reductionFamille) {
  const [[classe]] = await db.query('SELECT frais_scolarite FROM classes WHERE id=?', [eleve.classe_id]);
  const [tranches] = await db.query('SELECT montant FROM classe_tranches WHERE classe_id=? ORDER BY numero ASC', [eleve.classe_id]);
  const remise = parseFloat(eleve.remise_pourcentage) || 0;
  if (!tranches.length) return (parseFloat(classe?.frais_scolarite) || 0) * (1 - remise / 100);
  return tranches.reduce((total, tranche, index) => {
    const pct = index === tranches.length - 1 ? Math.min(100, remise + (parseFloat(reductionFamille) || 0)) : remise;
    return total + (parseFloat(tranche.montant) || 0) * (1 - pct / 100);
  }, 0);
}

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

  if (item.table_source === 'eleves_suspendu') {
    // Meme mecanique que "eleves" (l'archivage) ci-dessus : la ligne n'a jamais quitte la
    // table, on remet juste le statut a 'actif'. Table_source distinct uniquement pour que
    // la Corbeille affiche "Élève suspendu" plutot que "Élève archivé".
    await db.query("UPDATE eleves SET statut='actif' WHERE id=?", [data.id]);
    await db.query('UPDATE corbeille SET restaure=1 WHERE id=?', [id]);
    await logActivite(req.user.id, 'Eleve reactive (via corbeille)', `Corbeille ID:${id}`, req.ip);
    return res.json({ success: true, message: 'Élève réactivé.' });
  }

  if (item.table_source === 'paiements') {
    // L'annulation d'un paiement est elle aussi un changement de statut, jamais un vrai
    // DELETE : on restaure l'etat exact d'avant l'annulation depuis le snapshot (y compris
    // son propre surplus_rembourse, qui avait ete force a 1 au moment de l'annulation).
    await db.query(
      "UPDATE paiements SET statut='valide', motif_annulation=NULL, annule_par=NULL, surplus_rembourse=? WHERE id=?",
      [data.surplus_rembourse, data.id]
    );
    await db.query('UPDATE corbeille SET restaure=1 WHERE id=?', [id]);
    await logActivite(req.user.id, 'Paiement restaure (via corbeille)', `Corbeille ID:${id}`, req.ip);
    return res.json({ success: true, message: 'Paiement restauré (à nouveau valide).' });
  }

  if (item.table_source === 'classes') {
    await db.query('UPDATE classes SET actif=1 WHERE id=?', [data.id]);
    await db.query('UPDATE corbeille SET restaure=1 WHERE id=?', [id]);
    await logActivite(req.user.id, 'Classe restauree', `Corbeille ID:${id}`, req.ip);
    return res.json({ success: true, message: 'Classe restauree.' });
  }

  if (item.table_source === 'familles') {
    const famille = data.famille;
    const membres = Array.isArray(data.membres) ? data.membres : [];
    const [[existante]] = await db.query('SELECT id FROM familles WHERE id=?', [famille.id]);
    if (!existante) return res.status(404).json({ error: 'Famille introuvable.' });
    const placeholders = membres.map(() => '?').join(',');
    if (membres.length) {
      const [occupes] = await db.query(`SELECT id FROM eleves WHERE id IN (${placeholders}) AND famille_id IS NOT NULL AND famille_id<>?`, [...membres.map((m) => m.id), famille.id]);
      if (occupes.length) return res.status(400).json({ error: 'Un membre ne peut pas être restauré car il appartient déjà à une autre famille.' });
    }
    await db.query('UPDATE familles SET actif=1 WHERE id=?', [famille.id]);
    for (const membre of membres) {
      const total = await totalEleveAvecRemise(membre, famille.pourcentage_reduction);
      await db.query('UPDATE eleves SET famille_id=?, frais_scolarite_total=? WHERE id=?', [famille.id, total, membre.id]);
    }
    await db.query('UPDATE corbeille SET restaure=1 WHERE id=?', [id]);
    await logActivite(req.user.id, 'Famille restauree', `Corbeille ID:${id}`, req.ip);
    return res.json({ success: true, message: 'Famille restaurée.' });
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

  if (item.table_source === 'recettes_diverses') {
    // Meme mecanique que "depenses" ci-dessus (vrai DELETE, reinsertion depuis le snapshot).
    const cols = Object.keys(data);
    const placeholders = cols.map(() => '?').join(',');
    await db.query(`INSERT INTO recettes_diverses (${cols.join(',')}) VALUES (${placeholders})`, Object.values(data));
    await db.query('UPDATE corbeille SET restaure=1 WHERE id=?', [id]);
    await logActivite(req.user.id, 'Recette diverse restauree', `Corbeille ID:${id}`, req.ip);
    return res.json({ success: true, message: 'Recette restaurée.' });
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
