// Appele par install.bat a la fin de l'installation :
// 1) cree backend/.env a partir de .env.example si absent, avec un JWT_SECRET unique
//    genere aleatoirement (jamais le meme secret partage entre deux installations)
// 2) genere un raccourci de lancement "Lancer EcolePay.bat" avec le chemin absolu de
//    cette installation, et le copie sur le Bureau de l'utilisateur courant
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '../..'); // racine du projet (contient backend/ et frontend/)
const BACKEND_DIR = path.join(ROOT, 'backend');
const ENV_PATH = path.join(BACKEND_DIR, '.env');
const ENV_EXAMPLE_PATH = path.join(BACKEND_DIR, '.env.example');

function ensureEnv() {
  if (fs.existsSync(ENV_PATH)) {
    console.log('.env existe deja - conserve tel quel (pas ecrase).');
    return;
  }
  let content = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
  const secret = crypto.randomBytes(48).toString('hex');
  content = content.replace(
    'JWT_SECRET=changez-cette-valeur-avant-tout-lancement-en-production',
    `JWT_SECRET=${secret}`
  );
  fs.writeFileSync(ENV_PATH, content, 'utf8');
  console.log('backend/.env cree avec un JWT_SECRET unique genere automatiquement.');
}

function lirePort() {
  const content = fs.readFileSync(ENV_PATH, 'utf8');
  const match = content.match(/^PORT=(\d+)/m);
  return match ? match[1] : '5055';
}

function genererLanceur(port) {
  const lignes = [
    '@echo off',
    'title EcolePay',
    `cd /d "${BACKEND_DIR}"`,
    "echo Demarrage d'EcolePay...",
    'start "EcolePay - Serveur (ne pas fermer cette fenetre)" /min cmd /c "npm start"',
    'timeout /t 4 /nobreak >nul',
    `start "" "http://localhost:${port}"`,
  ];
  return lignes.join('\r\n') + '\r\n';
}

function installerLanceur() {
  const port = lirePort();
  const contenu = genererLanceur(port);
  const nomFichier = 'Lancer EcolePay.bat';

  // Copie de reference dans le projet (utile si le raccourci du Bureau est supprime par erreur)
  fs.writeFileSync(path.join(ROOT, nomFichier), contenu, 'utf8');

  const bureau = path.join(os.homedir(), 'Desktop');
  try {
    fs.writeFileSync(path.join(bureau, nomFichier), contenu, 'utf8');
    console.log(`Raccourci de lancement place sur le Bureau : ${path.join(bureau, nomFichier)}`);
  } catch (e) {
    console.log(`Impossible de copier automatiquement sur le Bureau (${e.message}).`);
    console.log(`Copiez vous-meme "${path.join(ROOT, nomFichier)}" sur le Bureau.`);
  }
}

ensureEnv();
installerLanceur();
console.log('\nConfiguration terminee.');
