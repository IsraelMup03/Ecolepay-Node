const express = require('express');
const db = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { genererReferencePaiement, logActivite, getEcole, getParam } = require('../utils/helpers');

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
  if (statut) { where.push('p.statut=?'); params.push(statut); }
  const whereStr = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) as total FROM paiements p JOIN eleves e ON e.id=p.eleve_id ${whereStr}`, params
  );
  const [[{ somme }]] = await db.query(
    `SELECT COALESCE(SUM(p.montant),0) as somme FROM paiements p JOIN eleves e ON e.id=p.eleve_id ${whereStr}`, params
  );
  const [rows] = await db.query(
    `SELECT p.*, e.nom, e.prenom, e.matricule, c.nom as classe, u.prenom as cpt_prenom, u.nom as cpt_nom
     FROM paiements p JOIN eleves e ON e.id=p.eleve_id JOIN classes c ON c.id=e.classe_id
     LEFT JOIN utilisateurs u ON u.id=p.comptable_id
     ${whereStr} ORDER BY p.date_paiement DESC LIMIT ${perPage} OFFSET ${offset}`,
    params
  );

  res.json({ paiements: rows, total, somme, page, totalPages: Math.ceil(total / perPage) });
});

// GET /api/paiements/export.csv  (memes filtres que la liste, sans pagination)
router.get('/export.csv', async (req, res) => {
  try {
    const { q, classe_id, debut, fin, type, statut = 'valide', annee } = req.query;
    const anneeFiltre = annee || await getParam('annee_scolaire_courante');

    const where = ['1=1'];
    const params = [];
    if (q) { where.push('(e.nom LIKE ? OR e.prenom LIKE ? OR p.reference LIKE ? OR e.matricule LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    if (classe_id) { where.push('e.classe_id=?'); params.push(classe_id); }
    if (anneeFiltre) { where.push('p.annee_scolaire=?'); params.push(anneeFiltre); }
    if (debut) { where.push('DATE(p.date_paiement)>=?'); params.push(debut); }
    if (fin) { where.push('DATE(p.date_paiement)<=?'); params.push(fin); }
    if (type) { where.push('p.type_paiement=?'); params.push(type); }
    if (statut) { where.push('p.statut=?'); params.push(statut); }
    const whereStr = `WHERE ${where.join(' AND ')}`;

    const [rows] = await db.query(
      `SELECT p.reference, p.montant, p.devise, p.montant_usd, p.type_paiement, p.mode_paiement, p.statut, p.date_paiement,
              e.matricule, e.nom, e.prenom, c.nom as classe, u.prenom as cpt_prenom, u.nom as cpt_nom
       FROM paiements p JOIN eleves e ON e.id=p.eleve_id JOIN classes c ON c.id=e.classe_id
       LEFT JOIN utilisateurs u ON u.id=p.comptable_id
       ${whereStr} ORDER BY p.date_paiement DESC`,
      params
    );

    const total = rows.reduce((s, r) => s + parseFloat(r.montant_usd || 0), 0);
    const meta = [
      `# Rapport: Liste des paiements (année ${anneeFiltre})`,
      `# Généré le: ${new Date().toLocaleString()}`,
      `# Nombre: ${rows.length} · Total (USD): ${total.toFixed(2)}`,
      '# Colonnes: Reference;Montant;Devise;Montant(USD);Type;Mode;Statut;Date;Matricule;Nom;Prenom;Classe;Encaisse par',
    ];
    const header = ['Reference', 'Montant', 'Devise', 'Montant(USD)', 'Type', 'Mode', 'Statut', 'Date', 'Matricule', 'Nom', 'Prenom', 'Classe', 'Encaisse par'];
    const lines = [header.join(';')];
    rows.forEach((p) => {
      lines.push([
        p.reference, p.montant, p.devise, p.montant_usd, p.type_paiement, p.mode_paiement, p.statut, p.date_paiement,
        p.matricule, p.nom, p.prenom, p.classe, p.cpt_prenom ? `${p.cpt_prenom} ${p.cpt_nom}` : '',
      ].join(';'));
    });

    res.setHeader('Content-Type', 'text/csv; charset=UTF-8');
    res.setHeader('Content-Disposition', `attachment; filename="paiements_${anneeFiltre}_${Date.now()}.csv"`);
    res.send('﻿' + meta.join('\n') + '\n' + lines.join('\n'));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la generation du CSV.' });
  }
});

// GET /api/paiements/by-reference?ref=  (remplace api/get_paiement.php)
router.get('/by-reference', async (req, res) => {
  const ref = (req.query.ref || '').trim();
  if (!ref) return res.json(null);
  const [[p]] = await db.query(
    `SELECT p.id, p.reference, p.montant, p.devise, p.statut, p.date_paiement,
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
  const { eleve_id, montant, devise, type_paiement = 'scolarite', mode_paiement = 'especes', periode, description } = req.body;

  const eleveId = parseInt(eleve_id, 10);
  const montantSaisi = parseFloat(montant);
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

  const reference = genererReferencePaiement();
  const [result] = await db.query(
    `INSERT INTO paiements
       (reference, eleve_id, type_paiement, montant, devise, montant_usd, montant_local, taux_change, mode_paiement, periode, description, comptable_id, annee_scolaire, date_paiement)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
    [reference, eleveId, type_paiement, montantSaisi, deviseSaisie, montantUSD, montantCDF, taux, mode_paiement, periode || null, description || null, req.user.id, annee]
  );

  await logActivite(req.user.id, 'Paiement enregistre', `Ref:${reference} Eleve:${eleveId} Montant:${montantSaisi} ${deviseSaisie} = ${montantUSD.toFixed(2)} USD`, req.ip);

  res.status(201).json({ id: result.insertId, reference });
});

module.exports = router;
