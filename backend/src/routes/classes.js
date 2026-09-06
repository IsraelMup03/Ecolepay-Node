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
  // Attache les sections de chaque classe en une seule requete supplementaire (pas une par
  // classe) : Classes.jsx peut ainsi les afficher directement dans la liste.
  if (rows.length > 0) {
    const [sectionRows] = await db.query('SELECT * FROM sections ORDER BY ordre ASC, nom ASC');
    const parClasse = {};
    for (const s of sectionRows) {
      (parClasse[s.classe_id] = parClasse[s.classe_id] || []).push(s);
    }
    rows.forEach((r) => { r.sections = parClasse[r.id] || []; });
  }
  res.json(rows);
});

// GET /api/classes/:id/tranches -> liste des tranches de scolarite d'une classe (vide si
// elle n'utilise pas les tranches, auquel cas classes.frais_scolarite est un montant unique)
router.get('/:id/tranches', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM classe_tranches WHERE classe_id=? ORDER BY numero ASC', [req.params.id]);
  res.json(rows);
});

// GET /api/classes/:id/stats -> effectif + recouvrement pour une classe, + repartition
// par section si la classe en a (un eleve sans section assignee compte dans "sans_section").
router.get('/:id/stats', async (req, res) => {
  const { id } = req.params;
  const [[cls]] = await db.query('SELECT * FROM classes WHERE id=?', [id]);
  if (!cls) return res.status(404).json({ error: 'Classe introuvable.' });
  const [[stats]] = await db.query(
    `SELECT COUNT(*) as nb_eleves,
            COALESCE(SUM(frais_scolarite_total),0) as total_attendu,
            COALESCE(SUM((SELECT COALESCE(SUM(p.montant_usd),0) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite' AND p.annee_scolaire=e.annee_scolaire)),0) as total_paye
     FROM eleves e WHERE e.classe_id=? AND e.statut='actif'`,
    [id]
  );
  const [sections] = await db.query('SELECT * FROM sections WHERE classe_id=? ORDER BY ordre ASC, nom ASC', [id]);
  let parSection = [];
  let elevesSansSection = 0;
  if (sections.length > 0) {
    const [rows] = await db.query(
      `SELECT section_id, COUNT(*) as nb_eleves
       FROM eleves WHERE classe_id=? AND statut='actif' GROUP BY section_id`,
      [id]
    );
    const parId = Object.fromEntries(rows.map((r) => [r.section_id === null ? 'null' : r.section_id, r.nb_eleves]));
    parSection = sections.map((s) => ({ ...s, nb_eleves: parId[s.id] || 0 }));
    elevesSansSection = parId.null || 0;
  }
  res.json({ classe: cls, stats, sections: parSection, elevesSansSection });
});

// GET /api/classes/:id/sections -> liste des sections d'une classe
router.get('/:id/sections', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM sections WHERE classe_id=? ORDER BY ordre ASC, nom ASC', [req.params.id]);
  res.json(rows);
});

// POST /api/classes/:id/sections  { nom }
router.post('/:id/sections', requirePermission('classes'), async (req, res) => {
  const { id } = req.params;
  const { nom } = req.body;
  if (!nom) return res.status(400).json({ error: 'Nom de section requis.' });
  const [[cls]] = await db.query('SELECT id FROM classes WHERE id=?', [id]);
  if (!cls) return res.status(404).json({ error: 'Classe introuvable.' });
  const [[{ nb }]] = await db.query('SELECT COUNT(*) as nb FROM sections WHERE classe_id=?', [id]);
  const [result] = await db.query('INSERT INTO sections (classe_id, nom, ordre) VALUES (?,?,?)', [id, nom, nb]);
  await logActivite(req.user.id, 'Section creee', `Classe ID:${id} - Section: ${nom}`, req.ip);
  const [[created]] = await db.query('SELECT * FROM sections WHERE id=?', [result.insertId]);
  res.status(201).json(created);
});

// DELETE /api/classes/sections/:sectionId
router.delete('/sections/:sectionId', requirePermission('classes'), async (req, res) => {
  const { sectionId } = req.params;
  const [[section]] = await db.query('SELECT * FROM sections WHERE id=?', [sectionId]);
  if (!section) return res.status(404).json({ error: 'Section introuvable.' });
  const [[{ nb }]] = await db.query("SELECT COUNT(*) as nb FROM eleves WHERE section_id=? AND statut='actif'", [sectionId]);
  if (nb > 0) {
    return res.status(400).json({ error: `Impossible de supprimer: ${nb} eleve(s) actif(s) dans cette section.` });
  }
  await db.query('DELETE FROM sections WHERE id=?', [sectionId]);
  await logActivite(req.user.id, 'Section supprimee', `Section: ${section.nom} (classe ID:${section.classe_id})`, req.ip);
  res.json({ success: true });
});

// Transforme un tableau de montants de tranches (venu du formulaire) en tableau de nombres
// positifs valides, en filtrant tout ce qui n'est pas un montant reel (case vide, 0...).
function nettoyerTranches(tranches) {
  if (!Array.isArray(tranches)) return null;
  return tranches.map((t) => parseFloat(t) || 0).filter((t) => t > 0);
}

// POST /api/classes  { ..., nb_sections?, tranches?: [montant1, montant2, ...] }
// `tranches`, si fourni et non vide, remplace `frais_scolarite` par la somme des montants
// et cree les lignes classe_tranches correspondantes (numero 1, 2, 3...). Une classe qui
// n'utilise pas les tranches (champ absent) garde le comportement d'un montant unique.
router.post('/', requirePermission('classes'), async (req, res) => {
  const { nom, frais_scolarite, frais_inscription, classe_superieure_id, classe_inferieure_id, effectif_max, niveau_id, ordre, nb_sections, tranches, est_pivot } = req.body;
  if (!nom) return res.status(400).json({ error: 'Nom de classe requis.' });

  const ecole = await getEcole();
  const annee = await getParam('annee_scolaire_courante');
  const tranchesValides = nettoyerTranches(tranches) || [];
  const fraisScolariteFinal = tranchesValides.length > 0
    ? tranchesValides.reduce((s, t) => s + t, 0)
    : (parseFloat(frais_scolarite) || 0);
  const estPivot = est_pivot ? 1 : 0;
  // Une classe pivot n'a par definition aucune "classe superieure" unique (les eleves se
  // separent vers plusieurs classes differentes, choisies individuellement via un transfert)
  // : on ignore toute valeur fournie pour ce champ plutot que de garder une donnee morte.
  const classeSupFinal = estPivot ? null : (classe_superieure_id || null);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO classes (nom, niveau_id, classe_superieure_id, classe_inferieure_id, frais_inscription, frais_scolarite, devise, effectif_max, ordre, annee_scolaire, est_pivot)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        nom,
        niveau_id || null,
        classeSupFinal,
        classe_inferieure_id || null,
        parseFloat(frais_inscription) || 0,
        fraisScolariteFinal,
        ecole?.devise || 'USD',
        parseInt(effectif_max, 10) || 50,
        parseInt(ordre, 10) || 0,
        annee,
        estPivot,
      ]
    );

    for (let i = 0; i < tranchesValides.length; i++) {
      await conn.query('INSERT INTO classe_tranches (classe_id, numero, montant) VALUES (?,?,?)', [result.insertId, i + 1, tranchesValides[i]]);
    }

    // Cree automatiquement les sections A, B, C... si demande (ex: "1ere Secondaire" avec 3
    // sections -> "1ere Secondaire A/B/C"). Le nom de la section ne stocke que la lettre : le
    // nom complet affiche est toujours compose de classe.nom + ' ' + section.nom, pour ne
    // jamais avoir a renommer les sections si la classe elle-meme est renommee plus tard.
    const nbSections = Math.max(0, Math.min(26, parseInt(nb_sections, 10) || 0));
    for (let i = 0; i < nbSections; i++) {
      await conn.query('INSERT INTO sections (classe_id, nom, ordre) VALUES (?,?,?)', [result.insertId, String.fromCharCode(65 + i), i]);
    }

    await conn.commit();
    await logActivite(req.user.id, 'Classe creee', `Nom: ${nom}${nbSections > 0 ? ` (${nbSections} sections)` : ''}${tranchesValides.length > 0 ? ` (${tranchesValides.length} tranches)` : ''}`, req.ip);
    const [[created]] = await db.query('SELECT * FROM classes WHERE id=?', [result.insertId]);
    res.status(201).json(created);
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la creation de la classe.' });
  } finally {
    conn.release();
  }
});

// PUT /api/classes/:id  { ..., tranches?: [montant1, montant2, ...] }
// `tranches` absent du corps de la requete = on ne touche pas aux tranches existantes (ou
// absence, pour une classe qui n'en utilise pas) et `frais_scolarite` est utilise tel quel.
// `tranches` present (meme vide []) = remplace entierement les lignes classe_tranches de
// cette classe et recalcule frais_scolarite comme leur somme.
router.put('/:id', requirePermission('classes'), async (req, res) => {
  const { id } = req.params;
  const { nom, frais_scolarite, frais_inscription, classe_superieure_id, classe_inferieure_id, effectif_max, niveau_id, ordre, actif, tranches, est_pivot } = req.body;
  const tranchesValides = nettoyerTranches(tranches);
  const estPivot = est_pivot ? 1 : 0;
  const classeSupFinal = estPivot ? null : (classe_superieure_id || null);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let fraisScolariteFinal = parseFloat(frais_scolarite) || 0;
    if (tranchesValides !== null) {
      await conn.query('DELETE FROM classe_tranches WHERE classe_id=?', [id]);
      for (let i = 0; i < tranchesValides.length; i++) {
        await conn.query('INSERT INTO classe_tranches (classe_id, numero, montant) VALUES (?,?,?)', [id, i + 1, tranchesValides[i]]);
      }
      if (tranchesValides.length > 0) fraisScolariteFinal = tranchesValides.reduce((s, t) => s + t, 0);
    }

    await conn.query(
      `UPDATE classes SET nom=?, frais_scolarite=?, frais_inscription=?, classe_superieure_id=?, classe_inferieure_id=?, effectif_max=?, niveau_id=?, ordre=?, actif=?, est_pivot=?
       WHERE id=?`,
      [
        nom,
        fraisScolariteFinal,
        parseFloat(frais_inscription) || 0,
        classeSupFinal,
        classe_inferieure_id || null,
        parseInt(effectif_max, 10) || 50,
        niveau_id || null,
        parseInt(ordre, 10) || 0,
        actif === undefined ? 1 : (actif ? 1 : 0),
        estPivot,
        id,
      ]
    );
    // Repercute le nouveau montant sur les eleves actuellement actifs dans cette classe
    // (les eleves.frais_scolarite_total/frais_inscription_total sont une copie prise a
    // l'inscription/promotion, pas une reference live vers la classe), en respectant la
    // remise deja accordee individuellement a chaque eleve -- un seul UPDATE, SQL calcule
    // le montant remise ligne par ligne a partir de la colonne remise_pourcentage de
    // chaque eleve. On ne touche pas aux annees archivees : leur situation financiere
    // passee doit rester figee.
    await conn.query(
      `UPDATE eleves SET frais_scolarite_total = ? * (1 - COALESCE(remise_pourcentage,0)/100.0), frais_inscription_total=? WHERE classe_id=? AND statut='actif'`,
      [fraisScolariteFinal, parseFloat(frais_inscription) || 0, id]
    );

    await conn.commit();
    await logActivite(req.user.id, 'Classe modifiee', `ID:${id}`, req.ip);
    const [[updated]] = await db.query('SELECT * FROM classes WHERE id=?', [id]);
    res.json(updated);
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la modification de la classe.' });
  } finally {
    conn.release();
  }
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
