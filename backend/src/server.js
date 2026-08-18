require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const elevesRoutes = require('./routes/eleves');
const classesRoutes = require('./routes/classes');
const paiementsRoutes = require('./routes/paiements');
const remboursementsRoutes = require('./routes/remboursements');
const promotionRoutes = require('./routes/promotion');
const utilisateursRoutes = require('./routes/utilisateurs');
const parametresRoutes = require('./routes/parametres');
const corbeilleRoutes = require('./routes/corbeille');
const logsRoutes = require('./routes/logs');
const profilRoutes = require('./routes/profil');
const rapportsRoutes = require('./routes/rapports');
const historiqueRoutes = require('./routes/historique');
const rechercheRoutes = require('./routes/recherche');
const comptabiliteRoutes = require('./routes/comptabilite');

// Filet de securite : une exception non geree dans une route async ne doit jamais
// arreter tout le serveur (nodemon ne redemarre pas automatiquement apres un crash,
// ce qui bloquerait l'application entiere pour tous les utilisateurs jusqu'a
// intervention manuelle). On journalise et on continue.
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection (requete ignoree, serveur maintenu en vie):', err);
});
process.on('uncaughtException', (err) => {
  console.error('uncaughtException (serveur maintenu en vie):', err);
});

const app = express();

// contentSecurityPolicy desactive : ce serveur ne rend aucun HTML (API JSON + fichiers
// uploades uniquement), la CSP n'a donc aucun effet utile ici et complique les tests.
// crossOriginResourcePolicy assoupli en cross-origin : le frontend Vite (port 5173) charge
// le logo de l'ecole depuis /uploads sur ce serveur (port 5055) = deux origines distinctes.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Fichiers uploades (logos ecole, etc.)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Sert le frontend deja compile (frontend/dist, genere par `npm run build`) : un seul
// processus/port pour toute l'application, ce qui est plus simple a installer et a lancer
// chez un client qu'un serveur Vite separe. N'a aucun effet en developpement puisque
// frontend/dist n'existe que si le build a ete lance (le script d'installation le fait).
//
// Cache-Control explicite : les fichiers dans /assets ont un nom unique par build (hash
// de contenu genere par Vite), donc peuvent etre mis en cache longtemps sans risque.
// index.html en revanche change de contenu (il reference les nouveaux noms de fichiers)
// sans que son propre nom change : s'il reste en cache navigateur apres une reinstallation
// ou une mise a jour, le navigateur continue a demander les ANCIENS fichiers /assets qui
// n'existent plus (supprimes par le nouveau build) -> ecran blanc avec des 404 en console.
// "no-cache" force donc une revalidation systematique pour index.html uniquement.
const FRONTEND_DIST = path.join(__dirname, '../../frontend/dist');
const SERVE_FRONTEND = fs.existsSync(FRONTEND_DIST);
if (SERVE_FRONTEND) {
  app.use(express.static(FRONTEND_DIST, {
    setHeaders: (res, filePath) => {
      if (path.basename(filePath) === 'index.html') {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'EcolePay API', version: '2.0.0' }));

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/eleves', elevesRoutes);
app.use('/api/classes', classesRoutes);
app.use('/api/paiements', paiementsRoutes);
app.use('/api/remboursements', remboursementsRoutes);
app.use('/api/promotion', promotionRoutes);
app.use('/api/utilisateurs', utilisateursRoutes);
app.use('/api/parametres', parametresRoutes);
app.use('/api/corbeille', corbeilleRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/profil', profilRoutes);
app.use('/api/rapports', rapportsRoutes);
app.use('/api/historique', historiqueRoutes);
app.use('/api/recherche', rechercheRoutes);
app.use('/api/comptabilite', comptabiliteRoutes);

// Redirige toute route non-API/non-uploads vers index.html : c'est React Router (cote
// client) qui decide alors quelle page afficher. Necessaire pour qu'un rechargement de
// page sur une URL comme /eleves/12 fonctionne (sinon Express n'a aucune route pour ce
// chemin et renverrait une 404 avant meme que React ne s'execute).
if (SERVE_FRONTEND) {
  app.get(/^\/(?!api|uploads).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

// Gestion des erreurs globales
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur interne.' });
});

app.use((req, res) => res.status(404).json({ error: 'Route introuvable.' }));

// Adresse(s) reseau local (LAN) de cette machine : le serveur ecoute deja sur toutes les
// interfaces (app.listen sans hote precis = 0.0.0.0), donc d'autres postes du meme reseau
// peuvent s'y connecter sans configuration supplementaire -- il suffit de leur communiquer
// cette adresse. Utile pour un usage multi-utilisateurs (plusieurs postes de l'ecole).
function adressesReseauLocal() {
  const interfaces = require('os').networkInterfaces();
  const adresses = [];
  for (const nom of Object.keys(interfaces)) {
    for (const iface of interfaces[nom]) {
      if (iface.family === 'IPv4' && !iface.internal) adresses.push(iface.address);
    }
  }
  return adresses;
}

// Copie de sauvegarde de la base de donnees, bien visible a la racine du dossier, que
// l'ecole est invitee a glisser regulierement vers son cloud (Google Drive, OneDrive...)
// pour ne jamais perdre ses donnees si cet ordinateur tombe en panne. "VACUUM INTO" (et
// non une simple copie de fichier) garantit un instantane coherent meme si une ecriture
// est en cours au moment de la sauvegarde. Ecrite d'abord sous un nom temporaire puis
// renommee (operation atomique) pour ne jamais laisser une sauvegarde a moitie ecrite si
// le logiciel est ferme pile pendant la sauvegarde. Seulement en installation "prete a
// l'emploi" (SERVE_FRONTEND) : inutile de polluer ce dossier de developpement.
const NOM_SAUVEGARDE = 'COPIE DE SECURITE (a mettre sur le Cloud).sqlite';
async function sauvegarderBaseDeDonnees() {
  if (!SERVE_FRONTEND) return;
  const cheminFinal = path.join(__dirname, '../..', NOM_SAUVEGARDE);
  const cheminTemp = `${cheminFinal}.tmp`;
  try {
    if (fs.existsSync(cheminTemp)) fs.unlinkSync(cheminTemp);
    const db = require('./config/db');
    await db.query('VACUUM INTO ?', [cheminTemp]);
    fs.renameSync(cheminTemp, cheminFinal);
    console.log(`Copie de sauvegarde mise a jour : ${cheminFinal}`);
  } catch (e) {
    console.error('Echec de la sauvegarde automatique de la base de donnees:', e.message);
  }
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  const adresses = adressesReseauLocal();
  console.log('========================================');
  console.log(' EcolePay demarre !');
  console.log('========================================');
  console.log(` Sur cet ordinateur : http://localhost:${PORT}`);
  if (adresses.length) {
    console.log(' Depuis un autre poste du meme reseau (Wi-Fi/cable) :');
    adresses.forEach((a) => console.log(`   http://${a}:${PORT}`));
  } else {
    console.log(' (Aucune adresse reseau local detectee - acces uniquement depuis cet ordinateur.)');
  }
  console.log('========================================');

  if (SERVE_FRONTEND) {
    sauvegarderBaseDeDonnees();
    setInterval(sauvegarderBaseDeDonnees, 2 * 60 * 60 * 1000); // toutes les 2 heures
  }
});
