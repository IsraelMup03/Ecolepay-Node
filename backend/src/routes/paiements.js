const express = require('express');
const db = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { genererReferencePaiement, logActivite, getEcole, getParam } = require('../utils/helpers');
const { newWorkbook, addLetterhead, addTable, sendWorkbook } = require('../utils/excelReport');

const router = express.Router();

// GET /api/paiements/:id/verify  (verification du recu public)
router.get('/:id/verify', async (req, res) => {
  const { id } = req.params;
  const [[p]] = await db.query(
    `SELECT p.*, e.nom as e_nom, e.prenom as e_prenom, e.matricule, c.nom as classe, u.prenom as cpt_prenom, u.nom as cpt_nom
     FROM paiements p JOIN eleves e ON e.id=p.eleve_id JOIN classes c ON c.id=e.classe_id
     LEFT JOIN utilisateurs u ON u.id=p.comptable_id
     WHERE p.id=?`,
    [id]
  );
  if (!p) return res.status(404).json({ error: 'Reçu introuvable.' });

  const ecole = await getEcole();
  res.json({ verified: true, paiement: p, ecole });
});

router.use(requireAuth);

// GET /api/paiements  (historique paginé avec filtres ; par defaut limite a l'annee scolaire en cours, ?annee= pour consulter une autre annee)
router.get('/', async (req, res) => {
  const { p = 1, q, classe_id, debut, fin, type, statut = 'valide', annee } = req.query;
  const page = Math.max(1, parseInt(p, 10));
  const perPage = 25;
  const offset = (page - 1) * perPage;
  const anneeFiltre = annee || await getParam('annee_scolaire_courante');

  const where = ['1=1'];
  const params = [];
  if (q) { where.push('(e.nom LIKE ? OR e.prenom LIKE ? OR p.reference LIKE ? OR e.matricule LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (classe_id) { where.push('e.classe_id=?'); params.push(classe_id); }
  if (anneeFiltre) { where.push('p.annee_scolaire=?'); params.push(anneeFiltre); }
  if (debut) { where.push('DATE(p.date_paiement)>=?'); params.push(debut); }
  if (fin) { where.push('DATE(p.date_paiement)<=?'); params.push(fin); }
  if (type) { where.push('p.type_paiement=?'); params.push(type); }
  if (statut && statut !== 'tous') { where.push('p.statut=?'); params.push(statut); }
  const whereStr = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) as total FROM paiements p JOIN eleves e ON e.id=p.eleve_id ${whereStr}`, params
  );
  const [[{ somme }]] = await db.query(
    `SELECT COALESCE(SUM(p.montant_usd),0) as somme FROM paiements p JOIN eleves e ON e.id=p.eleve_id ${whereStr}`, params
  );
  const [rows] = await db.query(
    `SELECT p.*, e.nom, e.prenom, e.matricule, c.nom as classe, u.prenom as cpt_prenom, u.nom as cpt_nom,
            COALESCE((SELECT SUM(r.montant_usd) FROM remboursements r WHERE r.paiement_id=p.id AND r.statut='approuve'),0) as montant_rembourse_usd
     FROM paiements p JOIN eleves e ON e.id=p.eleve_id JOIN classes c ON c.id=e.classe_id
     LEFT JOIN utilisateurs u ON u.id=p.comptable_id
     ${whereStr} ORDER BY p.date_paiement DESC LIMIT ${perPage} OFFSET ${offset}`,
    params
  );

  res.json({ paiements: rows, total, somme, page, totalPages: Math.ceil(total / perPage) });
});

// GET /api/paiements/export.xlsx  (memes filtres que la liste, sans pagination)
router.get('/export.xlsx', async (req, res) => {
  try {
    const { q, classe_id, debut, fin, type, statut = 'valide', annee, devise: deviseQ } = req.query;
    const anneeFiltre = annee || await getParam('annee_scolaire_courante');

    const where = ['1=1'];
    const params = [];
    if (q) { where.push('(e.nom LIKE ? OR e.prenom LIKE ? OR p.reference LIKE ? OR e.matricule LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    if (classe_id) { where.push('e.classe_id=?'); params.push(classe_id); }
    if (anneeFiltre) { where.push('p.annee_scolaire=?'); params.push(anneeFiltre); }
    if (debut) { where.push('DATE(p.date_paiement)>=?'); params.push(debut); }
    if (fin) { where.push('DATE(p.date_paiement)<=?'); params.push(fin); }
    if (type) { where.push('p.type_paiement=?'); params.push(type); }
    if (statut && statut !== 'tous') { where.push('p.statut=?'); params.push(statut); }
    const whereStr = `WHERE ${where.join(' AND ')}`;

    const [rows] = await db.query(
      `SELECT p.reference, p.montant_usd, p.type_paiement, p.mode_paiement, p.statut, p.date_paiement,
              e.matricule, e.nom, e.prenom, c.nom as classe, u.prenom as cpt_prenom, u.nom as cpt_nom,
              COALESCE((SELECT SUM(r.montant_usd) FROM remboursements r WHERE r.paiement_id=p.id AND r.statut='approuve'),0) as montant_rembourse_usd
       FROM paiements p JOIN eleves e ON e.id=p.eleve_id JOIN classes c ON c.id=e.classe_id
       LEFT JOIN utilisateurs u ON u.id=p.comptable_id
       ${whereStr} ORDER BY p.date_paiement DESC`,
      params
    );

    const MODE_LABELS = { especes: 'Espèces', mobile_money: 'Mobile Money', virement: 'Virement', cheque: 'Chèque' };
    const MOTIF_LABELS = { scolarite: 'Scolarité', inscription: 'Inscription', uniforme: 'Uniforme', fournitures: 'Fournitures', cantine: 'Cantine', transport: 'Transport', excursion: 'Excursion', examen: 'Examen', assurance: 'Assurance', activites: 'Activités', autre: 'Autre' };
    const ecole = await getEcole();
    const devise = deviseQ === 'CDF' || (deviseQ && deviseQ !== 'USD') ? deviseQ : 'USD';
    const taux = parseFloat(await getParam('taux_usd_cdf', '1')) || 1;
    const workbook = newWorkbook();
    const sheet = workbook.addWorksheet('Paiements', { views: [{ state: 'frozen', ySplit: 8 }] });
    const columns = [
      { header: 'Référence', key: 'reference', width: 22, type: 'text' },
      { header: 'Élève', key: 'eleve', width: 24, type: 'text' },
      { header: 'Matricule', key: 'matricule', width: 16, type: 'text' },
      { header: 'Classe', key: 'classe', width: 22, type: 'text' },
      { header: 'Motif', key: 'motif', width: 16, type: 'text' },
      { header: 'Mode', key: 'mode', width: 16, type: 'text' },
      { header: 'Statut', key: 'statut', width: 14, type: 'text' },
      { header: 'Montant', key: 'montant', width: 16, type: 'currency', totalize: true },
      { header: 'Remboursement', key: 'remb', width: 22, type: 'text' },
      { header: 'Date', key: 'date', width: 18, type: 'text' },
      { header: 'Encaissé par', key: 'encaisse_par', width: 20, type: 'text' },
    ];
    const nextRow = addLetterhead(sheet, {
      ecole, title: `Liste des paiements — Année ${anneeFiltre}`, subtitle: `${rows.length} paiement(s)`,
      generatedBy: req.user ? `${req.user.prenom || ''} ${req.user.nom || ''}`.trim() : null,
      numCols: columns.length,
    });
    addTable(sheet, nextRow, columns, rows.map((p) => {
      const rembUsd = parseFloat(p.montant_rembourse_usd) || 0;
      const rembAffiche = devise === 'CDF' ? rembUsd * taux : rembUsd;
      const rembLabel = devise === 'CDF' ? 'FC' : 'USD';
      return {
        reference: p.reference, eleve: `${p.prenom} ${p.nom}`, matricule: p.matricule, classe: p.classe || '—',
        motif: MOTIF_LABELS[p.type_paiement] || p.type_paiement, mode: MODE_LABELS[p.mode_paiement] || p.mode_paiement,
        statut: p.statut, montant: parseFloat(p.montant_usd) || 0,
        remb: rembUsd > 0 ? `Remboursé de ${rembAffiche.toLocaleString('fr-FR', { maximumFractionDigits: devise === 'CDF' ? 0 : 2 })} ${rembLabel}` : '—',
        date: new Date(p.date_paiement).toLocaleString('fr-FR'),
        encaisse_par: p.cpt_prenom ? `${p.cpt_prenom} ${p.cpt_nom}` : '—',
      };
    }), { showTotals: true, devise, taux });

    await sendWorkbook(res, workbook, `paiements_${anneeFiltre}_${Date.now()}.xlsx`);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la generation du rapport.' });
  }
});

// GET /api/paiements/by-reference?ref=  (remplace api/get_paiement.php)
router.get('/by-reference', async (req, res) => {
  const ref = (req.query.ref || '').trim();
  if (!ref) return res.json(null);
  const [[p]] = await db.query(
    `SELECT p.id, p.reference, p.montant, p.devise, p.montant_usd, p.statut, p.date_paiement,
            e.nom, e.prenom, e.matricule
     FROM paiements p JOIN eleves e ON e.id=p.eleve_id
     WHERE p.reference=? AND p.statut='valide'`,
    [ref]
  );
  res.json(p || null);
});

// GET /api/paiements/:id/recu  (donnees du recu imprimable)
router.get('/:id/recu', async (req, res) => {
  const { id } = req.params;
  const marquerImprime = req.query.new !== undefined;

  const [[p]] = await db.query(
    `SELECT p.*, e.nom as e_nom, e.prenom as e_prenom, e.matricule, e.genre,
            e.nom_parent, e.telephone_parent, e.annee_scolaire as e_annee, e.frais_scolarite_total,
            c.nom as classe, u.prenom as cpt_prenom, u.nom as cpt_nom,
            COALESCE((SELECT SUM(p2.montant_usd) FROM paiements p2 WHERE p2.eleve_id=e.id AND p2.statut='valide' AND p2.type_paiement=p.type_paiement),0) as total_type_paye_usd
     FROM paiements p JOIN eleves e ON e.id=p.eleve_id JOIN classes c ON c.id=e.classe_id
     LEFT JOIN utilisateurs u ON u.id=p.comptable_id
     WHERE p.id=?`,
    [id]
  );
  if (!p) return res.status(404).json({ error: 'Paiement introuvable.' });

  const resteApres = Math.max(0, p.frais_scolarite_total - p.total_type_paye_usd);
  const pctPaye = p.frais_scolarite_total > 0 ? Math.min(100, Math.round((p.total_type_paye_usd / p.frais_scolarite_total) * 100)) : 0;

  if (marquerImprime) {
    await db.query('UPDATE paiements SET imprime=1 WHERE id=?', [id]);
  }

  const ecole = await getEcole();
  res.json({ paiement: p, resteApres, pctPaye, ecole });
});

// (route de vérification déjà définie en début de fichier)

// POST /api/paiements  (enregistrement d'un paiement - equivalent caisse.php)
router.post('/', requirePermission('paiements'), async (req, res) => {
  try {
    const { eleve_id, montant, devise, type_paiement = 'scolarite', mode_paiement = 'especes', periode, description } = req.body;

    const eleveId = parseInt(eleve_id, 10);
    let montantSaisi = parseFloat(montant);
    if (!eleveId || !(montantSaisi > 0)) {
      return res.status(400).json({ error: 'Veuillez saisir un montant valide.' });
    }

    const ecole = await getEcole();
    const devPrincipale = ecole?.devise || 'USD';
    const deviseSaisie = devise || devPrincipale;
    const taux = parseFloat(await getParam('taux_usd_cdf', '2800'));
    const annee = await getParam('annee_scolaire_courante');

    let montantUSD, montantCDF;
    if (deviseSaisie === 'CDF') {
      montantUSD = taux > 0 ? montantSaisi / taux : montantSaisi;
      montantCDF = montantSaisi;
    } else {
      montantUSD = montantSaisi;
      montantCDF = montantSaisi * taux;
    }

    // La scolarite ne peut pas etre payee au-dela du montant attendu pour la classe : si le
    // montant saisi depasse ce qu'il reste a payer, on n'enregistre que le reste du. Le surplus
    // (en USD, la devise canonique) est conserve sur la transaction elle-meme (montant_surplus)
    // au lieu d'etre simplement renvoye puis perdu : il reste visible sur la fiche de l'eleve et
    // remboursable tant qu'il n'a pas ete rendu (surplus_rembourse).
    let surplus = 0;
    let surplusUSD = 0;
    if (type_paiement === 'scolarite') {
      const [[eleve]] = await db.query('SELECT frais_scolarite_total, annee_scolaire FROM eleves WHERE id=?', [eleveId]);
      if (!eleve) return res.status(400).json({ error: 'Eleve introuvable.' });
      const [[{ dejaPaye }]] = await db.query(
        `SELECT COALESCE(SUM(montant_usd),0) as dejaPaye FROM paiements
         WHERE eleve_id=? AND statut='valide' AND type_paiement='scolarite' AND annee_scolaire=?`,
        [eleveId, eleve.annee_scolaire]
      );
      const resteScolarite = Math.max(0, parseFloat(eleve.frais_scolarite_total) - parseFloat(dejaPaye));
      if (resteScolarite <= 0) {
        return res.status(400).json({ error: 'La scolarité de cet élève est déjà entièrement payée.' });
      }
      if (montantUSD > resteScolarite + 0.009) {
        surplusUSD = montantUSD - resteScolarite;
        surplus = deviseSaisie === 'CDF' ? surplusUSD * taux : surplusUSD;
        montantUSD = resteScolarite;
        montantCDF = resteScolarite * taux;
        montantSaisi = deviseSaisie === 'CDF' ? montantCDF : montantUSD;
      }
    }

    const reference = genererReferencePaiement();
    const [result] = await db.query(
      `INSERT INTO paiements
         (reference, eleve_id, type_paiement, montant, devise, montant_usd, montant_local, taux_change, mode_paiement, periode, description, comptable_id, annee_scolaire, montant_surplus, date_paiement)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [reference, eleveId, type_paiement, montantSaisi, deviseSaisie, montantUSD, montantCDF, taux, mode_paiement, periode || null, description || null, req.user.id, annee, surplusUSD]
    );

    await logActivite(req.user.id, 'Paiement enregistre', `Ref:${reference} Eleve:${eleveId} Montant:${montantSaisi} ${deviseSaisie} = ${montantUSD.toFixed(2)} USD${surplus > 0 ? ` (surplus a rembourser: ${surplus.toFixed(2)} ${deviseSaisie})` : ''}`, req.ip);

    res.status(201).json({
      id: result.insertId, reference,
      ...(surplus > 0 ? { surplus: Math.round(surplus * 100) / 100, surplusDevise: deviseSaisie } : {}),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement du paiement.' });
  }
});

// POST /api/paiements/:id/surplus-rembourse  (marque le surplus d'une transaction comme rendu)
router.post('/:id/surplus-rembourse', requirePermission('paiements'), async (req, res) => {
  const { id } = req.params;
  const [[p]] = await db.query('SELECT id, montant_surplus, surplus_rembourse FROM paiements WHERE id=?', [id]);
  if (!p) return res.status(404).json({ error: 'Paiement introuvable.' });
  if (!(parseFloat(p.montant_surplus) > 0)) return res.status(400).json({ error: "Ce paiement n'a pas de surplus a rendre." });
  if (p.surplus_rembourse) return res.status(400).json({ error: 'Ce surplus a deja ete rendu.' });
  await db.query('UPDATE paiements SET surplus_rembourse=1 WHERE id=?', [id]);
  await logActivite(req.user.id, 'Surplus rendu', `Paiement ID:${id} - ${p.montant_surplus} USD`, req.ip);
  res.json({ success: true });
});

module.exports = router;
