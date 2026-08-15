// Appele par install.bat a la fin de l'installation :
// 1) cree backend/.env a partir de .env.example si absent, avec un JWT_SECRET unique
//    genere aleatoirement (jamais le meme secret partage entre deux installations)
// 2) genere le script de lancement "Lancer EcolePay.bat" avec le chemin absolu de cette
//    installation, et cree un raccourci Windows (.lnk) sur le Bureau qui pointe dessus
//    avec une vraie icone (le logo de l'ecole, converti en .ico) -- un .bat seul ne peut
//    pas avoir d'icone personnalisee, contrairement a un raccourci .lnk.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..'); // racine du projet (contient backend/ et frontend/)
const BACKEND_DIR = path.join(ROOT, 'backend');
const ENV_PATH = path.join(BACKEND_DIR, '.env');
const ENV_EXAMPLE_PATH = path.join(BACKEND_DIR, '.env.example');
const ICON_PATH = path.join(BACKEND_DIR, 'assets', 'ecolepay.ico');

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
  // chcp 65001 (+ le BOM UTF-8 ecrit plus bas) : sans ca, un chemin d'installation
  // contenant un caractere accentue (ex: "EcolePay developpe FOX group") est mal
  // interprete par cmd.exe selon la page de code active du systeme, ce qui corrompt
  // le chemin et fait echouer le "cd /d" avec "chemin d'acces introuvable" -- le
  // script continue alors depuis le mauvais dossier et npm start echoue silencieusement.
  //
  // La fenetre du serveur n'est plus reduite automatiquement (/min retire) : elle affiche
  // au demarrage l'adresse reseau local (utile pour se connecter depuis un autre poste de
  // l'ecole), donc il est preferable qu'elle reste visible au premier lancement. Un
  // utilisateur qui prefere la reduire peut toujours le faire manuellement ensuite.
  const lignes = [
    '@echo off',
    'chcp 65001 >nul',
    'title EcolePay',
    `cd /d "${BACKEND_DIR}"`,
    'if errorlevel 1 (',
    `  echo [ERREUR] Dossier d'installation introuvable : "${BACKEND_DIR}"`,
    "  echo Le dossier a peut-etre ete deplace ou renomme apres l'installation.",
    "  echo Relancez install.bat depuis son emplacement actuel pour regenerer ce raccourci.",
    '  pause',
    '  exit /b 1',
    ')',
    "echo Demarrage d'EcolePay...",
    'start "EcolePay - Serveur (laissez cette fenetre ouverte)" cmd /c "npm start"',
    'timeout /t 4 /nobreak >nul',
    `start "" "http://localhost:${port}"`,
  ];
  return '﻿' + lignes.join('\r\n') + '\r\n';
}

function ecrireLanceur(port) {
  const contenu = genererLanceur(port);
  const cheminBat = path.join(ROOT, 'Lancer EcolePay.bat');
  fs.writeFileSync(cheminBat, contenu, 'utf8');
  return cheminBat;
}

// Cree un raccourci Windows (.lnk) sur le Bureau pointant vers le .bat, avec l'icone de
// l'ecole. Un .lnk (contrairement a un .bat copie tel quel) affiche une vraie icone
// d'application au lieu de l'icone generique "fichier de commandes".
function creerRaccourciBureau(cheminBat) {
  const bureau = path.join(os.homedir(), 'Desktop');
  const cheminLnk = path.join(bureau, 'EcolePay.lnk');
  const iconeDisponible = fs.existsSync(ICON_PATH);

  const echapPs = (s) => s.replace(/'/g, "''");
  const ps = [
    '$W = New-Object -ComObject WScript.Shell',
    `$S = $W.CreateShortcut('${echapPs(cheminLnk)}')`,
    `$S.TargetPath = '${echapPs(cheminBat)}'`,
    `$S.WorkingDirectory = '${echapPs(BACKEND_DIR)}'`,
    `$S.Description = 'Lancer EcolePay'`,
    iconeDisponible ? `$S.IconLocation = '${echapPs(ICON_PATH)}'` : null,
    '$S.Save()',
  ].filter(Boolean).join('\r\n');

  // BOM UTF-8 indispensable : sans lui, PowerShell 5.1 lit ce script avec la page de code
  // ANSI du systeme et non en UTF-8, ce qui corrompt tout caractere accentue present dans
  // le chemin d'installation (ex: "Ecole Test Reseau") -- exactement le meme piege que
  // pour le fichier .bat, corrige plus haut avec le meme remede (BOM + interpretation UTF-8
  // explicite, ici via -Encoding UTF8 au lieu de chcp).
  const psScriptPath = path.join(os.tmpdir(), `ecolepay-shortcut-${Date.now()}.ps1`);
  fs.writeFileSync(psScriptPath, '﻿' + ps, 'utf8');
  try {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScriptPath], { stdio: 'pipe' });
    console.log(`Raccourci place sur le Bureau : ${cheminLnk}${iconeDisponible ? ' (avec icone)' : ''}`);
  } catch (e) {
    console.log(`Impossible de creer le raccourci du Bureau (${e.message}).`);
    console.log(`Vous pouvez lancer directement : ${cheminBat}`);
  } finally {
    fs.unlinkSync(psScriptPath);
  }
}

ensureEnv();
const port = lirePort();
const cheminBat = ecrireLanceur(port);
creerRaccourciBureau(cheminBat);
console.log('\nConfiguration terminee.');
