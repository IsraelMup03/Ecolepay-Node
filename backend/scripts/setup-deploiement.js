// Appele par install.bat a la fin de l'installation :
// 1) cree backend/.env a partir de .env.example si absent, avec un JWT_SECRET unique
//    genere aleatoirement (jamais le meme secret partage entre deux installations)
// 2) genere le script de lancement "Lancer EcolePay.bat" avec le chemin absolu de cette
//    installation, et cree un raccourci Windows (.lnk) avec l'icone du logiciel -- sur le
//    Bureau ET a la racine du dossier d'installation -- un .bat seul ne peut pas avoir
//    d'icone personnalisee, contrairement a un raccourci .lnk.
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

// Cree (ou remplace) un raccourci Windows (.lnk) a l'emplacement donne, pointant vers le
// .bat, avec l'icone du logiciel. Un .lnk (contrairement a un .bat copie tel quel) affiche
// une vraie icone d'application au lieu de l'icone generique "fichier de commandes".
function creerRaccourci(cheminLnk, cheminBat) {
  const iconeDisponible = fs.existsSync(ICON_PATH);

  // Supprime l'ancien raccourci s'il existe : garantit une reecriture complete plutot
  // qu'une modification en place, pour eviter tout residu de l'ancienne icone.
  if (fs.existsSync(cheminLnk)) {
    try { fs.unlinkSync(cheminLnk); } catch (e) { /* ignore */ }
  }

  const echapPs = (s) => s.replace(/'/g, "''");
  const ps = [
    '$W = New-Object -ComObject WScript.Shell',
    `$S = $W.CreateShortcut('${echapPs(cheminLnk)}')`,
    `$S.TargetPath = '${echapPs(cheminBat)}'`,
    `$S.WorkingDirectory = '${echapPs(BACKEND_DIR)}'`,
    `$S.Description = 'Lancer EcolePay'`,
    iconeDisponible ? `$S.IconLocation = '${echapPs(ICON_PATH)}'` : null,
    '$S.Save()',
    // Force Windows Explorer a invalider son cache d'icones : sans ca, un raccourci
    // recree avec une icone differente peut continuer d'afficher l'ancienne icone en
    // cache jusqu'a un rafraichissement manuel (F5) ou un redemarrage de l'explorateur.
    'Add-Type -Namespace Win32 -Name Shell -MemberDefinition \'[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, int f, IntPtr i1, IntPtr i2);\'',
    '[Win32.Shell]::SHChangeNotify(0x8000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)',
  ].filter(Boolean).join('\r\n');

  // BOM UTF-8 indispensable : sans lui, PowerShell 5.1 lit ce script avec la page de code
  // ANSI du systeme et non en UTF-8, ce qui corrompt tout caractere accentue present dans
  // le chemin d'installation (ex: "Ecole Test Reseau") -- exactement le meme piege que
  // pour le fichier .bat, corrige plus haut avec le meme remede (BOM ici + chcp la-bas).
  const psScriptPath = path.join(os.tmpdir(), `ecolepay-shortcut-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);
  fs.writeFileSync(psScriptPath, '﻿' + ps, 'utf8');
  try {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScriptPath], { stdio: 'pipe' });
    console.log(`Raccourci cree : ${cheminLnk}${iconeDisponible ? ' (avec icone)' : ''}`);
  } catch (e) {
    console.log(`Impossible de creer le raccourci "${cheminLnk}" (${e.message}).`);
  } finally {
    fs.unlinkSync(psScriptPath);
  }
}

function creerRaccourcis(cheminBat) {
  const bureau = path.join(os.homedir(), 'Desktop');
  creerRaccourci(path.join(bureau, 'EcolePay.lnk'), cheminBat);
  creerRaccourci(path.join(ROOT, 'EcolePay.lnk'), cheminBat);
}

ensureEnv();
const port = lirePort();
const cheminBat = ecrireLanceur(port);
creerRaccourcis(cheminBat);
console.log('\nConfiguration terminee.');
