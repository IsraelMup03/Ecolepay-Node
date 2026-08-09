@echo off
REM Script de démarrage pour EcolePay (backend + frontend) et ouverture du navigateur.
REM Copier ce fichier sur le bureau ou créer un raccourci vers ce fichier.

setlocal
set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"

echo Vérification de l'installation de Node.js...
node -v >nul 2>&1
if errorlevel 1 (
  echo Erreur : Node.js n'est pas installé ou n'est pas dans le PATH.
  echo Installez Node.js puis relancez ce fichier.
  pause
  exit /b 1
)

echo Vérification de l'installation de npm...
npm -v >nul 2>&1
if errorlevel 1 (
  echo Erreur : npm n'est pas disponible.
  echo Installez Node.js (npm est inclus) puis relancez ce fichier.
  pause
  exit /b 1
)

echo ---------------------------------------------
if not exist "%BACKEND%\node_modules" (
  echo Installation des dépendances backend...
  pushd "%BACKEND%"
  npm install
  popd
) else (
  echo Dépendances backend déjà installées.
)

if not exist "%BACKEND%\database\ecolepay.sqlite" (
  echo Creation de la base SQLite...
  pushd "%BACKEND%"
  npm run migrate:sqlite
  popd
) else (
  echo Base SQLite deja presente.
)
echo ---------------------------------------------
if not exist "%FRONTEND%\node_modules" (
  echo Installation des dépendances frontend...
  pushd "%FRONTEND%"
  npm install
  popd
) else (
  echo Dépendances frontend déjà installées.
)
echo ---------------------------------------------
echo Démarrage du backend...
start "EcolePay Backend" powershell -NoExit -Command "Set-Location -LiteralPath '%BACKEND%'; npm start"

echo Démarrage du frontend...
start "EcolePay Frontend" powershell -NoExit -Command "Set-Location -LiteralPath '%FRONTEND%'; npm run dev"

echo Ouverture de l'application dans le navigateur...
timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"

endlocal
