const express = require('express');
const db = require('../config/db');
const { requireAuth, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { genererMatricule, logActivite, envoyerCorbeille, getParam, getEcole, nomCompletConditions } = require('../utils/helpers');
const { newWorkbook, addLetterhead, addTable, sendWorkbook } = require('../utils/excelReport');

const router = express.Router();
router.use(requireAuth);

// GET /api/eleves?classe_id=&q=&statut=&annee=&page=&limit=  (annee: consulter une annee archivee)
router.get('/', requirePermission('eleves'), async (req, res) => {
  const { classe_id, q, statut = 'actif', redoublant, annee } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const offset = (page - 1) * limit;

  if (annee) {
    const [[{ cnt }]] = await db.query('SELECT COUNT(*) as cnt FROM archives_annuelles WHERE annee_scolaire=?', [annee]);
    if (cnt > 0) {
      const whereA = ['a.annee_scolaire=?'];
      const paramsA = [annee];
      if (classe_id) { whereA.push('a.classe_id=?'); paramsA.push(classe_id); }
      if (q) {
        const { sql: nomSql, count: nomCount } = nomCompletConditions('e');
        whereA.push(`(e.nom LIKE ? OR e.postnom LIKE ? OR e.prenom LIKE ? OR e.matricule LIKE ? OR ${nomSql})`);
        paramsA.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, ...Array(nomCount).fill(`%${q}%`));
      }
      const [[{ total }]] = await db.query(
        `SELECT COUNT(*) as total FROM archives_annuelles a JOIN eleves e ON e.id=a.eleve_id WHERE ${whereA.join(' AND ')}`,
        paramsA
      );
      const [rows] = await db.query(
        `SELECT e.id, e.matricule, e.nom, e.postnom, e.prenom, e.genre, a.classe_id, c.nom as classe_nom,
                a.frais_scolarite_total, a.total_paye, a.statut_paiement
         FROM archives_annuelles a
         JOIN eleves e ON e.id=a.eleve_id
         LEFT JOIN classes c ON c.id=a.classe_id
         WHERE ${whereA.join(' AND ')}
         ORDER BY e.nom ASC, e.prenom ASC LIMIT ? OFFSET ?`,
        [...paramsA, limit, offset]
      );
      return res.json({ rows: rows.map((r) => ({ ...r, archive: true })), total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
    }
    // Annee non encore archivee (= annee courante) -> la requete live ci-dessous reflete deja cette annee.
  }

  const where = ['e.statut != "transfere"'];
  const params = [];
  if (classe_id) { where.push('e.classe_id=?'); params.push(classe_id); }
  if (q) {
    const { sql: nomSql, count: nomCount } = nomCompletConditions('e');
    where.push(`(e.nom LIKE ? OR e.postnom LIKE ? OR e.prenom LIKE ? OR e.matricule LIKE ? OR ${nomSql})`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, ...Array(nomCount).fill(`%${q}%`));
  }
  if (statut) { where.push('e.statut=?'); params.push(statut); }
  if (redoublant) { where.push('e.redoublant=1'); }
  const whereStr = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM eleves e ${whereStr}`, params);
  const [rows] = await db.query(
    `SELECT e.*, c.nom as classe_nom,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye
     FROM eleves e JOIN classes c ON c.id=e.classe_id
     ${whereStr} ORDER BY e.nom ASC, e.prenom ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ rows, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

// GET /api/eleves/search?q=  (recherche instantanee - remplace api/search_eleve.php)
// Accessible aux caissiers (Caisse rapide) sans exiger la permission 'eleves' a part entiere.
router.get('/search', requireAnyPermission('paiements', 'eleves'), async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const { sql: nomSql, count: nomCount } = nomCompletConditions('e');
  const [rows] = await db.query(
    `SELECT e.id, e.nom, e.postnom, e.prenom, e.matricule, e.genre, c.nom as classe,
            e.frais_scolarite_total,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye
     FROM eleves e JOIN classes c ON c.id=e.classe_id
     WHERE e.statut='actif' AND (e.nom LIKE ? OR e.postnom LIKE ? OR e.prenom LIKE ? OR e.matricule LIKE ? OR ${nomSql})
     ORDER BY e.nom ASC, e.prenom ASC LIMIT 10`,
    [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, ...Array(nomCount).fill(`%${q}%`)]
  );
  const result = rows.map((e) => ({
    ...e,
    reste: Math.max(0, e.frais_scolarite_total - e.total_paye),
  }));
  res.json(result);
});

// GET /api/eleves/by-classe/:classeId (remplace api/eleves_classe.php)
router.get('/by-classe/:classeId', requireAnyPermission('classes', 'eleves'), async (req, res) => {
  const { classeId } = req.params;
  const payerName = (process.env.DB_CLIENT || '').toLowerCase() === 'sqlite'
    ? "COALESCE(u.prenom,'') || ' ' || COALESCE(u.nom,'')"
    : "CONCAT_WS(' ', u.prenom, u.nom)";
  const payerConcat = (process.env.DB_CLIENT || '').toLowerCase() === 'sqlite'
    ? `REPLACE(GROUP_CONCAT(DISTINCT ${payerName}), ',', ', ')`
    : `GROUP_CONCAT(DISTINCT ${payerName} SEPARATOR ', ')`;
  const dateExpr = (process.env.DB_CLIENT || '').toLowerCase() === 'sqlite'
    ? 'p2.date_paiement'
    : "DATE_FORMAT(p2.date_paiement, '%Y-%m-%d %H:%i:%s')";

  const [rows] = await db.query(
    `SELECT e.id, e.nom, e.postnom, e.prenom, e.matricule, e.genre, e.frais_scolarite_total, e.redoublant,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye,
            (SELECT ${dateExpr} FROM paiements p2 WHERE p2.eleve_id=e.id AND p2.statut='valide' ORDER BY p2.date_paiement DESC LIMIT 1) as dernier_paiement_date,
            (SELECT ${payerConcat} FROM paiements p2 JOIN utilisateurs u ON u.id=p2.comptable_id WHERE p2.eleve_id=e.id AND p2.statut='valide') as perce_par
     FROM eleves e WHERE e.classe_id=? AND e.statut='actif' ORDER BY e.nom ASC, e.prenom ASC`,
    [classeId]
  );
  res.json(rows.map((e) => ({
    ...e,
    reste: Math.max(0, (e.frais_scolarite_total || 0) - (e.total_paye || 0)),
    dernier_paiement_date: e.dernier_paiement_date || '',
    perce_par: e.perce_par || '',
  })));
});

// GET /api/eleves/export.xlsx
router.get('/export.xlsx', requirePermission('eleves'), async (req, res) => {
  try {
    const { classe_id, q, statut = 'actif', redoublant, devise: deviseQ } = req.query;
    const where = ['e.statut != "transfere"'];
    const params = [];
    if (classe_id) { where.push('e.classe_id=?'); params.push(classe_id); }
    if (q) {
      const { sql: nomSql, count: nomCount } = nomCompletConditions('e');
      where.push(`(e.nom LIKE ? OR e.postnom LIKE ? OR e.prenom LIKE ? OR e.matricule LIKE ? OR ${nomSql})`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, ...Array(nomCount).fill(`%${q}%`));
    }
    if (statut) { where.push('e.statut=?'); params.push(statut); }
    if (redoublant) { where.push('e.redoublant=1'); }
    const whereStr = `WHERE ${where.join(' AND ')}`;

    const [rows] = await db.query(
      `SELECT e.matricule, e.prenom, e.postnom, e.nom, e.genre, e.date_naissance, c.nom as classe, e.statut, e.redoublant,
              e.nom_parent, e.telephone_parent, e.frais_scolarite_total,
              COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye,
              e.date_inscription, e.annee_scolaire
       FROM eleves e JOIN classes c ON c.id=e.classe_id
       ${whereStr} ORDER BY e.nom ASC`,
      params
    );

    const STATUT_LABELS = { actif: 'Actif', suspendu: 'Suspendu', diplome: 'Dipl\u00F4m\u00E9', transfere: 'Transf\u00E9r\u00E9' };
    const ecole = await getEcole();
    const devise = deviseQ === 'CDF' || (deviseQ && deviseQ !== 'USD') ? deviseQ : 'USD';
    const taux = parseFloat(await getParam('taux_usd_cdf', '1')) || 1;
    const workbook = newWorkbook();
    const sheet = workbook.addWorksheet('\u00C9l\u00E8ves', { views: [{ state: 'frozen', ySplit: 8 }] });
    const columns = [
      { header: 'Matricule', key: 'matricule', width: 16, type: 'text' },
      { header: 'Nom', key: 'nom', width: 18, type: 'text' },
      { header: 'Post-nom', key: 'postnom', width: 18, type: 'text' },
      { header: 'Pr\u00E9nom', key: 'prenom', width: 18, type: 'text' },
      { header: 'Genre', key: 'genre', width: 10, type: 'text' },
      { header: 'Date naissance', key: 'date_naissance', width: 16, type: 'text' },
      { header: 'Classe', key: 'classe', width: 24, type: 'text' },
      { header: 'Statut', key: 'statut', width: 20, type: 'text' },
      { header: 'Parent/tuteur', key: 'parent', width: 22, type: 'text' },
      { header: 'T\u00E9l\u00E9phone parent', key: 'telephone', width: 18, type: 'text' },
      { header: 'Frais total', key: 'frais_total', width: 16, type: 'currency', totalize: true },
      { header: 'Total pay\u00E9', key: 'total_paye', width: 16, type: 'currency', totalize: true },
      { header: 'Reste', key: 'reste', width: 16, type: 'currency', totalize: true },
      { header: 'Inscription', key: 'inscription', width: 16, type: 'text' },
      { header: 'Ann\u00E9e scolaire', key: 'annee', width: 16, type: 'text' },
    ];
    const nextRow = addLetterhead(sheet, {
      ecole, title: 'Liste des \u00E9l\u00E8ves', subtitle: `${rows.length} \u00E9l\u00E8ve(s)`,
      generatedBy: req.user ? `${req.user.prenom || ''} ${req.user.nom || ''}`.trim() : null,
      numCols: columns.length,
    });
    addTable(sheet, nextRow, columns, rows.map((e) => ({
      matricule: e.matricule, nom: e.nom, postnom: e.postnom || '\u2014', prenom: e.prenom, genre: e.genre === 'F' ? 'F\u00E9minin' : 'Masculin',
      date_naissance: e.date_naissance || '\u2014', classe: e.classe,
      statut: (STATUT_LABELS[e.statut] || e.statut) + (e.redoublant ? ' (redoublant)' : ''),
      parent: e.nom_parent || '\u2014', telephone: e.telephone_parent || '\u2014',
      frais_total: parseFloat(e.frais_scolarite_total) || 0, total_paye: parseFloat(e.total_paye) || 0,
      reste: Math.max(0, (parseFloat(e.frais_scolarite_total) || 0) - (parseFloat(e.total_paye) || 0)),
      inscription: e.date_inscription || '\u2014', annee: e.annee_scolaire || '\u2014',
    })), { showTotals: true, devise, taux });

    await sendWorkbook(res, workbook, `eleves_${Date.now()}.xlsx`);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la generation du rapport.' });
  }
});

// GET /api/eleves/:id (fiche detaillee + paiements + calculs) - ?annee=X pour consulter une annee passee
router.get('/:id', requirePermission('eleves'), async (req, res) => {
  const { id } = req.params;
  const { annee } = req.query;
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

  const [tousPaiements] = await db.query(
    `SELECT p.*, u.prenom as cpt_prenom, u.nom as cpt_nom,
            COALESCE((SELECT SUM(r.montant_usd) FROM remboursements r WHERE r.paiement_id=p.id AND r.statut='approuve'),0) as montant_rembourse_usd
     FROM paiements p LEFT JOIN utilisateurs u ON u.id=p.comptable_id
     WHERE p.eleve_id=? ORDER BY p.date_paiement DESC`,
    [id]
  );

  const modeHistorique = !!(annee && annee !== eleve.annee_scolaire);
  // Que ce soit en consultation live (annee active de l'eleve) ou en mode historique
  // (annee passee choisie), on n'affiche et on ne somme que les paiements de cette annee-la :
  // chaque annee scolaire repart de zero, l'historique complet reste accessible via Historique.
  const anneeCible = modeHistorique ? annee : eleve.annee_scolaire;
  const paiements = tousPaiements.filter((p) => p.annee_scolaire === anneeCible);

  const totalPayeScolarite = paiements.filter((p) => p.statut === 'valide' && p.type_paiement === 'scolarite').reduce((s, p) => s + parseFloat(p.montant_usd || p.montant), 0);
  const totalPayeInscription = paiements.filter((p) => p.statut === 'valide' && p.type_paiement === 'inscription').reduce((s, p) => s + parseFloat(p.montant_usd || p.montant), 0);
  // Inclut les remboursements totaux ET partiels (un paiement partiellement rembourse reste
  // statut='valide', seul son montant net diminue -- se fier au seul statut='rembourse'
  // ignorait tous les remboursements partiels et affichait toujours 0.
  const totalRembourse = paiements.reduce((s, p) => s + (parseFloat(p.montant_rembourse_usd) || 0), 0);
  const totalSurplusNonRendu = paiements.filter((p) => !p.surplus_rembourse).reduce((s, p) => s + (parseFloat(p.montant_surplus) || 0), 0);

  let fraisScolariteRef = eleve.frais_scolarite_total;
  let fraisInscriptionRef = eleve.frais_inscription_total;
  if (modeHistorique) {
    const [[archive]] = await db.query(
      `SELECT frais_scolarite_total FROM archives_annuelles WHERE eleve_id=? AND annee_scolaire=?`,
      [id, annee]
    );
    if (archive) fraisScolariteRef = archive.frais_scolarite_total;
  }

  const resteScolarite = Math.max(0, fraisScolariteRef - totalPayeScolarite);
  const resteInscription = Math.max(0, fraisInscriptionRef - totalPayeInscription);
  const pctScolarite = fraisScolariteRef > 0 ? Math.min(100, Math.round((totalPayeScolarite / fraisScolariteRef) * 100)) : 0;

  res.json({
    eleve, paiements, modeHistorique,
    totaux: { totalPayeScolarite, totalPayeInscription, totalRembourse, totalSurplusNonRendu, resteScolarite, resteInscription, pctScolarite },
  });
});

// GET /api/eleves/:id/caisse-info (donnees necessaires a la page caisse rapide)
router.get('/:id/caisse-info', requireAnyPermission('paiements', 'eleves'), async (req, res) => {
  const { id } = req.params;
  const [[eleve]] = await db.query(
    `SELECT e.*, c.nom as classe_nom, c.frais_scolarite, c.frais_inscription,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye_scolarite,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='inscription' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye_inscription,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye_global
     FROM eleves e JOIN classes c ON c.id=e.classe_id WHERE e.id=?`,
    [id]
  );
  if (!eleve) return res.status(404).json({ error: 'Eleve introuvable.' });
  eleve.reste_scolarite = Math.max(0, eleve.frais_scolarite_total - eleve.total_paye_scolarite);
  eleve.reste_inscription = Math.max(0, eleve.frais_inscription_total - eleve.total_paye_inscription);

  const [historique] = await db.query(
    `SELECT p.*, u.prenom as c_prenom, u.nom as c_nom,
            COALESCE((SELECT SUM(r.montant_usd) FROM remboursements r WHERE r.paiement_id=p.id AND r.statut='approuve'),0) as montant_rembourse_usd
     FROM paiements p LEFT JOIN utilisateurs u ON u.id=p.comptable_id
     WHERE p.eleve_id=? AND p.annee_scolaire=? ORDER BY p.date_paiement DESC LIMIT 10`,
    [id, eleve.annee_scolaire]
  );
  res.json({ eleve, historique });
});

// POST /api/eleves (inscription)
router.post('/', requirePermission('eleves'), async (req, res) => {
  const {
    nom, postnom, prenom, genre = 'M', classe_id, date_naissance, lieu_naissance,
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
    `INSERT INTO eleves (matricule,nom,postnom,prenom,genre,date_naissance,lieu_naissance,classe_id,nom_parent,telephone_parent,email_parent,adresse,statut,date_inscription,annee_scolaire,frais_scolarite_total,frais_inscription_total,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'actif',CURDATE(),?,?,?,?)`,
    [
      matricule, nom, postnom || null, prenom, genre, date_naissance || null, lieu_naissance || null,
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
  const { nom, postnom, prenom, genre, date_naissance, lieu_naissance, classe_id, nom_parent, telephone_parent, email_parent, adresse, statut } = req.body;
  await db.query(
    `UPDATE eleves SET nom=?,postnom=?,prenom=?,genre=?,date_naissance=?,lieu_naissance=?,classe_id=?,nom_parent=?,telephone_parent=?,email_parent=?,adresse=?,statut=? WHERE id=?`,
    [nom, postnom || null, prenom, genre, date_naissance || null, lieu_naissance, classe_id, nom_parent, telephone_parent, email_parent, adresse, statut, id]
  );
  await logActivite(req.user.id, 'Eleve modifie', `ID:${id}`, req.ip);
  const [[updated]] = await db.query('SELECT * FROM eleves WHERE id=?', [id]);
  res.json(updated);
});

// PUT /api/eleves/:id/statut  { statut: 'actif'|'suspendu' }  (bascule reversible et sans effet
// de bord ; un redoublant reste un eleve actif comme les autres, ce toggle ne touche pas au flag)
router.put('/:id/statut', requirePermission('eleves'), async (req, res) => {
  const { id } = req.params;
  const { statut } = req.body;
  if (!['actif', 'suspendu'].includes(statut)) {
    return res.status(400).json({ error: 'Statut invalide.' });
  }
  await db.query('UPDATE eleves SET statut=? WHERE id=?', [statut, id]);
  await logActivite(req.user.id, 'Statut eleve modifie', `ID:${id} -> ${statut}`, req.ip);
  res.json({ success: true });
});

// POST /api/eleves/:id/retrograder
// L'eleve reste statut='actif' (un redoublant est un eleve actif comme un autre : il doit
// rester visible dans la liste generale, dans la liste de sa nouvelle classe et dans la
// recherche rapide de la Caisse). Seul le flag redoublant=1 marque qu'il refait sa classe
// cette annee ; ce flag est remis a 0 automatiquement a la prochaine promotion.
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
    `UPDATE eleves SET classe_id=?, redoublant=1, frais_scolarite_total=?, frais_inscription_total=? WHERE id=?`,
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
