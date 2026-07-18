const express = require('express');
const db = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { genererMatricule, logActivite, envoyerCorbeille, getParam } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth);

// GET /api/eleves?classe_id=&q=&statut=
router.get('/', async (req, res) => {
  const { classe_id, q, statut = 'actif' } = req.query;
  const where = ['e.statut != "transfere"'];
  const params = [];
  if (classe_id) { where.push('e.classe_id=?'); params.push(classe_id); }
  if (q) { where.push('(e.nom LIKE ? OR e.prenom LIKE ? OR e.matricule LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (statut) { where.push('e.statut=?'); params.push(statut); }
  const whereStr = `WHERE ${where.join(' AND ')}`;

  const [rows] = await db.query(
    `SELECT e.*, c.nom as classe_nom,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite'),0) as total_paye
     FROM eleves e JOIN classes c ON c.id=e.classe_id
     ${whereStr} ORDER BY e.nom ASC, e.prenom ASC`,
    params
  );
  res.json(rows);
});

// GET /api/eleves/search?q=  (recherche instantanee - remplace api/search_eleve.php)
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const [rows] = await db.query(
    `SELECT e.id, e.nom, e.prenom, e.matricule, e.genre, c.nom as classe,
            e.frais_scolarite_total,
            COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide'),0) as total_paye
     FROM eleves e JOIN classes c ON c.id=e.classe_id
     WHERE e.statut='actif' AND (e.nom LIKE ? OR e.prenom LIKE ? OR e.matricule LIKE ? OR CONCAT(e.prenom,' ',e.nom) LIKE ?)
     ORDER BY e.nom ASC, e.prenom ASC LIMIT 10`,
    [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`]
  );
  const result = rows.map((e) => ({
    ...e,
    reste: Math.max(0, e.frais_scolarite_total - e.total_paye),
  }));
  res.json(result);
});

// GET /api/eleves/by-classe/:classeId (remplace api/eleves_classe.php)
router.get('/by-classe/:classeId', async (req, res) => {
  const { classeId } = req.params;
  const [rows] = await db.query(
    `SELECT e.id, e.nom, e.prenom, e.matricule, e.genre, e.frais_scolarite_total,
            COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide'),0) as total_paye
     FROM eleves e WHERE e.classe_id=? AND e.statut='actif' ORDER BY e.nom ASC, e.prenom ASC`,
    [classeId]
  );
  res.json(rows.map((e) => ({ ...e, reste: Math.max(0, e.frais_scolarite_total - e.total_paye) })));
});

// GET /api/eleves/export.csv
router.get('/export.csv', async (req, res) => {
  const { classe_id, q, statut = 'actif' } = req.query;
  const where = ['e.statut != "transfere"'];
  const params = [];
  if (classe_id) { where.push('e.classe_id=?'); params.push(classe_id); }
  if (q) { where.push('(e.nom LIKE ? OR e.prenom LIKE ? OR e.matricule LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (statut) { where.push('e.statut=?'); params.push(statut); }
  const whereStr = `WHERE ${where.join(' AND ')}`;

  const [rows] = await db.query(
    `SELECT e.matricule, e.prenom, e.nom, e.genre, e.date_naissance, c.nom as classe, e.statut,
            e.nom_parent, e.telephone_parent, e.frais_scolarite_total,
            COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide'),0) as total_paye,
            e.date_inscription, e.annee_scolaire
     FROM eleves e JOIN classes c ON c.id=e.classe_id
     ${whereStr} ORDER BY e.nom ASC`,
    params
  );

  const header = ['Matricule', 'Prenom', 'Nom', 'Genre', 'Date Naissance', 'Classe', 'Statut', 'Parent', 'Tel. Parent', 'Frais Total', 'Total Paye', 'Reste', 'Inscription', 'Annee'];
  const lines = [header.join(';')];
  rows.forEach((e) => {
    const reste = Math.max(0, e.frais_scolarite_total - e.total_paye);
    lines.push([
      e.matricule, e.prenom, e.nom, e.genre === 'F' ? 'Feminin' : 'Masculin',
      e.date_naissance || '', e.classe, e.statut, e.nom_parent || '', e.telephone_parent || '',
      e.frais_scolarite_total, e.total_paye, reste, e.date_inscription || '', e.annee_scolaire || '',
    ].join(';'));
  });

  res.setHeader('Content-Type', 'text/csv; charset=UTF-8');
  res.setHeader('Content-Disposition', `attachment; filename="eleves_${Date.now()}.csv"`);
  res.send('\uFEFF' + lines.join('\n'));
});

// GET /api/eleves/:id (fiche detaillee + paiements + calculs)
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const [[eleve]] = await db.query(
    `SELECT e.*, c.nom as classe_nom, c.frais_scolarite as classe_frais, c.frais_inscription as classe_frais_inscription,
            cs.nom as classe_sup_nom, ci.nom as classe_inf_nom
     FROM eleves e JOIN classes c ON c.id=e.classe_id
     LEFT JOIN classes cs ON cs.id=c.classe_superieure_id
     LEFT JOIN classes ci ON ci.id=c.classe_inferieure_id
     WHERE e.id=?`,
    [id]
  );
  if (!eleve) return res.status(404).json({ error: 'Eleve introuvable.' });

  const [paiements] = await db.query(
    `SELECT p.*, u.prenom as cpt_prenom, u.nom as cpt_nom
     FROM paiements p LEFT JOIN utilisateurs u ON u.id=p.comptable_id
     WHERE p.eleve_id=? ORDER BY p.date_paiement DESC`,
    [id]
  );

  const totalPayeScolarite = paiements.filter((p) => p.statut === 'valide' && p.type_paiement === 'scolarite').reduce((s, p) => s + parseFloat(p.montant_usd || p.montant), 0);
  const totalPayeInscription = paiements.filter((p) => p.statut === 'valide' && p.type_paiement === 'inscription').reduce((s, p) => s + parseFloat(p.montant_usd || p.montant), 0);
  const totalRembourse = paiements.filter((p) => p.statut === 'rembourse').reduce((s, p) => s + parseFloat(p.montant), 0);
  const resteScolarite = Math.max(0, eleve.frais_scolarite_total - totalPayeScolarite);
  const resteInscription = Math.max(0, eleve.frais_inscription_total - totalPayeInscription);
  const pctScolarite = eleve.frais_scolarite_total > 0 ? Math.min(100, Math.round((totalPayeScolarite / eleve.frais_scolarite_total) * 100)) : 0;

  res.json({
    eleve, paiements,
    totaux: { totalPayeScolarite, totalPayeInscription, totalRembourse, resteScolarite, resteInscription, pctScolarite },
  });
});

// GET /api/eleves/:id/caisse-info (donnees necessaires a la page caisse rapide)
router.get('/:id/caisse-info', async (req, res) => {
  const { id } = req.params;
  const [[eleve]] = await db.query(
    `SELECT e.*, c.nom as classe_nom, c.frais_scolarite, c.frais_inscription,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite'),0) as total_paye_scolarite,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='inscription'),0) as total_paye_inscription,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide'),0) as total_paye_global
     FROM eleves e JOIN classes c ON c.id=e.classe_id WHERE e.id=?`,
    [id]
  );
  if (!eleve) return res.status(404).json({ error: 'Eleve introuvable.' });
  eleve.reste_scolarite = Math.max(0, eleve.frais_scolarite_total - eleve.total_paye_scolarite);
  eleve.reste_inscription = Math.max(0, eleve.frais_inscription_total - eleve.total_paye_inscription);

  const [historique] = await db.query(
    `SELECT p.*, u.prenom as c_prenom, u.nom as c_nom
     FROM paiements p LEFT JOIN utilisateurs u ON u.id=p.comptable_id
     WHERE p.eleve_id=? ORDER BY p.date_paiement DESC LIMIT 10`,
    [id]
  );
  res.json({ eleve, historique });
});

// POST /api/eleves (inscription)
router.post('/', requirePermission('eleves'), async (req, res) => {
  const {
    nom, prenom, genre = 'M', classe_id, date_naissance, lieu_naissance,
    nom_parent, telephone_parent, email_parent, adresse,
  } = req.body;

  if (!nom || !prenom || !classe_id) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }

  const [[cls]] = await db.query('SELECT frais_scolarite, frais_inscription FROM classes WHERE id=?', [classe_id]);
  if (!cls) return res.status(400).json({ error: 'Classe invalide.' });

  const annee = await getParam('annee_scolaire_courante');
  const matricule = await genererMatricule();

  const [result] = await db.query(
    `INSERT INTO eleves (matricule,nom,prenom,genre,date_naissance,lieu_naissance,classe_id,nom_parent,telephone_parent,email_parent,adresse,statut,date_inscription,annee_scolaire,frais_scolarite_total,frais_inscription_total,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'actif',CURDATE(),?,?,?,?)`,
    [
      matricule, nom, prenom, genre, date_naissance || null, lieu_naissance || null,
      classe_id, nom_parent || null, telephone_parent || null, email_parent || null, adresse || null,
      annee, cls.frais_scolarite, cls.frais_inscription, req.user.id,
    ]
  );
  await logActivite(req.user.id, 'Eleve ajoute', `Matricule:${matricule}`, req.ip);
  const [[created]] = await db.query('SELECT * FROM eleves WHERE id=?', [result.insertId]);
  res.status(201).json({ eleve: created, matricule });
});

// PUT /api/eleves/:id (modification)
router.put('/:id', requirePermission('eleves'), async (req, res) => {
  const { id } = req.params;
  const { nom, prenom, genre, date_naissance, lieu_naissance, classe_id, nom_parent, telephone_parent, email_parent, adresse, statut } = req.body;
  await db.query(
    `UPDATE eleves SET nom=?,prenom=?,genre=?,date_naissance=?,lieu_naissance=?,classe_id=?,nom_parent=?,telephone_parent=?,email_parent=?,adresse=?,statut=? WHERE id=?`,
    [nom, prenom, genre, date_naissance || null, lieu_naissance, classe_id, nom_parent, telephone_parent, email_parent, adresse, statut, id]
  );
  await logActivite(req.user.id, 'Eleve modifie', `ID:${id}`, req.ip);
  const [[updated]] = await db.query('SELECT * FROM eleves WHERE id=?', [id]);
  res.json(updated);
});

// POST /api/eleves/:id/retrograder
router.post('/:id/retrograder', requirePermission('eleves'), async (req, res) => {
  const { id } = req.params;
  const [[row]] = await db.query(
    `SELECT e.classe_id, c.classe_inferieure_id FROM eleves e JOIN classes c ON c.id=e.classe_id WHERE e.id=?`,
    [id]
  );
  if (!row || !row.classe_inferieure_id) {
    return res.status(400).json({ error: 'Aucune classe inferieure definie pour cette classe.' });
  }
  const [[nci]] = await db.query('SELECT frais_scolarite, frais_inscription FROM classes WHERE id=?', [row.classe_inferieure_id]);
  await db.query(
    `UPDATE eleves SET classe_id=?, statut='redoublant', frais_scolarite_total=?, frais_inscription_total=? WHERE id=?`,
    [row.classe_inferieure_id, nci.frais_scolarite, nci.frais_inscription, id]
  );
  await logActivite(req.user.id, 'Eleve retrograde', `ID:${id}`, req.ip);
  res.json({ success: true });
});

// DELETE /api/eleves/:id (archivage -> corbeille)
router.delete('/:id', requirePermission('eleves'), async (req, res) => {
  const { id } = req.params;
  const [[data]] = await db.query('SELECT * FROM eleves WHERE id=?', [id]);
  if (!data) return res.status(404).json({ error: 'Eleve introuvable.' });
  await envoyerCorbeille('eleves', data, req.user.id);
  await db.query("UPDATE eleves SET statut='transfere' WHERE id=?", [id]);
  await logActivite(req.user.id, 'Eleve archive', `ID:${id}`, req.ip);
  res.json({ success: true });
});

module.exports = router;
