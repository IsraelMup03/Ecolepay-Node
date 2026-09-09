const express = require('express');
const db = require('../config/db');
const { requireAuth, requirePermission, requireAnyPermission, requireAdmin } = require('../middleware/auth');
const { genererMatricule, logActivite, envoyerCorbeille, getParam, getEcole, nomCompletConditions } = require('../utils/helpers');
const { newWorkbook, addLetterhead, addTable, sendWorkbook } = require('../utils/excelReport');

const router = express.Router();
router.use(requireAuth);

// Partitionne un tableau de paiements deja filtre par devise reellement saisie : usd/cdf
// sont les montants NATIFS (ce qui a ete tape), cdfEnUsd est l'equivalent USD de la part
// CDF -- se recombinent toujours exactement au total deja calcule ailleurs (memes lignes,
// juste reparties), pour afficher "900 USD, 220 000 FC (≈100 USD)" sous un total mixte.
function partitionParDevise(paiements) {
  let usd = 0, cdf = 0, cdfEnUsd = 0;
  for (const p of paiements) {
    if ((p.devise || 'USD') === 'CDF') {
      cdf += parseFloat(p.montant) || 0;
      cdfEnUsd += parseFloat(p.montant_usd) || 0;
    } else {
      usd += parseFloat(p.montant_usd || p.montant) || 0;
    }
  }
  return { usd, cdf, cdfEnUsd };
}

// Progression de la scolarite d'un eleve, tranche par tranche (voir classe_tranches) :
// aucun paiement n'est jamais rattache a une tranche precise en base -- l'argent recu
// remplit les tranches dans l'ordre, comme le fait deja le mecanisme de surplus. Chaque
// montant de tranche est ajuste a la remise de l'eleve (meme pourcentage applique
// uniformement sur toutes les tranches) pour que la derniere tranche se termine exactement
// au montant que l'eleve doit reellement (frais_scolarite_total, deja remise).
async function calculerTranches(classeId, remisePourcentage, totalPayeScolarite, fraisScolariteRef) {
  const [tranchesClasse] = await db.query('SELECT numero, montant FROM classe_tranches WHERE classe_id=? ORDER BY numero ASC', [classeId]);
  if (tranchesClasse.length === 0) return [];
  const facteur = 1 - (parseFloat(remisePourcentage) || 0) / 100;
  let cumulAvant = 0;
  const dernier = tranchesClasse.length - 1;
  return tranchesClasse.map((t, i) => {
    const montant = parseFloat(t.montant) * facteur;
    const paye = Math.min(Math.max(totalPayeScolarite - cumulAvant, 0), montant);
    let pct = montant > 0 ? Math.round((paye / montant) * 100) : 0;
    // Force 100% sur la derniere tranche si l'eleve est reellement solde : evite un arrondi
    // flottant (ex: 99%) du au calcul independant de chaque tranche remisee.
    if (i === dernier && totalPayeScolarite >= fraisScolariteRef) pct = 100;
    cumulAvant += montant;
    return { numero: t.numero, montant: Math.round(montant * 100) / 100, paye: Math.round(paye * 100) / 100, pct };
  });
}

// GET /api/eleves?classe_id=&q=&statut=&annee=&page=&limit=  (annee: consulter une annee archivee)
router.get('/', requirePermission('eleves'), async (req, res) => {
  const { classe_id, q, statut = 'actif', redoublant, en_attente_orientation, annee } = req.query;
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
  if (en_attente_orientation) { where.push('e.en_attente_orientation=1'); }
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
    `SELECT e.id, e.nom, e.postnom, e.prenom, e.matricule, e.genre, e.frais_scolarite_total, e.redoublant, e.en_attente_orientation, s.nom as section_nom,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye,
            (SELECT ${dateExpr} FROM paiements p2 WHERE p2.eleve_id=e.id AND p2.statut='valide' ORDER BY p2.date_paiement DESC LIMIT 1) as dernier_paiement_date,
            (SELECT ${payerConcat} FROM paiements p2 JOIN utilisateurs u ON u.id=p2.comptable_id WHERE p2.eleve_id=e.id AND p2.statut='valide') as perce_par
     FROM eleves e LEFT JOIN sections s ON s.id=e.section_id WHERE e.classe_id=? AND e.statut='actif' ORDER BY e.nom ASC, e.prenom ASC`,
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
            cs.nom as classe_sup_nom, ci.nom as classe_inf_nom, s.nom as section_nom
     FROM eleves e JOIN classes c ON c.id=e.classe_id
     LEFT JOIN classes cs ON cs.id=c.classe_superieure_id
     LEFT JOIN classes ci ON ci.id=c.classe_inferieure_id
     LEFT JOIN sections s ON s.id=e.section_id
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

  const paiementsScolariteValides = paiements.filter((p) => p.statut === 'valide' && p.type_paiement === 'scolarite');
  const paiementsInscriptionValides = paiements.filter((p) => p.statut === 'valide' && p.type_paiement === 'inscription');
  const totalPayeScolarite = paiementsScolariteValides.reduce((s, p) => s + parseFloat(p.montant_usd || p.montant), 0);
  const totalPayeInscription = paiementsInscriptionValides.reduce((s, p) => s + parseFloat(p.montant_usd || p.montant), 0);
  const totalPayeScolariteParDevise = partitionParDevise(paiementsScolariteValides);
  const totalPayeInscriptionParDevise = partitionParDevise(paiementsInscriptionValides);
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

  // Sections disponibles pour la classe de l'eleve, seulement utile s'il n'en a pas encore
  // (le formulaire de paiement de cette page doit alors imposer un choix, comme sur Caisse.jsx).
  const [sectionsDisponibles] = (eleve.section_id || modeHistorique)
    ? [[]]
    : await db.query('SELECT id, nom FROM sections WHERE classe_id=? ORDER BY ordre ASC, nom ASC', [eleve.classe_id]);

  const tranches = modeHistorique ? [] : await calculerTranches(eleve.classe_id, eleve.remise_pourcentage, totalPayeScolarite, fraisScolariteRef);

  res.json({
    eleve, paiements, modeHistorique, sectionsDisponibles, tranches,
    totaux: {
      totalPayeScolarite, totalPayeInscription, totalRembourse, totalSurplusNonRendu, resteScolarite, resteInscription, pctScolarite,
      totalPayeScolariteParDevise, totalPayeInscriptionParDevise,
    },
  });
});

// GET /api/eleves/:id/caisse-info (donnees necessaires a la page caisse rapide)
router.get('/:id/caisse-info', requireAnyPermission('paiements', 'eleves'), async (req, res) => {
  const { id } = req.params;
  const [[eleve]] = await db.query(
    `SELECT e.*, c.nom as classe_nom, c.frais_scolarite, c.frais_inscription, s.nom as section_nom,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye_scolarite,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='inscription' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye_inscription,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye_global
     FROM eleves e JOIN classes c ON c.id=e.classe_id LEFT JOIN sections s ON s.id=e.section_id WHERE e.id=?`,
    [id]
  );
  if (!eleve) return res.status(404).json({ error: 'Eleve introuvable.' });
  eleve.reste_scolarite = Math.max(0, eleve.frais_scolarite_total - eleve.total_paye_scolarite);
  eleve.reste_inscription = Math.max(0, eleve.frais_inscription_total - eleve.total_paye_inscription);

  const [[repartScolarite]] = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN COALESCE(devise,'USD')='USD' THEN montant_usd ELSE 0 END),0) as usd,
            COALESCE(SUM(CASE WHEN COALESCE(devise,'USD')='CDF' THEN montant ELSE 0 END),0) as cdf,
            COALESCE(SUM(CASE WHEN COALESCE(devise,'USD')='CDF' THEN montant_usd ELSE 0 END),0) as cdfEnUsd
     FROM paiements WHERE eleve_id=? AND statut='valide' AND type_paiement='scolarite' AND annee_scolaire=?`,
    [id, eleve.annee_scolaire]
  );
  eleve.total_paye_scolarite_par_devise = { usd: parseFloat(repartScolarite.usd) || 0, cdf: parseFloat(repartScolarite.cdf) || 0, cdfEnUsd: parseFloat(repartScolarite.cdfEnUsd) || 0 };

  // Sections disponibles pour cette classe, seulement utile si l'eleve n'en a pas encore
  // (Caisse.jsx doit alors imposer un choix avant le premier paiement scolarite/inscription).
  const [sectionsDisponibles] = eleve.section_id
    ? [[]]
    : await db.query('SELECT id, nom FROM sections WHERE classe_id=? ORDER BY ordre ASC, nom ASC', [eleve.classe_id]);

  const tranches = await calculerTranches(eleve.classe_id, eleve.remise_pourcentage, eleve.total_paye_scolarite, eleve.frais_scolarite_total);

  const [historique] = await db.query(
    `SELECT p.*, u.prenom as c_prenom, u.nom as c_nom,
            COALESCE((SELECT SUM(r.montant_usd) FROM remboursements r WHERE r.paiement_id=p.id AND r.statut='approuve'),0) as montant_rembourse_usd
     FROM paiements p LEFT JOIN utilisateurs u ON u.id=p.comptable_id
     WHERE p.eleve_id=? AND p.annee_scolaire=? ORDER BY p.date_paiement DESC LIMIT 10`,
    [id, eleve.annee_scolaire]
  );
  res.json({ eleve, historique, sectionsDisponibles, tranches });
});

// POST /api/eleves (inscription)
router.post('/', requirePermission('eleves'), async (req, res) => {
  const {
    nom, postnom, prenom, genre = 'M', classe_id, section_id, date_naissance, lieu_naissance,
    nom_parent, telephone_parent, email_parent, adresse,
  } = req.body;

  if (!nom || !prenom || !classe_id) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }

  const [[cls]] = await db.query('SELECT frais_scolarite, frais_inscription FROM classes WHERE id=?', [classe_id]);
  if (!cls) return res.status(400).json({ error: 'Classe invalide.' });

  // Une inscription neuve peut choisir directement sa section (contrairement a un eleve
  // promu, qui atterrit sans section et la choisit a son premier paiement) : on valide
  // simplement qu'elle appartient bien a la classe indiquee.
  let sectionIdValide = null;
  if (section_id) {
    const [[section]] = await db.query('SELECT id FROM sections WHERE id=? AND classe_id=?', [section_id, classe_id]);
    if (!section) return res.status(400).json({ error: 'Section invalide pour cette classe.' });
    sectionIdValide = section.id;
  }

  const annee = await getParam('annee_scolaire_courante');
  const matricule = await genererMatricule();

  const [result] = await db.query(
    `INSERT INTO eleves (matricule,nom,postnom,prenom,genre,date_naissance,lieu_naissance,classe_id,section_id,nom_parent,telephone_parent,email_parent,adresse,statut,date_inscription,annee_scolaire,frais_scolarite_total,frais_inscription_total,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'actif',CURDATE(),?,?,?,?)`,
    [
      matricule, nom, postnom || null, prenom, genre, date_naissance || null, lieu_naissance || null,
      classe_id, sectionIdValide, nom_parent || null, telephone_parent || null, email_parent || null, adresse || null,
      annee, cls.frais_scolarite, cls.frais_inscription, req.user.id,
    ]
  );
  await logActivite(req.user.id, 'Eleve ajoute', `Matricule:${matricule}`, req.ip);
  const [[created]] = await db.query('SELECT * FROM eleves WHERE id=?', [result.insertId]);
  res.status(201).json({ eleve: created, matricule });
});

// PUT /api/eleves/:id (modification)
// Ne touche jamais classe_id/section_id : tout changement de classe doit passer par
// /transferer, /retrograder ou la promotion annuelle, qui synchronisent correctement les
// frais et reinitialisent la section -- laisser ce champ ici le laisserait facilement
// desynchronise (frais herites de l'ancienne classe, section d'une autre classe, etc.).
router.put('/:id', requirePermission('eleves'), async (req, res) => {
  const { id } = req.params;
  const { nom, postnom, prenom, genre, date_naissance, lieu_naissance, nom_parent, telephone_parent, email_parent, adresse, statut } = req.body;
  await db.query(
    `UPDATE eleves SET nom=?,postnom=?,prenom=?,genre=?,date_naissance=?,lieu_naissance=?,nom_parent=?,telephone_parent=?,email_parent=?,adresse=?,statut=? WHERE id=?`,
    [nom, postnom || null, prenom, genre, date_naissance || null, lieu_naissance, nom_parent, telephone_parent, email_parent, adresse, statut, id]
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
  if (statut === 'suspendu') {
    // Visible dans la Corbeille comme toute autre mise a l'ecart, avec une possibilite de
    // restauration a froid par un administrateur -- meme mecanisme que l'archivage, sous un
    // table_source distinct ('eleves_suspendu') pour que la Corbeille l'affiche clairement
    // comme une suspension et non un archivage.
    const [[data]] = await db.query('SELECT * FROM eleves WHERE id=?', [id]);
    if (data) await envoyerCorbeille('eleves_suspendu', data, req.user.id);
  } else {
    // Reactivation directe (hors Corbeille, via le bouton "Reactiver" habituel) : toute
    // entree de corbeille encore en attente pour cet eleve est marquee restauree, sinon elle
    // resterait affichee alors que la situation est deja resolue.
    const [enAttente] = await db.query("SELECT id, donnees FROM corbeille WHERE table_source='eleves_suspendu' AND restaure=0");
    for (const r of enAttente) {
      try {
        if (JSON.parse(r.donnees).id === Number(id)) await db.query('UPDATE corbeille SET restaure=1 WHERE id=?', [r.id]);
      } catch (e) { /* entree corrompue, ignoree */ }
    }
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
    `SELECT e.classe_id, e.remise_pourcentage, c.classe_inferieure_id FROM eleves e JOIN classes c ON c.id=e.classe_id WHERE e.id=?`,
    [id]
  );
  if (!row || !row.classe_inferieure_id) {
    return res.status(400).json({ error: 'Aucune classe inferieure definie pour cette classe.' });
  }
  const [[nci]] = await db.query('SELECT frais_scolarite, frais_inscription FROM classes WHERE id=?', [row.classe_inferieure_id]);
  // La remise deja accordee a l'eleve est conservee (pas reinitialisee) sur son nouveau
  // montant de scolarite. section_id=NULL : l'ancienne section (A/B/C) n'a plus de sens
  // dans la classe inferieure. en_attente_orientation=0 par securite/coherence : quitter
  // une classe (pivot ou non) ne doit jamais laisser une attente de transfert perimee.
  const facteur = 1 - (parseFloat(row.remise_pourcentage) || 0) / 100;
  await db.query(
    `UPDATE eleves SET classe_id=?, section_id=NULL, redoublant=1, frais_scolarite_total=?, frais_inscription_total=?, en_attente_orientation=0 WHERE id=?`,
    [row.classe_inferieure_id, nci.frais_scolarite * facteur, nci.frais_inscription, id]
  );
  await logActivite(req.user.id, 'Eleve retrograde', `ID:${id}`, req.ip);
  res.json({ success: true });
});

// POST /api/eleves/:id/transferer  { classe_id, section_id? }
// Transfert libre vers n'importe quelle classe (contrairement a /retrograder, limite a la
// classe inferieure preconfiguree) : reserve aux administrateurs, puisque c'est un
// mouvement sans pointeur de validation prealable. Ne touche pas au flag redoublant (ce
// n'est pas un redoublement, juste un changement administratif de classe).
router.post('/:id/transferer', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { classe_id, section_id } = req.body;
  if (!classe_id) return res.status(400).json({ error: 'Classe cible requise.' });

  const [[eleve]] = await db.query('SELECT classe_id, remise_pourcentage FROM eleves WHERE id=?', [id]);
  if (!eleve) return res.status(404).json({ error: 'Eleve introuvable.' });
  if (String(eleve.classe_id) === String(classe_id)) {
    return res.status(400).json({ error: 'Cet eleve est deja dans cette classe.' });
  }

  const [[cible]] = await db.query('SELECT frais_scolarite, frais_inscription FROM classes WHERE id=?', [classe_id]);
  if (!cible) return res.status(400).json({ error: 'Classe cible invalide.' });

  let sectionIdValide = null;
  if (section_id) {
    const [[section]] = await db.query('SELECT id FROM sections WHERE id=? AND classe_id=?', [section_id, classe_id]);
    if (!section) return res.status(400).json({ error: 'Section invalide pour la classe cible.' });
    sectionIdValide = section.id;
  }

  // La remise deja accordee a l'eleve est conservee (pas reinitialisee) sur son nouveau
  // montant de scolarite. en_attente_orientation=0 : ce transfert resout precisement
  // l'attente (l'eleve quitte sa classe pivot pour la classe qu'il a choisie).
  const facteur = 1 - (parseFloat(eleve.remise_pourcentage) || 0) / 100;
  await db.query(
    `UPDATE eleves SET classe_id=?, section_id=?, frais_scolarite_total=?, frais_inscription_total=?, en_attente_orientation=0 WHERE id=?`,
    [classe_id, sectionIdValide, cible.frais_scolarite * facteur, cible.frais_inscription, id]
  );
  await logActivite(req.user.id, 'Eleve transfere', `ID:${id} -> Classe ID:${classe_id}`, req.ip);
  res.json({ success: true });
});

// PUT /api/eleves/:id/remise  { remise_pourcentage }
// Remise individuelle (0 a 100) accordee a un eleve, ex: reduction familiale -- s'applique
// uniquement a la scolarite (jamais aux frais d'inscription). Recalcule immediatement
// frais_scolarite_total a partir des frais actuels de la classe de l'eleve.
router.put('/:id/remise', requirePermission('eleves'), async (req, res) => {
  const { id } = req.params;
  const remise = parseFloat(req.body.remise_pourcentage);
  if (!(remise >= 0) || remise > 100) {
    return res.status(400).json({ error: 'La remise doit etre comprise entre 0 et 100.' });
  }
  const [[eleve]] = await db.query('SELECT classe_id FROM eleves WHERE id=?', [id]);
  if (!eleve) return res.status(404).json({ error: 'Eleve introuvable.' });
  const [[cls]] = await db.query('SELECT frais_scolarite FROM classes WHERE id=?', [eleve.classe_id]);

  await db.query(
    'UPDATE eleves SET remise_pourcentage=?, frais_scolarite_total=? WHERE id=?',
    [remise, cls.frais_scolarite * (1 - remise / 100), id]
  );
  await logActivite(req.user.id, 'Remise eleve modifiee', `ID:${id} -> ${remise}%`, req.ip);
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
