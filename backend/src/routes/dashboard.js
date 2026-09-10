const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { getEcole, getParam, hasPermission } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth);

// Fusionne l'evolution mensuelle des paiements et des recettes diverses sur les memes mois
// ("Evolution des encaissements") : un don/une subvention est un encaissement reel comme un
// paiement d'eleve, doit donc y compter -- "+=" et jamais "=" pour ne pas ecraser le total
// paiements d'un mois qui a aussi une recette diverse ce mois-la (meme piege que dans
// comptabilite.js/resume).
// Somme + repartition par devise reellement saisie sur "paiements" pour un WHERE donne : le
// surplus (toujours en USD, voir schema) est ajoute inconditionnellement au panier USD,
// jamais partitionne par la devise de la ligne. Les deux paniers se recombinent toujours
// exactement au total existant (meme expression, juste partitionnee par CASE).
async function paiementsParDevise(whereSql, params) {
  const [[row]] = await db.query(
    `SELECT COALESCE(SUM(montant_usd + montant_surplus*(1-surplus_rembourse)),0) as total,
            COALESCE(SUM(CASE WHEN COALESCE(devise,'USD')='USD' THEN montant_usd ELSE 0 END),0) as usd_natif_base,
            COALESCE(SUM(montant_surplus*(1-surplus_rembourse)),0) as surplus_total,
            COALESCE(SUM(CASE WHEN COALESCE(devise,'USD')='CDF' THEN montant ELSE 0 END),0) as cdf_natif,
            COALESCE(SUM(CASE WHEN COALESCE(devise,'USD')='CDF' THEN montant_usd ELSE 0 END),0) as cdf_natif_equiv_usd
     FROM paiements WHERE ${whereSql}`, params
  );
  const usd = (parseFloat(row.usd_natif_base) || 0) + (parseFloat(row.surplus_total) || 0);
  return { total: parseFloat(row.total) || 0, parDevise: { usd, cdf: parseFloat(row.cdf_natif) || 0, cdfEnUsd: parseFloat(row.cdf_natif_equiv_usd) || 0 } };
}

// Meme principe pour depenses/recettes_diverses (pas de notion de surplus).
async function tableParDevise(table, whereSql, params) {
  const [[row]] = await db.query(
    `SELECT COALESCE(SUM(montant_usd),0) as total,
            COALESCE(SUM(CASE WHEN COALESCE(devise,'USD')='USD' THEN montant_usd ELSE 0 END),0) as usd_natif,
            COALESCE(SUM(CASE WHEN COALESCE(devise,'USD')='CDF' THEN montant ELSE 0 END),0) as cdf_natif,
            COALESCE(SUM(CASE WHEN COALESCE(devise,'USD')='CDF' THEN montant_usd ELSE 0 END),0) as cdf_natif_equiv_usd
     FROM ${table} WHERE ${whereSql}`, params
  );
  return { total: parseFloat(row.total) || 0, parDevise: { usd: parseFloat(row.usd_natif) || 0, cdf: parseFloat(row.cdf_natif) || 0, cdfEnUsd: parseFloat(row.cdf_natif_equiv_usd) || 0 } };
}

function combinerParDevise(...parties) {
  return parties.reduce((acc, p) => ({ usd: acc.usd + p.usd, cdf: acc.cdf + p.cdf, cdfEnUsd: acc.cdfEnUsd + p.cdfEnUsd }), { usd: 0, cdf: 0, cdfEnUsd: 0 });
}

function fusionnerMensuel(paiementsRows, recettesRows) {
  const moisMap = new Map();
  paiementsRows.forEach((m) => moisMap.set(m.mk, { mk: m.mk, lbl: m.lbl, total: parseFloat(m.total) || 0, nb: m.nb }));
  recettesRows.forEach((m) => {
    if (!moisMap.has(m.mk)) moisMap.set(m.mk, { mk: m.mk, lbl: m.lbl, total: 0, nb: 0 });
    const row = moisMap.get(m.mk);
    row.total += parseFloat(m.total) || 0;
    row.nb += m.nb;
  });
  return [...moisMap.values()].sort((a, b) => a.mk.localeCompare(b.mk));
}

// GET /api/dashboard/alertes  (compteurs pour le bandeau de rappel, au-dessus de la barre
// superieure -- pas de requirePermission ici : chaque compteur est calcule seulement si
// l'utilisateur a la permission correspondante, pour eviter d'exposer un chiffre sur une
// tache qu'il ne peut de toute facon pas traiter).
router.get('/alertes', async (req, res) => {
  const annee = await getParam('annee_scolaire_courante');
  let elevesEnAttenteOrientation = 0;
  if (hasPermission(req.user, 'eleves')) {
    const [[row]] = await db.query("SELECT COUNT(*) as n FROM eleves WHERE en_attente_orientation=1 AND statut='actif'");
    elevesEnAttenteOrientation = row.n;
  }
  let remboursementsEnAttente = 0;
  if (hasPermission(req.user, 'remboursements')) {
    const [[demandes]] = await db.query(
      "SELECT COUNT(*) as n FROM remboursements r JOIN paiements p ON p.id=r.paiement_id WHERE r.statut='en_attente' AND p.annee_scolaire=?",
      [annee]
    );
    const [[surplus]] = await db.query(
      "SELECT COUNT(*) as n FROM paiements WHERE annee_scolaire=? AND montant_surplus>0 AND surplus_rembourse=0 AND statut='valide'",
      [annee]
    );
    remboursementsEnAttente = demandes.n + surplus.n;
  }
  res.json({ elevesEnAttenteOrientation, remboursementsEnAttente });
});

// GET /api/dashboard?annee=  (annee: consulter une annee passee, lecture seule)
router.get('/', async (req, res) => {
  const ecole = await getEcole();
  const anneeCourante = await getParam('annee_scolaire_courante');
  const devise = ecole?.devise || 'USD';
  const modeHistorique = !!(req.query.annee && req.query.annee !== anneeCourante);
  const annee = modeHistorique ? req.query.annee : anneeCourante;

  if (modeHistorique) {
    const [[{ totalEleves }]] = await db.query('SELECT COUNT(*) as totalEleves FROM archives_annuelles WHERE annee_scolaire=?', [annee]);
    const [[{ totalFilles }]] = await db.query(
      `SELECT COUNT(*) as totalFilles FROM archives_annuelles a JOIN eleves e ON e.id=a.eleve_id WHERE a.annee_scolaire=? AND e.genre='F'`,
      [annee]
    );
    const [[{ totalGarcons }]] = await db.query(
      `SELECT COUNT(*) as totalGarcons FROM archives_annuelles a JOIN eleves e ON e.id=a.eleve_id WHERE a.annee_scolaire=? AND e.genre='M'`,
      [annee]
    );
    const [[{ totalClasses }]] = await db.query('SELECT COUNT(DISTINCT classe_id) as totalClasses FROM archives_annuelles WHERE annee_scolaire=?', [annee]);
    // montant_usd + montant_surplus : "Total encaisse" doit refleter l'argent reellement
    // recu en caisse, y compris la part en surplus (pas encore rendue a la famille) -- pas
    // seulement la part appliquee a la dette de l'eleve. Voir le meme choix dans le
    // commentaire ci-dessous pour totalAnneeScolarite, qui lui reste volontairement capped.
    const paiementsAnnee = await paiementsParDevise('annee_scolaire=? AND statut=\'valide\'', [annee]);
    const totalAnneePaiements = paiementsAnnee.total;
    // Le taux de recouvrement compare ce qui a ete paye de scolarite a ce qui est attendu
    // de scolarite (totalAttendu, base sur frais_scolarite_total) : melanger les frais
    // d'inscription/divers dans le numerateur gonflait artificiellement ce taux a chaque
    // paiement d'un autre motif -- et un surplus (au-dela de ce qui est du) ne doit pas non
    // plus gonfler ce taux specifique, contrairement a "Total encaisse"/"Solde net"
    // ci-dessus qui doivent eux inclure toutes les recettes, surplus compris.
    const [[{ totalAnneeScolarite }]] = await db.query(
      "SELECT COALESCE(SUM(montant_usd),0) as totalAnneeScolarite FROM paiements WHERE annee_scolaire=? AND statut='valide' AND type_paiement='scolarite'", [annee]
    );
    const [[{ totalAttendu }]] = await db.query('SELECT COALESCE(SUM(frais_scolarite_total),0) as totalAttendu FROM archives_annuelles WHERE annee_scolaire=?', [annee]);
    const taux = totalAttendu > 0 ? Math.round((totalAnneeScolarite / totalAttendu) * 1000) / 10 : 0;
    const [[{ elevesSoldes }]] = await db.query(
      "SELECT COUNT(*) as elevesSoldes FROM archives_annuelles WHERE annee_scolaire=? AND statut_paiement='solde'", [annee]
    );
    const elevesNonSoldes = totalEleves - elevesSoldes;

    const depensesAnnee = await tableParDevise('depenses', 'annee_scolaire=?', [annee]);
    const totalDepenses = depensesAnnee.total;
    // Recettes diverses (subventions, dons...) : memes conventions que depenses ci-dessus.
    // Comptent comme un encaissement a part entiere (comme dans comptabilite.js/resume) :
    // pliees directement dans totalAnnee, pas seulement dans soldeNet, sinon un don resterait
    // invisible sur la carte "Total encaisse" alors qu'il apparait deja dans "Solde net".
    const recettesDiversesAnnee = await tableParDevise('recettes_diverses', 'annee_scolaire=?', [annee]);
    const totalRecettesDiverses = recettesDiversesAnnee.total;
    const totalAnnee = totalAnneePaiements + totalRecettesDiverses;
    const soldeNet = totalAnnee - totalDepenses;
    const totalAnneeParDevise = combinerParDevise(paiementsAnnee.parDevise, recettesDiversesAnnee.parDevise);
    const soldeNetParDevise = {
      usd: totalAnneeParDevise.usd - depensesAnnee.parDevise.usd,
      cdf: totalAnneeParDevise.cdf - depensesAnnee.parDevise.cdf,
      cdfEnUsd: totalAnneeParDevise.cdfEnUsd - depensesAnnee.parDevise.cdfEnUsd,
    };

    const [mensuelPaiements] = await db.query(
      `SELECT DATE_FORMAT(date_paiement,'%Y-%m') as mk, DATE_FORMAT(date_paiement,'%b %Y') as lbl,
              SUM(montant_usd + montant_surplus * (1 - surplus_rembourse)) as total, COUNT(*) as nb
       FROM paiements WHERE statut='valide' AND annee_scolaire=?
       GROUP BY DATE_FORMAT(date_paiement,'%Y-%m') ORDER BY mk ASC`,
      [annee]
    );
    const [mensuelRecettesDiverses] = await db.query(
      `SELECT DATE_FORMAT(date_recette,'%Y-%m') as mk, DATE_FORMAT(date_recette,'%b %Y') as lbl,
              SUM(montant_usd) as total, COUNT(*) as nb
       FROM recettes_diverses WHERE annee_scolaire=?
       GROUP BY DATE_FORMAT(date_recette,'%Y-%m') ORDER BY mk ASC`,
      [annee]
    );
    const mensuel = fusionnerMensuel(mensuelPaiements, mensuelRecettesDiverses);

    const [parClasse] = await db.query(
      `SELECT c.nom as classe, COUNT(a.id) as nb_eleves,
              COALESCE(SUM(a.total_paye),0) as total_paye,
              COALESCE(SUM(a.frais_scolarite_total),0) as total_attendu
       FROM archives_annuelles a LEFT JOIN classes c ON c.id=a.classe_id
       WHERE a.annee_scolaire=? GROUP BY a.classe_id ORDER BY total_paye DESC LIMIT 8`,
      [annee]
    );

    const [derniers] = await db.query(
      `SELECT p.*, e.nom, e.prenom, e.matricule, c.nom as classe, u.prenom as cp, u.nom as cn
       FROM paiements p JOIN eleves e ON e.id=p.eleve_id LEFT JOIN classes c ON c.id=e.classe_id
       LEFT JOIN utilisateurs u ON u.id=p.comptable_id
       WHERE p.statut='valide' AND p.annee_scolaire=? ORDER BY p.date_creation DESC LIMIT 8`,
      [annee]
    );

    return res.json({
      ecole, annee, devise, modeHistorique,
      stats: {
        totalEleves, totalFilles, totalGarcons, totalClasses,
        totalAnnee, totalAnneeParDevise, paiementsAujourdhui: 0, paiementsMois: 0, totalAttendu, taux,
        elevesSoldes, elevesNonSoldes, payF: 0, payM: 0,
        totalDepenses, totalDepensesParDevise: depensesAnnee.parDevise,
        totalRecettesDiverses, soldeNet, soldeNetParDevise,
      },
      mensuel, parClasse, derniers,
    });
  }

  const [[{ totalEleves }]] = await db.query("SELECT COUNT(*) as totalEleves FROM eleves WHERE statut='actif'");
  const [[{ totalFilles }]] = await db.query("SELECT COUNT(*) as totalFilles FROM eleves WHERE statut='actif' AND genre='F'");
  const [[{ totalGarcons }]] = await db.query("SELECT COUNT(*) as totalGarcons FROM eleves WHERE statut='actif' AND genre='M'");
  const [[{ totalClasses }]] = await db.query('SELECT COUNT(*) as totalClasses FROM classes WHERE actif=1');

  // montant_usd + montant_surplus : voir le commentaire equivalent dans la branche
  // historique ci-dessus -- l'argent recu en surplus fait partie de l'encaissement reel.
  const paiementsAnnee = await paiementsParDevise('annee_scolaire=? AND statut=\'valide\'', [annee]);
  const totalAnneePaiements = paiementsAnnee.total;
  const paiementsAujourdhuiRow = await paiementsParDevise("DATE(date_paiement)=CURDATE() AND statut='valide' AND annee_scolaire=?", [annee]);
  const paiementsMoisRow = await paiementsParDevise('MONTH(date_paiement)=MONTH(CURDATE()) AND YEAR(date_paiement)=YEAR(CURDATE()) AND statut=\'valide\' AND annee_scolaire=?', [annee]);
  // Recettes diverses recues aujourd'hui/ce mois-ci : un don/une subvention est un
  // encaissement reel au meme titre qu'un paiement d'eleve, doit donc compter ici aussi
  // (sinon invisible sur "Aujourd'hui" alors que deja compte dans "Solde net").
  const recettesDiversesAujourdhuiRow = await tableParDevise('recettes_diverses', "DATE(date_recette)=CURDATE() AND annee_scolaire=?", [annee]);
  const recettesDiversesMoisRow = await tableParDevise('recettes_diverses', 'MONTH(date_recette)=MONTH(CURDATE()) AND YEAR(date_recette)=YEAR(CURDATE()) AND annee_scolaire=?', [annee]);
  const paiementsAujourdhui = paiementsAujourdhuiRow.total + recettesDiversesAujourdhuiRow.total;
  const paiementsMois = paiementsMoisRow.total + recettesDiversesMoisRow.total;
  const paiementsAujourdhuiParDevise = combinerParDevise(paiementsAujourdhuiRow.parDevise, recettesDiversesAujourdhuiRow.parDevise);
  const paiementsMoisParDevise = combinerParDevise(paiementsMoisRow.parDevise, recettesDiversesMoisRow.parDevise);
  const [[{ totalAttendu }]] = await db.query(
    "SELECT COALESCE(SUM(frais_scolarite_total),0) as totalAttendu FROM eleves WHERE statut='actif' AND annee_scolaire=?", [annee]
  );
  // Voir commentaire equivalent dans la branche historique ci-dessus : le taux de
  // recouvrement doit comparer scolarite payee a scolarite attendue, pas "tout paye" a
  // "scolarite attendue" (totalAnnee, utilise pour Total encaisse/Solde net, reste tous
  // types confondus intentionnellement).
  const [[{ totalAnneeScolarite }]] = await db.query(
    "SELECT COALESCE(SUM(montant_usd),0) as totalAnneeScolarite FROM paiements WHERE annee_scolaire=? AND statut='valide' AND type_paiement='scolarite'", [annee]
  );
  const taux = totalAttendu > 0 ? Math.round((totalAnneeScolarite / totalAttendu) * 1000) / 10 : 0;

  const [[{ elevesSoldes }]] = await db.query(
    `SELECT COUNT(*) as elevesSoldes FROM eleves e WHERE e.statut='actif' AND e.annee_scolaire=?
     AND e.frais_scolarite_total <= (SELECT COALESCE(SUM(p.montant_usd),0) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite' AND p.annee_scolaire=e.annee_scolaire)`,
    [annee]
  );
  const elevesNonSoldes = totalEleves - elevesSoldes;

  const depensesAnnee = await tableParDevise('depenses', 'annee_scolaire=?', [annee]);
  const totalDepenses = depensesAnnee.total;
  // Voir commentaire equivalent dans la branche historique ci-dessus.
  const recettesDiversesAnnee = await tableParDevise('recettes_diverses', 'annee_scolaire=?', [annee]);
  const totalRecettesDiverses = recettesDiversesAnnee.total;
  const totalAnnee = totalAnneePaiements + totalRecettesDiverses;
  const soldeNet = totalAnnee - totalDepenses;
  const totalAnneeParDevise = combinerParDevise(paiementsAnnee.parDevise, recettesDiversesAnnee.parDevise);
  const soldeNetParDevise = {
    usd: totalAnneeParDevise.usd - depensesAnnee.parDevise.usd,
    cdf: totalAnneeParDevise.cdf - depensesAnnee.parDevise.cdf,
    cdfEnUsd: totalAnneeParDevise.cdfEnUsd - depensesAnnee.parDevise.cdfEnUsd,
  };

  const [mensuelPaiements] = await db.query(
    `SELECT DATE_FORMAT(date_paiement,'%Y-%m') as mk, DATE_FORMAT(date_paiement,'%b %Y') as lbl,
            SUM(montant_usd + montant_surplus * (1 - surplus_rembourse)) as total, COUNT(*) as nb
     FROM paiements WHERE statut='valide' AND annee_scolaire=? AND date_paiement >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
     GROUP BY DATE_FORMAT(date_paiement,'%Y-%m') ORDER BY mk ASC`,
    [annee]
  );
  const [mensuelRecettesDiverses] = await db.query(
    `SELECT DATE_FORMAT(date_recette,'%Y-%m') as mk, DATE_FORMAT(date_recette,'%b %Y') as lbl,
            SUM(montant_usd) as total, COUNT(*) as nb
     FROM recettes_diverses WHERE annee_scolaire=? AND date_recette >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
     GROUP BY DATE_FORMAT(date_recette,'%Y-%m') ORDER BY mk ASC`,
    [annee]
  );
  const mensuel = fusionnerMensuel(mensuelPaiements, mensuelRecettesDiverses);

  const [parClasse] = await db.query(
    `SELECT c.nom as classe, COUNT(DISTINCT e.id) as nb_eleves,
            COALESCE(SUM((SELECT COALESCE(SUM(p.montant_usd),0) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite' AND p.annee_scolaire=e.annee_scolaire)),0) as total_paye,
            COALESCE(SUM(e.frais_scolarite_total),0) as total_attendu
     FROM classes c LEFT JOIN eleves e ON e.classe_id=c.id AND e.statut='actif'
     WHERE c.actif=1 GROUP BY c.id ORDER BY total_paye DESC LIMIT 8`
  );

  const [[{ payF }]] = await db.query(
    "SELECT COALESCE(SUM(p.montant_usd + p.montant_surplus * (1 - p.surplus_rembourse)),0) as payF FROM paiements p JOIN eleves e ON e.id=p.eleve_id WHERE e.genre='F' AND MONTH(p.date_paiement)=MONTH(CURDATE()) AND p.statut='valide' AND p.annee_scolaire=?", [annee]
  );
  const [[{ payM }]] = await db.query(
    "SELECT COALESCE(SUM(p.montant_usd + p.montant_surplus * (1 - p.surplus_rembourse)),0) as payM FROM paiements p JOIN eleves e ON e.id=p.eleve_id WHERE e.genre='M' AND MONTH(p.date_paiement)=MONTH(CURDATE()) AND p.statut='valide' AND p.annee_scolaire=?", [annee]
  );

  const [derniers] = await db.query(
    `SELECT p.*, e.nom, e.prenom, e.matricule, c.nom as classe, u.prenom as cp, u.nom as cn
     FROM paiements p JOIN eleves e ON e.id=p.eleve_id JOIN classes c ON c.id=e.classe_id
     LEFT JOIN utilisateurs u ON u.id=p.comptable_id
     WHERE p.statut='valide' AND p.annee_scolaire=? ORDER BY p.date_creation DESC LIMIT 8`,
    [annee]
  );

  res.json({
    ecole, annee, devise, modeHistorique,
    stats: {
      totalEleves, totalFilles, totalGarcons, totalClasses,
      totalAnnee, totalAnneeParDevise, paiementsAujourdhui, paiementsMois, totalAttendu, taux,
      paiementsAujourdhuiParDevise, paiementsMoisParDevise,
      elevesSoldes, elevesNonSoldes, payF, payM,
      totalDepenses, totalDepensesParDevise: depensesAnnee.parDevise,
      totalRecettesDiverses, soldeNet, soldeNetParDevise,
    },
    mensuel, parClasse, derniers,
  });
});

module.exports = router;
