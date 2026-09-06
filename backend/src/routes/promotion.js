const express = require('express');
const db = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivite, getParam } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth);

// GET /api/promotion/preview
router.get('/preview', requirePermission('promotion'), async (req, res) => {
  const [rows] = await db.query(
    `SELECT e.id, e.nom, e.prenom, e.statut, e.redoublant, e.frais_scolarite_total, e.remise_pourcentage,
            c.nom as classe_actuelle, c.est_pivot, cs.nom as classe_suivante, cs.id as classe_suivante_id,
            cs.frais_scolarite as nouveaux_frais, cs.frais_inscription as nouvelle_inscription,
            COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite' AND p.annee_scolaire=e.annee_scolaire),0) as total_paye
     FROM eleves e
     JOIN classes c ON c.id=e.classe_id
     LEFT JOIN classes cs ON cs.id=c.classe_superieure_id
     WHERE e.statut='actif'
     ORDER BY c.ordre ASC, e.nom ASC`
  );
  // Apercu des nouveaux frais deja remises (meme calcul qu'a l'execution reelle), pour que
  // l'aperçu affiche le montant que l'eleve devra vraiment.
  rows.forEach((r) => {
    if (r.nouveaux_frais != null) {
      r.nouveaux_frais = Math.round(r.nouveaux_frais * (1 - (parseFloat(r.remise_pourcentage) || 0) / 100) * 100) / 100;
    }
  });
  const anneeCourante = await getParam('annee_scolaire_courante');
  res.json({ eleves: rows, anneeCourante });
});

// POST /api/promotion/executer  { nouvelle_annee }
router.post('/executer', requirePermission('promotion'), async (req, res) => {
  const { nouvelle_annee } = req.body;
  if (!nouvelle_annee) return res.status(400).json({ error: 'Saisissez la nouvelle annee scolaire.' });

  const annee = await getParam('annee_scolaire_courante');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Archiver la situation financiere de l'annee qui se termine. total_paye ne compte
    // que la scolarite (comme frais_scolarite_total, auquel il est compare pour deriver
    // statut_paiement) : les frais d'inscription/divers ("autre") sont suivis separement
    // et ne doivent pas gonfler artificiellement le "soldé" d'un eleve qui n'a en realite
    // rien paye de sa scolarite.
    const [elevesActifs] = await conn.query(
      `SELECT e.id, e.classe_id, e.frais_scolarite_total,
              COALESCE((SELECT SUM(p.montant_usd) FROM paiements p WHERE p.eleve_id=e.id AND p.statut='valide' AND p.type_paiement='scolarite' AND p.annee_scolaire=?),0) as total_paye
       FROM eleves e WHERE e.statut='actif'`,
      [annee]
    );
    for (const ea of elevesActifs) {
      const statutPay = ea.total_paye >= ea.frais_scolarite_total ? 'solde' : (ea.total_paye > 0 ? 'partiel' : 'non_paye');
      const [[existante]] = await conn.query(
        'SELECT id FROM archives_annuelles WHERE annee_scolaire=? AND eleve_id=?',
        [annee, ea.id]
      );
      if (existante) {
        await conn.query(
          'UPDATE archives_annuelles SET classe_id=?, frais_scolarite_total=?, total_paye=?, statut_paiement=? WHERE id=?',
          [ea.classe_id, ea.frais_scolarite_total, ea.total_paye, statutPay, existante.id]
        );
      } else {
        await conn.query(
          `INSERT INTO archives_annuelles (annee_scolaire, eleve_id, classe_id, frais_scolarite_total, total_paye, statut_paiement)
           VALUES (?,?,?,?,?,?)`,
          [annee, ea.id, ea.classe_id, ea.frais_scolarite_total, ea.total_paye, statutPay]
        );
      }
    }

    // 2. Determiner promotion vs diplome a partir de la classe D'ORIGINE (avant toute
    // mutation) : sinon un eleve promu dans une classe terminale se ferait immediatement
    // re-detecter comme "en classe terminale" et diplome a tort la meme execution.
    const [elevesClasses] = await conn.query(
      `SELECT e.id, e.remise_pourcentage, c.classe_superieure_id, c.est_pivot, cs.frais_scolarite as new_frais_s, cs.frais_inscription as new_frais_i
       FROM eleves e
       JOIN classes c ON c.id=e.classe_id
       LEFT JOIN classes cs ON cs.id=c.classe_superieure_id
       WHERE e.statut='actif'`
    );
    let nbPromus = 0;
    let nbDiplomes = 0;
    let nbEnAttenteOrientation = 0;
    for (const ec of elevesClasses) {
      if (ec.est_pivot) {
        // Classe pivot (ex: 8eme -> plusieurs options d'humanites au choix) : impossible de
        // choisir automatiquement une classe superieure unique, chaque eleve doit etre
        // transfere individuellement vers l'option qu'il a choisie. On avance seulement
        // l'annee scolaire (pour que ses futurs paiements comptent sur la bonne annee) et on
        // remet le flag redoublant a zero, comme pour les autres -- mais classe_id/section_id
        // restent inchanges : l'eleve reste visible dans sa classe pivot jusqu'a son transfert
        // manuel (via /eleves/:id/transferer), ce qui sert aussi de liste d'attente naturelle.
        await conn.query(
          `UPDATE eleves SET redoublant=0, annee_scolaire=?, en_attente_orientation=1 WHERE id=?`,
          [nouvelle_annee, ec.id]
        );
        nbEnAttenteOrientation++;
      } else if (ec.classe_superieure_id) {
        // Tous les eleves actifs montent en classe superieure sans exception (l'ecole n'a
        // pas de notes/points pour decider qui redouble automatiquement) : le flag
        // redoublant est remis a zero, l'admin retrogradera au cas par cas plus tard si besoin.
        // section_id=NULL : l'eleve change de classe, son ancienne section (A/B/C) n'a
        // plus de sens dans la nouvelle classe -- elle sera choisie a son premier paiement.
        // La remise deja accordee a l'eleve est conservee sur son nouveau montant de scolarite.
        // en_attente_orientation=0 explicitement : un eleve qui vient d'etre promu (meme
        // dans une classe pivot) est "normal" cette annee, pas encore en retard de transfert
        // -- il ne doit jamais se retrouver mele au groupe deja present dans la classe pivot.
        const facteur = 1 - (parseFloat(ec.remise_pourcentage) || 0) / 100;
        await conn.query(
          `UPDATE eleves SET classe_id=?, section_id=NULL, statut='actif', redoublant=0, annee_scolaire=?, frais_scolarite_total=?, frais_inscription_total=?, en_attente_orientation=0 WHERE id=?`,
          [ec.classe_superieure_id, nouvelle_annee, (ec.new_frais_s || 0) * facteur, ec.new_frais_i, ec.id]
        );
        nbPromus++;
      } else {
        await conn.query(
          `UPDATE eleves SET statut='diplome', section_id=NULL, redoublant=0, annee_scolaire=? WHERE id=?`,
          [nouvelle_annee, ec.id]
        );
        nbDiplomes++;
      }
    }

    // 4. Mettre a jour l'annee scolaire courante
    await conn.query("UPDATE parametres SET valeur=? WHERE cle='annee_scolaire_courante'", [nouvelle_annee]);
    await conn.query('UPDATE ecole SET annee_scolaire=?', [nouvelle_annee]);

    await conn.commit();
    await logActivite(req.user.id, 'Promotion annuelle', `Ancienne: ${annee} -> Nouvelle: ${nouvelle_annee} - ${nbPromus} promus, ${nbEnAttenteOrientation} en attente d'orientation`, req.ip);

    res.json({
      success: true,
      nbPromus,
      nbDiplomes,
      nbEnAttenteOrientation,
      message: `${nbPromus} eleves promus, ${nbDiplomes} diplomes${nbEnAttenteOrientation > 0 ? `, ${nbEnAttenteOrientation} en attente d'orientation (transfert manuel requis depuis une classe pivot)` : ''}. Nouvelle annee: ${nouvelle_annee}. L'historique de l'annee ${annee} est conserve.`,
    });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: `Erreur lors de la promotion: ${e.message}` });
  } finally {
    conn.release();
  }
});

module.exports = router;
