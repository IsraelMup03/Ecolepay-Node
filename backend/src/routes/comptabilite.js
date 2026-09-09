const express = require('express');
const db = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivite, envoyerCorbeille, getParam, getEcole } = require('../utils/helpers');
const { newWorkbook, addLetterhead, addTable, addRepartitionDevise, montantSaisiTexte, sendWorkbook, deviseLabel } = require('../utils/excelReport');

const router = express.Router();
router.use(requireAuth, requirePermission('comptabilite'));

// Somme + repartition par devise reellement saisie pour une liste filtree (depenses ou
// recettes_diverses, memes conventions, ni l'une ni l'autre n'a de notion de surplus).
async function sommeEtRepartition(table, alias, whereStr, params) {
  const [[row]] = await db.query(
    `SELECT COALESCE(SUM(${alias}.montant_usd),0) as somme,
            COALESCE(SUM(CASE WHEN COALESCE(${alias}.devise,'USD')='USD' THEN ${alias}.montant_usd ELSE 0 END),0) as usd,
            COALESCE(SUM(CASE WHEN COALESCE(${alias}.devise,'USD')='CDF' THEN ${alias}.montant ELSE 0 END),0) as cdf,
            COALESCE(SUM(CASE WHEN COALESCE(${alias}.devise,'USD')='CDF' THEN ${alias}.montant_usd ELSE 0 END),0) as cdfEnUsd
     FROM ${table} ${alias} ${whereStr}`,
    params
  );
  return {
    somme: parseFloat(row.somme) || 0,
    sommeParDevise: { usd: parseFloat(row.usd) || 0, cdf: parseFloat(row.cdf) || 0, cdfEnUsd: parseFloat(row.cdfEnUsd) || 0 },
  };
}

const CATEGORIES = {
  salaires: 'Salaires', loyer: 'Loyer', electricite: 'Électricité', eau: 'Eau',
  entretien: 'Entretien / Réparations', fournitures: 'Fournitures de bureau', materiel: 'Matériel pédagogique',
  transport: 'Transport', communication: 'Communication', evenements: 'Événements scolaires',
  impots: 'Impôts / Taxes', autre: 'Autre',
};
// Recettes qui n'arrivent pas via un paiement d'eleve (subventions, dons...).
const CATEGORIES_RECETTES = {
  subvention: 'Subvention', don: 'Don', vente: 'Vente de biens/services',
  location: 'Location de salle/matériel', autre: 'Autre',
};
const MODE_LABELS = { especes: 'Espèces', mobile_money: 'Mobile Money', virement: 'Virement', cheque: 'Chèque' };

function genererReferenceDepense() {
  const d = new Date();
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(-6).toUpperCase();
  return `DEP-${y}${m}${day}-${rand}`;
}

function genererReferenceRecette() {
  const d = new Date();
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(-6).toUpperCase();
  return `REC-${y}${m}${day}-${rand}`;
}

// GET /api/comptabilite/categories
router.get('/categories', (req, res) => res.json(CATEGORIES));

// GET /api/comptabilite/categories-recettes
router.get('/categories-recettes', (req, res) => res.json(CATEGORIES_RECETTES));

// GET /api/comptabilite/resume?annee=&debut=&fin=  (recettes vs depenses, pour les graphiques)
router.get('/resume', async (req, res) => {
  const { annee, debut, fin } = req.query;
  const anneeCourante = await getParam('annee_scolaire_courante');
  const anneeCible = annee || anneeCourante;
  const modeHistorique = !!(annee && annee !== anneeCourante);

  const whereRecettes = ["p.statut='valide'", 'p.annee_scolaire=?'];
  const paramsRecettes = [anneeCible];
  const whereDepenses = ['d.annee_scolaire=?'];
  const paramsDepenses = [anneeCible];
  const whereRecettesDiverses = ['r.annee_scolaire=?'];
  const paramsRecettesDiverses = [anneeCible];
  if (!modeHistorique) {
    if (debut) {
      whereRecettes.push('DATE(p.date_paiement)>=?'); paramsRecettes.push(debut);
      whereDepenses.push('DATE(d.date_depense)>=?'); paramsDepenses.push(debut);
      whereRecettesDiverses.push('DATE(r.date_recette)>=?'); paramsRecettesDiverses.push(debut);
    }
    if (fin) {
      whereRecettes.push('DATE(p.date_paiement)<=?'); paramsRecettes.push(fin);
      whereDepenses.push('DATE(d.date_depense)<=?'); paramsDepenses.push(fin);
      whereRecettesDiverses.push('DATE(r.date_recette)<=?'); paramsRecettesDiverses.push(fin);
    }
  }

  // montant_usd + montant_surplus : les recettes doivent refleter l'argent reellement recu
  // en caisse, surplus (pas encore rendu) compris -- voir le meme choix dans dashboard.js.
  // Repartition par devise saisie : le surplus est toujours en USD (voir schema), ajoute
  // inconditionnellement au panier USD plutot que partitionne par p.devise.
  const [[recettesTotal]] = await db.query(
    `SELECT COALESCE(SUM(p.montant_usd + p.montant_surplus * (1 - p.surplus_rembourse)),0) as total, COUNT(*) as nb,
            COALESCE(SUM(CASE WHEN COALESCE(p.devise,'USD')='USD' THEN p.montant_usd ELSE 0 END),0) as usd_natif_base,
            COALESCE(SUM(p.montant_surplus * (1 - p.surplus_rembourse)),0) as surplus_total,
            COALESCE(SUM(CASE WHEN COALESCE(p.devise,'USD')='CDF' THEN p.montant ELSE 0 END),0) as cdf_natif,
            COALESCE(SUM(CASE WHEN COALESCE(p.devise,'USD')='CDF' THEN p.montant_usd ELSE 0 END),0) as cdf_natif_equiv_usd
     FROM paiements p WHERE ${whereRecettes.join(' AND ')}`,
    paramsRecettes
  );
  const [[depensesTotal]] = await db.query(
    `SELECT COALESCE(SUM(d.montant_usd),0) as total, COUNT(*) as nb,
            COALESCE(SUM(CASE WHEN COALESCE(d.devise,'USD')='USD' THEN d.montant_usd ELSE 0 END),0) as usd_natif,
            COALESCE(SUM(CASE WHEN COALESCE(d.devise,'USD')='CDF' THEN d.montant ELSE 0 END),0) as cdf_natif,
            COALESCE(SUM(CASE WHEN COALESCE(d.devise,'USD')='CDF' THEN d.montant_usd ELSE 0 END),0) as cdf_natif_equiv_usd
     FROM depenses d WHERE ${whereDepenses.join(' AND ')}`,
    paramsDepenses
  );
  // Recettes diverses (hors paiements d'eleves) : doivent s'ajouter au total des recettes
  // partout ou celui-ci est affiche, sinon une entree manuelle serait invisible ici.
  const [[recettesDiversesTotal]] = await db.query(
    `SELECT COALESCE(SUM(r.montant_usd),0) as total, COUNT(*) as nb,
            COALESCE(SUM(CASE WHEN COALESCE(r.devise,'USD')='USD' THEN r.montant_usd ELSE 0 END),0) as usd_natif,
            COALESCE(SUM(CASE WHEN COALESCE(r.devise,'USD')='CDF' THEN r.montant ELSE 0 END),0) as cdf_natif,
            COALESCE(SUM(CASE WHEN COALESCE(r.devise,'USD')='CDF' THEN r.montant_usd ELSE 0 END),0) as cdf_natif_equiv_usd
     FROM recettes_diverses r WHERE ${whereRecettesDiverses.join(' AND ')}`,
    paramsRecettesDiverses
  );
  const recettesUsdNatif = (parseFloat(recettesTotal.usd_natif_base) || 0) + (parseFloat(recettesTotal.surplus_total) || 0);
  const recettesParDevise = {
    usd: recettesUsdNatif + (parseFloat(recettesDiversesTotal.usd_natif) || 0),
    cdf: (parseFloat(recettesTotal.cdf_natif) || 0) + (parseFloat(recettesDiversesTotal.cdf_natif) || 0),
    cdfEnUsd: (parseFloat(recettesTotal.cdf_natif_equiv_usd) || 0) + (parseFloat(recettesDiversesTotal.cdf_natif_equiv_usd) || 0),
  };
  const depensesParDevise = {
    usd: parseFloat(depensesTotal.usd_natif) || 0,
    cdf: parseFloat(depensesTotal.cdf_natif) || 0,
    cdfEnUsd: parseFloat(depensesTotal.cdf_natif_equiv_usd) || 0,
  };
  const soldeParDevise = {
    usd: recettesParDevise.usd - depensesParDevise.usd,
    cdf: recettesParDevise.cdf - depensesParDevise.cdf,
    cdfEnUsd: recettesParDevise.cdfEnUsd - depensesParDevise.cdfEnUsd,
  };

  const [depensesParCategorie] = await db.query(
    `SELECT d.categorie, COUNT(*) as nb, SUM(d.montant_usd) as total FROM depenses d WHERE ${whereDepenses.join(' AND ')} GROUP BY d.categorie ORDER BY total DESC`,
    paramsDepenses
  );
  const [recettesDiversesParCategorie] = await db.query(
    `SELECT r.categorie, COUNT(*) as nb, SUM(r.montant_usd) as total FROM recettes_diverses r WHERE ${whereRecettesDiverses.join(' AND ')} GROUP BY r.categorie ORDER BY total DESC`,
    paramsRecettesDiverses
  );

  const [recettesParMois] = await db.query(
    `SELECT DATE_FORMAT(p.date_paiement,'%Y-%m') as mk, DATE_FORMAT(p.date_paiement,'%b %Y') as lbl, SUM(p.montant_usd + p.montant_surplus * (1 - p.surplus_rembourse)) as total
     FROM paiements p WHERE ${whereRecettes.join(' AND ')} GROUP BY DATE_FORMAT(p.date_paiement,'%Y-%m') ORDER BY mk ASC`,
    paramsRecettes
  );
  const [depensesParMois] = await db.query(
    `SELECT DATE_FORMAT(d.date_depense,'%Y-%m') as mk, DATE_FORMAT(d.date_depense,'%b %Y') as lbl, SUM(d.montant_usd) as total
     FROM depenses d WHERE ${whereDepenses.join(' AND ')} GROUP BY DATE_FORMAT(d.date_depense,'%Y-%m') ORDER BY mk ASC`,
    paramsDepenses
  );
  const [recettesDiversesParMois] = await db.query(
    `SELECT DATE_FORMAT(r.date_recette,'%Y-%m') as mk, DATE_FORMAT(r.date_recette,'%b %Y') as lbl, SUM(r.montant_usd) as total
     FROM recettes_diverses r WHERE ${whereRecettesDiverses.join(' AND ')} GROUP BY DATE_FORMAT(r.date_recette,'%Y-%m') ORDER BY mk ASC`,
    paramsRecettesDiverses
  );
  // Fusionne recettes (paiements + recettes diverses) / depenses sur les memes mois pour le
  // graphique combine. Important : "+=" et jamais "=" sur .recettes, sinon la 2e source
  // ecraserait le total paiements d'un mois qui a aussi une recette diverse ce mois-la.
  const moisMap = new Map();
  recettesParMois.forEach((r) => moisMap.set(r.mk, { mk: r.mk, lbl: r.lbl, recettes: parseFloat(r.total) || 0, depenses: 0 }));
  recettesDiversesParMois.forEach((r) => {
    if (!moisMap.has(r.mk)) moisMap.set(r.mk, { mk: r.mk, lbl: r.lbl, recettes: 0, depenses: 0 });
    moisMap.get(r.mk).recettes += parseFloat(r.total) || 0;
  });
  depensesParMois.forEach((d) => {
    if (!moisMap.has(d.mk)) moisMap.set(d.mk, { mk: d.mk, lbl: d.lbl, recettes: 0, depenses: 0 });
    moisMap.get(d.mk).depenses = parseFloat(d.total) || 0;
  });
  const evolution = [...moisMap.values()].sort((a, b) => a.mk.localeCompare(b.mk));

  res.json({
    annee: anneeCible,
    modeHistorique,
    totalRecettes: (parseFloat(recettesTotal.total) || 0) + (parseFloat(recettesDiversesTotal.total) || 0),
    totalRecettesParDevise: recettesParDevise,
    nbRecettes: recettesTotal.nb + recettesDiversesTotal.nb,
    totalDepenses: parseFloat(depensesTotal.total) || 0,
    totalDepensesParDevise: depensesParDevise,
    nbDepenses: depensesTotal.nb,
    solde: (parseFloat(recettesTotal.total) || 0) + (parseFloat(recettesDiversesTotal.total) || 0) - (parseFloat(depensesTotal.total) || 0),
    soldeParDevise,
    depensesParCategorie: depensesParCategorie.map((c) => ({ categorie: CATEGORIES[c.categorie] || c.categorie, nb: c.nb, total: parseFloat(c.total) || 0 })),
    recettesDiversesParCategorie: recettesDiversesParCategorie.map((c) => ({ categorie: CATEGORIES_RECETTES[c.categorie] || c.categorie, nb: c.nb, total: parseFloat(c.total) || 0 })),
    evolution,
    categories: CATEGORIES,
    categoriesRecettes: CATEGORIES_RECETTES,
  });
});

// GET /api/comptabilite/depenses?page=&categorie=&annee=&debut=&fin=&q=
router.get('/depenses', async (req, res) => {
  const { categorie, annee, debut, fin, q } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = 25;
  const offset = (page - 1) * perPage;
  const anneeCourante = await getParam('annee_scolaire_courante');
  const anneeCible = annee || anneeCourante;

  const where = ['d.annee_scolaire=?'];
  const params = [anneeCible];
  if (categorie) { where.push('d.categorie=?'); params.push(categorie); }
  if (debut) { where.push('DATE(d.date_depense)>=?'); params.push(debut); }
  if (fin) { where.push('DATE(d.date_depense)<=?'); params.push(fin); }
  if (q) { where.push('(d.beneficiaire LIKE ? OR d.description LIKE ? OR d.reference LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const whereStr = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM depenses d ${whereStr}`, params);
  const { somme, sommeParDevise } = await sommeEtRepartition('depenses', 'd', whereStr, params);
  const [rows] = await db.query(
    `SELECT d.*, u.prenom as cpt_prenom, u.nom as cpt_nom FROM depenses d LEFT JOIN utilisateurs u ON u.id=d.comptable_id
     ${whereStr} ORDER BY d.date_depense DESC LIMIT ${perPage} OFFSET ${offset}`,
    params
  );
  res.json({ depenses: rows, total, somme, sommeParDevise, page, totalPages: Math.max(1, Math.ceil(total / perPage)) });
});

// POST /api/comptabilite/depenses  (nouvelle sortie)
router.post('/depenses', async (req, res) => {
  const { categorie = 'autre', montant, devise, beneficiaire, description, mode_paiement = 'especes' } = req.body;
  const montantSaisi = parseFloat(montant);
  if (!(montantSaisi > 0)) return res.status(400).json({ error: 'Veuillez saisir un montant valide.' });
  if (!CATEGORIES[categorie]) return res.status(400).json({ error: 'Catégorie invalide.' });

  const ecole = await getEcole();
  const deviseSaisie = devise || ecole?.devise || 'USD';
  const taux = parseFloat(await getParam('taux_usd_cdf', '2800'));
  const annee = await getParam('annee_scolaire_courante');

  let montantUSD, montantCDF;
  if (deviseSaisie === 'CDF') { montantUSD = taux > 0 ? montantSaisi / taux : montantSaisi; montantCDF = montantSaisi; }
  else { montantUSD = montantSaisi; montantCDF = montantSaisi * taux; }

  const reference = genererReferenceDepense();
  const [result] = await db.query(
    `INSERT INTO depenses (reference, categorie, montant, devise, montant_usd, montant_local, taux_change, mode_paiement, beneficiaire, description, comptable_id, annee_scolaire, date_depense)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
    [reference, categorie, montantSaisi, deviseSaisie, montantUSD, montantCDF, taux, mode_paiement, beneficiaire || null, description || null, req.user.id, annee]
  );
  await logActivite(req.user.id, 'Depense enregistree', `Ref:${reference} Categorie:${categorie} Montant:${montantSaisi} ${deviseSaisie}`, req.ip);
  res.status(201).json({ id: result.insertId, reference });
});

// PUT /api/comptabilite/depenses/:id
router.put('/depenses/:id', async (req, res) => {
  const { id } = req.params;
  const { categorie, montant, devise, beneficiaire, description, mode_paiement } = req.body;
  const [[existante]] = await db.query('SELECT * FROM depenses WHERE id=?', [id]);
  if (!existante) return res.status(404).json({ error: 'Dépense introuvable.' });
  if (categorie && !CATEGORIES[categorie]) return res.status(400).json({ error: 'Catégorie invalide.' });

  const montantSaisi = montant !== undefined ? parseFloat(montant) : parseFloat(existante.montant);
  if (!(montantSaisi > 0)) return res.status(400).json({ error: 'Veuillez saisir un montant valide.' });
  const deviseSaisie = devise || existante.devise;
  const taux = parseFloat(existante.taux_change) || parseFloat(await getParam('taux_usd_cdf', '2800'));
  let montantUSD, montantCDF;
  if (deviseSaisie === 'CDF') { montantUSD = taux > 0 ? montantSaisi / taux : montantSaisi; montantCDF = montantSaisi; }
  else { montantUSD = montantSaisi; montantCDF = montantSaisi * taux; }

  await db.query(
    `UPDATE depenses SET categorie=?, montant=?, devise=?, montant_usd=?, montant_local=?, mode_paiement=?, beneficiaire=?, description=? WHERE id=?`,
    [categorie || existante.categorie, montantSaisi, deviseSaisie, montantUSD, montantCDF, mode_paiement || existante.mode_paiement, beneficiaire ?? existante.beneficiaire, description ?? existante.description, id]
  );
  await logActivite(req.user.id, 'Depense modifiee', `ID:${id}`, req.ip);
  const [[updated]] = await db.query('SELECT * FROM depenses WHERE id=?', [id]);
  res.json(updated);
});

// DELETE /api/comptabilite/depenses/:id  (archivage -> corbeille, coherent avec le reste du logiciel)
router.delete('/depenses/:id', async (req, res) => {
  const { id } = req.params;
  const [[data]] = await db.query('SELECT * FROM depenses WHERE id=?', [id]);
  if (!data) return res.status(404).json({ error: 'Dépense introuvable.' });
  await envoyerCorbeille('depenses', data, req.user.id);
  await db.query('DELETE FROM depenses WHERE id=?', [id]);
  await logActivite(req.user.id, 'Depense supprimee', `ID:${id}`, req.ip);
  res.json({ success: true });
});

// GET /api/comptabilite/depenses/export.xlsx
router.get('/depenses/export.xlsx', async (req, res) => {
  try {
    const { categorie, annee, debut, fin, q, devise: deviseQ } = req.query;
    const anneeCourante = await getParam('annee_scolaire_courante');
    const anneeCible = annee || anneeCourante;
    const where = ['d.annee_scolaire=?'];
    const params = [anneeCible];
    if (categorie) { where.push('d.categorie=?'); params.push(categorie); }
    if (debut) { where.push('DATE(d.date_depense)>=?'); params.push(debut); }
    if (fin) { where.push('DATE(d.date_depense)<=?'); params.push(fin); }
    if (q) { where.push('(d.beneficiaire LIKE ? OR d.description LIKE ? OR d.reference LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const whereStr = `WHERE ${where.join(' AND ')}`;

    const [rows] = await db.query(
      `SELECT d.*, u.prenom as cpt_prenom, u.nom as cpt_nom FROM depenses d LEFT JOIN utilisateurs u ON u.id=d.comptable_id
       ${whereStr} ORDER BY d.date_depense DESC`,
      params
    );
    const { sommeParDevise } = await sommeEtRepartition('depenses', 'd', whereStr, params);

    const ecole = await getEcole();
    const devise = deviseQ === 'CDF' || (deviseQ && deviseQ !== 'USD') ? deviseQ : 'USD';
    const taux = parseFloat(await getParam('taux_usd_cdf', '1')) || 1;
    const workbook = newWorkbook();
    const sheet = workbook.addWorksheet('Dépenses', { views: [{ state: 'frozen', ySplit: 8 }] });
    const columns = [
      { header: 'Référence', key: 'reference', width: 22, type: 'text' },
      { header: 'Catégorie', key: 'categorie', width: 22, type: 'text' },
      { header: 'Bénéficiaire', key: 'beneficiaire', width: 22, type: 'text' },
      { header: 'Description', key: 'description', width: 28, type: 'text' },
      { header: 'Mode', key: 'mode', width: 16, type: 'text' },
      { header: 'Montant', key: 'montant', width: 16, type: 'currency', totalize: true },
      { header: 'Montant saisi', key: 'montantSaisi', width: 18, type: 'text' },
      { header: 'Date', key: 'date', width: 18, type: 'text' },
      { header: 'Enregistré par', key: 'comptable', width: 20, type: 'text' },
    ];
    let nextRow = addLetterhead(sheet, {
      ecole, title: `Dépenses — Année ${anneeCible}`, subtitle: `${rows.length} dépense(s)`,
      generatedBy: req.user ? `${req.user.prenom || ''} ${req.user.nom || ''}`.trim() : null,
      numCols: columns.length,
    });
    nextRow = addTable(sheet, nextRow, columns, rows.map((d) => ({
      reference: d.reference, categorie: CATEGORIES[d.categorie] || d.categorie, beneficiaire: d.beneficiaire || '—',
      description: d.description || '—', mode: MODE_LABELS[d.mode_paiement] || d.mode_paiement,
      montant: parseFloat(d.montant_usd) || 0, montantSaisi: montantSaisiTexte(d),
      date: new Date(d.date_depense).toLocaleString('fr-FR'),
      comptable: d.cpt_prenom ? `${d.cpt_prenom} ${d.cpt_nom}` : '—',
    })), { showTotals: true, devise, taux });
    addRepartitionDevise(sheet, nextRow, columns.length, sommeParDevise);

    await sendWorkbook(res, workbook, `depenses_${anneeCible}_${Date.now()}.xlsx`);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la generation du rapport.' });
  }
});

// GET /api/comptabilite/recettes-diverses?page=&categorie=&annee=&debut=&fin=&q=
router.get('/recettes-diverses', async (req, res) => {
  const { categorie, annee, debut, fin, q } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = 25;
  const offset = (page - 1) * perPage;
  const anneeCourante = await getParam('annee_scolaire_courante');
  const anneeCible = annee || anneeCourante;

  const where = ['r.annee_scolaire=?'];
  const params = [anneeCible];
  if (categorie) { where.push('r.categorie=?'); params.push(categorie); }
  if (debut) { where.push('DATE(r.date_recette)>=?'); params.push(debut); }
  if (fin) { where.push('DATE(r.date_recette)<=?'); params.push(fin); }
  if (q) { where.push('(r.provenance LIKE ? OR r.description LIKE ? OR r.reference LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const whereStr = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM recettes_diverses r ${whereStr}`, params);
  const { somme, sommeParDevise } = await sommeEtRepartition('recettes_diverses', 'r', whereStr, params);
  const [rows] = await db.query(
    `SELECT r.*, u.prenom as cpt_prenom, u.nom as cpt_nom FROM recettes_diverses r LEFT JOIN utilisateurs u ON u.id=r.comptable_id
     ${whereStr} ORDER BY r.date_recette DESC LIMIT ${perPage} OFFSET ${offset}`,
    params
  );
  res.json({ recettes: rows, total, somme, sommeParDevise, page, totalPages: Math.max(1, Math.ceil(total / perPage)) });
});

// POST /api/comptabilite/recettes-diverses  (nouvelle entree)
router.post('/recettes-diverses', async (req, res) => {
  const { categorie = 'autre', montant, devise, provenance, description, mode_paiement = 'especes' } = req.body;
  const montantSaisi = parseFloat(montant);
  if (!(montantSaisi > 0)) return res.status(400).json({ error: 'Veuillez saisir un montant valide.' });
  if (!CATEGORIES_RECETTES[categorie]) return res.status(400).json({ error: 'Catégorie invalide.' });

  const ecole = await getEcole();
  const deviseSaisie = devise || ecole?.devise || 'USD';
  const taux = parseFloat(await getParam('taux_usd_cdf', '2800'));
  const annee = await getParam('annee_scolaire_courante');

  let montantUSD, montantCDF;
  if (deviseSaisie === 'CDF') { montantUSD = taux > 0 ? montantSaisi / taux : montantSaisi; montantCDF = montantSaisi; }
  else { montantUSD = montantSaisi; montantCDF = montantSaisi * taux; }

  const reference = genererReferenceRecette();
  const [result] = await db.query(
    `INSERT INTO recettes_diverses (reference, categorie, montant, devise, montant_usd, montant_local, taux_change, mode_paiement, provenance, description, comptable_id, annee_scolaire, date_recette)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
    [reference, categorie, montantSaisi, deviseSaisie, montantUSD, montantCDF, taux, mode_paiement, provenance || null, description || null, req.user.id, annee]
  );
  await logActivite(req.user.id, 'Recette diverse enregistree', `Ref:${reference} Categorie:${categorie} Montant:${montantSaisi} ${deviseSaisie}`, req.ip);
  res.status(201).json({ id: result.insertId, reference });
});

// PUT /api/comptabilite/recettes-diverses/:id
router.put('/recettes-diverses/:id', async (req, res) => {
  const { id } = req.params;
  const { categorie, montant, devise, provenance, description, mode_paiement } = req.body;
  const [[existante]] = await db.query('SELECT * FROM recettes_diverses WHERE id=?', [id]);
  if (!existante) return res.status(404).json({ error: 'Recette introuvable.' });
  if (categorie && !CATEGORIES_RECETTES[categorie]) return res.status(400).json({ error: 'Catégorie invalide.' });

  const montantSaisi = montant !== undefined ? parseFloat(montant) : parseFloat(existante.montant);
  if (!(montantSaisi > 0)) return res.status(400).json({ error: 'Veuillez saisir un montant valide.' });
  const deviseSaisie = devise || existante.devise;
  const taux = parseFloat(existante.taux_change) || parseFloat(await getParam('taux_usd_cdf', '2800'));
  let montantUSD, montantCDF;
  if (deviseSaisie === 'CDF') { montantUSD = taux > 0 ? montantSaisi / taux : montantSaisi; montantCDF = montantSaisi; }
  else { montantUSD = montantSaisi; montantCDF = montantSaisi * taux; }

  await db.query(
    `UPDATE recettes_diverses SET categorie=?, montant=?, devise=?, montant_usd=?, montant_local=?, mode_paiement=?, provenance=?, description=? WHERE id=?`,
    [categorie || existante.categorie, montantSaisi, deviseSaisie, montantUSD, montantCDF, mode_paiement || existante.mode_paiement, provenance ?? existante.provenance, description ?? existante.description, id]
  );
  await logActivite(req.user.id, 'Recette diverse modifiee', `ID:${id}`, req.ip);
  const [[updated]] = await db.query('SELECT * FROM recettes_diverses WHERE id=?', [id]);
  res.json(updated);
});

// DELETE /api/comptabilite/recettes-diverses/:id  (archivage -> corbeille, coherent avec le reste du logiciel)
router.delete('/recettes-diverses/:id', async (req, res) => {
  const { id } = req.params;
  const [[data]] = await db.query('SELECT * FROM recettes_diverses WHERE id=?', [id]);
  if (!data) return res.status(404).json({ error: 'Recette introuvable.' });
  await envoyerCorbeille('recettes_diverses', data, req.user.id);
  await db.query('DELETE FROM recettes_diverses WHERE id=?', [id]);
  await logActivite(req.user.id, 'Recette diverse supprimee', `ID:${id}`, req.ip);
  res.json({ success: true });
});

// GET /api/comptabilite/recettes-diverses/export.xlsx
router.get('/recettes-diverses/export.xlsx', async (req, res) => {
  try {
    const { categorie, annee, debut, fin, q, devise: deviseQ } = req.query;
    const anneeCourante = await getParam('annee_scolaire_courante');
    const anneeCible = annee || anneeCourante;
    const where = ['r.annee_scolaire=?'];
    const params = [anneeCible];
    if (categorie) { where.push('r.categorie=?'); params.push(categorie); }
    if (debut) { where.push('DATE(r.date_recette)>=?'); params.push(debut); }
    if (fin) { where.push('DATE(r.date_recette)<=?'); params.push(fin); }
    if (q) { where.push('(r.provenance LIKE ? OR r.description LIKE ? OR r.reference LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const whereStr = `WHERE ${where.join(' AND ')}`;

    const [rows] = await db.query(
      `SELECT r.*, u.prenom as cpt_prenom, u.nom as cpt_nom FROM recettes_diverses r LEFT JOIN utilisateurs u ON u.id=r.comptable_id
       ${whereStr} ORDER BY r.date_recette DESC`,
      params
    );
    const { sommeParDevise } = await sommeEtRepartition('recettes_diverses', 'r', whereStr, params);

    const ecole = await getEcole();
    const devise = deviseQ === 'CDF' || (deviseQ && deviseQ !== 'USD') ? deviseQ : 'USD';
    const taux = parseFloat(await getParam('taux_usd_cdf', '1')) || 1;
    const workbook = newWorkbook();
    const sheet = workbook.addWorksheet('Recettes diverses', { views: [{ state: 'frozen', ySplit: 8 }] });
    const columns = [
      { header: 'Référence', key: 'reference', width: 22, type: 'text' },
      { header: 'Catégorie', key: 'categorie', width: 22, type: 'text' },
      { header: 'Provenance', key: 'provenance', width: 22, type: 'text' },
      { header: 'Description', key: 'description', width: 28, type: 'text' },
      { header: 'Mode', key: 'mode', width: 16, type: 'text' },
      { header: 'Montant', key: 'montant', width: 16, type: 'currency', totalize: true },
      { header: 'Montant saisi', key: 'montantSaisi', width: 18, type: 'text' },
      { header: 'Date', key: 'date', width: 18, type: 'text' },
      { header: 'Enregistré par', key: 'comptable', width: 20, type: 'text' },
    ];
    let nextRow = addLetterhead(sheet, {
      ecole, title: `Recettes diverses — Année ${anneeCible}`, subtitle: `${rows.length} recette(s)`,
      generatedBy: req.user ? `${req.user.prenom || ''} ${req.user.nom || ''}`.trim() : null,
      numCols: columns.length,
    });
    nextRow = addTable(sheet, nextRow, columns, rows.map((r) => ({
      reference: r.reference, categorie: CATEGORIES_RECETTES[r.categorie] || r.categorie, provenance: r.provenance || '—',
      description: r.description || '—', mode: MODE_LABELS[r.mode_paiement] || r.mode_paiement,
      montant: parseFloat(r.montant_usd) || 0, montantSaisi: montantSaisiTexte(r),
      date: new Date(r.date_recette).toLocaleString('fr-FR'),
      comptable: r.cpt_prenom ? `${r.cpt_prenom} ${r.cpt_nom}` : '—',
    })), { showTotals: true, devise, taux });
    addRepartitionDevise(sheet, nextRow, columns.length, sommeParDevise);

    await sendWorkbook(res, workbook, `recettes_diverses_${anneeCible}_${Date.now()}.xlsx`);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la generation du rapport.' });
  }
});

// GET /api/comptabilite/rapport.xlsx?type=jour|semaine|mois&date=  (recettes + depenses combinees)
router.get('/rapport.xlsx', async (req, res) => {
  try {
    const type = ['jour', 'semaine', 'mois'].includes(req.query.type) ? req.query.type : 'jour';
    const refDate = req.query.date ? new Date(`${req.query.date}T00:00:00`) : new Date();
    let debut, fin, labelType;
    if (type === 'jour') {
      debut = new Date(refDate); debut.setHours(0, 0, 0, 0);
      fin = new Date(refDate); fin.setHours(23, 59, 59, 999);
      labelType = 'Rapport comptable journalier';
    } else if (type === 'semaine') {
      const jourSemaine = (refDate.getDay() + 6) % 7;
      debut = new Date(refDate); debut.setDate(refDate.getDate() - jourSemaine); debut.setHours(0, 0, 0, 0);
      fin = new Date(debut); fin.setDate(debut.getDate() + 6); fin.setHours(23, 59, 59, 999);
      labelType = 'Rapport comptable hebdomadaire';
    } else {
      debut = new Date(refDate.getFullYear(), refDate.getMonth(), 1, 0, 0, 0, 0);
      fin = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0, 23, 59, 59, 999);
      labelType = 'Rapport comptable mensuel';
    }
    const sqlFmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    const periodeLabel = type === 'jour' ? debut.toLocaleDateString('fr-FR') : `${debut.toLocaleDateString('fr-FR')} → ${fin.toLocaleDateString('fr-FR')}`;
    const anneeCourante = await getParam('annee_scolaire_courante');

    const [recettes] = await db.query(
      `SELECT p.montant, p.devise, p.montant_usd, p.type_paiement FROM paiements p WHERE p.statut='valide' AND p.annee_scolaire=? AND p.date_paiement BETWEEN ? AND ?`,
      [anneeCourante, sqlFmt(debut), sqlFmt(fin)]
    );
    const [depenses] = await db.query(
      `SELECT d.montant, d.devise, d.montant_usd, d.categorie, d.reference, d.beneficiaire, d.description, d.date_depense, u.prenom as cpt_prenom, u.nom as cpt_nom
       FROM depenses d LEFT JOIN utilisateurs u ON u.id=d.comptable_id
       WHERE d.annee_scolaire=? AND d.date_depense BETWEEN ? AND ?`,
      [anneeCourante, sqlFmt(debut), sqlFmt(fin)]
    );
    const [recettesDiverses] = await db.query(
      `SELECT r.montant, r.devise, r.montant_usd, r.categorie, r.reference, r.provenance, r.description, r.date_recette, u.prenom as cpt_prenom, u.nom as cpt_nom
       FROM recettes_diverses r LEFT JOIN utilisateurs u ON u.id=r.comptable_id
       WHERE r.annee_scolaire=? AND r.date_recette BETWEEN ? AND ?`,
      [anneeCourante, sqlFmt(debut), sqlFmt(fin)]
    );

    // Repartition par devise reellement saisie, en JS a partir des lignes deja chargees
    // (memes conventions que sommeEtRepartition/partitionParDevise ailleurs : usd/cdf = montants
    // natifs, cdfEnUsd = equivalent USD de la part FC).
    function partitionner(lignes) {
      let usd = 0, cdf = 0, cdfEnUsd = 0;
      lignes.forEach((l) => {
        if ((l.devise || 'USD') === 'CDF') { cdf += parseFloat(l.montant) || 0; cdfEnUsd += parseFloat(l.montant_usd) || 0; }
        else { usd += parseFloat(l.montant_usd) || 0; }
      });
      return { usd, cdf, cdfEnUsd };
    }
    const combiner = (...parties) => parties.reduce((acc, p) => ({ usd: acc.usd + p.usd, cdf: acc.cdf + p.cdf, cdfEnUsd: acc.cdfEnUsd + p.cdfEnUsd }), { usd: 0, cdf: 0, cdfEnUsd: 0 });

    const totalRecettes = recettes.reduce((s, r) => s + (parseFloat(r.montant_usd) || 0), 0)
      + recettesDiverses.reduce((s, r) => s + (parseFloat(r.montant_usd) || 0), 0);
    const totalDepenses = depenses.reduce((s, d) => s + (parseFloat(d.montant_usd) || 0), 0);
    const totalRecettesParDevise = combiner(partitionner(recettes), partitionner(recettesDiverses));
    const totalDepensesParDevise = partitionner(depenses);
    const ecole = await getEcole();
    const { devise: deviseQ } = req.query;
    const devise = deviseQ === 'CDF' || (deviseQ && deviseQ !== 'USD') ? deviseQ : 'USD';
    const taux = parseFloat(await getParam('taux_usd_cdf', '1')) || 1;
    const generatedBy = req.user ? `${req.user.prenom || ''} ${req.user.nom || ''}`.trim() : null;

    const workbook = newWorkbook();
    const resume = workbook.addWorksheet('Résumé');
    const soldeAffiche = devise === 'USD' ? (totalRecettes - totalDepenses) : (totalRecettes - totalDepenses) * taux;
    let r = addLetterhead(resume, {
      ecole, title: `${labelType} — ${periodeLabel}`,
      subtitle: `Recettes : ${(devise === 'USD' ? totalRecettes : totalRecettes * taux).toLocaleString('fr-FR', { maximumFractionDigits: devise === 'USD' ? 2 : 0 })} ${deviseLabel(devise)}  •  Dépenses : ${(devise === 'USD' ? totalDepenses : totalDepenses * taux).toLocaleString('fr-FR', { maximumFractionDigits: devise === 'USD' ? 2 : 0 })} ${deviseLabel(devise)}  •  Solde : ${soldeAffiche.toLocaleString('fr-FR', { maximumFractionDigits: devise === 'USD' ? 2 : 0 })} ${deviseLabel(devise)}`,
      generatedBy, numCols: 3,
    });

    r = addRepartitionDevise(resume, r, 3, totalRecettesParDevise, 'Recettes');
    r += 1;

    const parCategorie = {};
    depenses.forEach((d) => { parCategorie[d.categorie] = (parCategorie[d.categorie] || 0) + (parseFloat(d.montant_usd) || 0); });
    r = addTable(resume, r, [
      { header: 'Catégorie de dépense', key: 'categorie', width: 24, type: 'text' },
      { header: 'Total', key: 'total', width: 18, type: 'currency', totalize: true },
    ], Object.entries(parCategorie).map(([cat, total]) => ({ categorie: CATEGORIES[cat] || cat, total })), { showTotals: true, devise, taux });
    r = addRepartitionDevise(resume, r, 3, totalDepensesParDevise, 'Dépenses');

    const detail = workbook.addWorksheet('Détail des dépenses', { views: [{ state: 'frozen', ySplit: 8 }] });
    const detailCols = [
      { header: 'Référence', key: 'reference', width: 22, type: 'text' },
      { header: 'Catégorie', key: 'categorie', width: 22, type: 'text' },
      { header: 'Bénéficiaire', key: 'beneficiaire', width: 22, type: 'text' },
      { header: 'Description', key: 'description', width: 28, type: 'text' },
      { header: 'Montant', key: 'montant', width: 16, type: 'currency', totalize: true },
      { header: 'Montant saisi', key: 'montantSaisi', width: 18, type: 'text' },
      { header: 'Date', key: 'date', width: 18, type: 'text' },
      { header: 'Enregistré par', key: 'comptable', width: 20, type: 'text' },
    ];
    const rDetail = addLetterhead(detail, { ecole, title: `${labelType} — Détail des dépenses`, subtitle: periodeLabel, generatedBy, numCols: detailCols.length });
    const rDetailFin = addTable(detail, rDetail, detailCols, depenses.map((d) => ({
      reference: d.reference, categorie: CATEGORIES[d.categorie] || d.categorie, beneficiaire: d.beneficiaire || '—',
      description: d.description || '—', montant: parseFloat(d.montant_usd) || 0, montantSaisi: montantSaisiTexte(d),
      date: new Date(d.date_depense).toLocaleString('fr-FR'), comptable: d.cpt_prenom ? `${d.cpt_prenom} ${d.cpt_nom}` : '—',
    })), { showTotals: true, devise, taux });
    addRepartitionDevise(detail, rDetailFin, detailCols.length, totalDepensesParDevise);

    if (recettesDiverses.length > 0) {
      const detailRecettes = workbook.addWorksheet('Détail des recettes diverses', { views: [{ state: 'frozen', ySplit: 8 }] });
      const detailRecettesCols = [
        { header: 'Référence', key: 'reference', width: 22, type: 'text' },
        { header: 'Catégorie', key: 'categorie', width: 22, type: 'text' },
        { header: 'Provenance', key: 'provenance', width: 22, type: 'text' },
        { header: 'Description', key: 'description', width: 28, type: 'text' },
        { header: 'Montant', key: 'montant', width: 16, type: 'currency', totalize: true },
        { header: 'Montant saisi', key: 'montantSaisi', width: 18, type: 'text' },
        { header: 'Date', key: 'date', width: 18, type: 'text' },
        { header: 'Enregistré par', key: 'comptable', width: 20, type: 'text' },
      ];
      const rRecettes = addLetterhead(detailRecettes, { ecole, title: `${labelType} — Détail des recettes diverses`, subtitle: periodeLabel, generatedBy, numCols: detailRecettesCols.length });
      const rRecettesFin = addTable(detailRecettes, rRecettes, detailRecettesCols, recettesDiverses.map((r) => ({
        reference: r.reference, categorie: CATEGORIES_RECETTES[r.categorie] || r.categorie, provenance: r.provenance || '—',
        description: r.description || '—', montant: parseFloat(r.montant_usd) || 0, montantSaisi: montantSaisiTexte(r),
        date: new Date(r.date_recette).toLocaleString('fr-FR'), comptable: r.cpt_prenom ? `${r.cpt_prenom} ${r.cpt_nom}` : '—',
      })), { showTotals: true, devise, taux });
      addRepartitionDevise(detailRecettes, rRecettesFin, detailRecettesCols.length, partitionner(recettesDiverses));
    }

    await sendWorkbook(res, workbook, `comptabilite_${type}_${sqlFmt(debut).slice(0, 10)}.xlsx`);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la generation du rapport.' });
  }
});

module.exports = router;
