@echo off
setlocal enabledelayedexpansion
title Installation d'EcolePay

:: --- Verifie que ce dossier est inscriptible ; s'il ne l'est pas (ex: installe dans
:: "Programmes"/"Program Files", protege sans droits administrateur), relance ce meme
:: script en admin via UAC. On ne demande l'elevation que si elle est reellement
:: necessaire (pas systematiquement), pour ne pas interrompre inutilement une
:: installation dans un dossier deja accessible en ecriture.
set "TESTFILE=%~dp0.ecolepay-write-test.tmp"
(echo test> "%TESTFILE%") 2>nul
if exist "%TESTFILE%" (
    del "%TESTFILE%" >nul 2>&1
) else (
    echo Ce dossier necessite les droits administrateur ^(ex: installation dans "Programmes"^).
    echo Une fenetre va s'ouvrir pour confirmer...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:: Se place dans le dossier ou se trouve ce script (peu importe d'ou on l'execute)
cd /d "%~dp0"

echo ============================================
echo   Installation d'EcolePay
echo ============================================
echo.

where node >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERREUR] Node.js n'est pas installe sur cette machine.
    echo Installez-le depuis https://nodejs.org ^(version LTS^) puis relancez ce fichier.
    pause
    exit /b 1
)

echo [1/4] Installation des dependances du serveur...
pushd backend
call npm install --no-fund --no-audit
if %errorLevel% neq 0 (
    popd
    echo [ERREUR] L'installation des dependances du serveur a echoue.
    pause
    exit /b 1
)
popd

echo.
echo [2/4] Installation des dependances de l'interface...
pushd frontend
call npm install --no-fund --no-audit
if %errorLevel% neq 0 (
    popd
    echo [ERREUR] L'installation des dependances de l'interface a echoue.
    pause
    exit /b 1
)

echo.
echo [3/4] Construction de l'interface...
call npm run build
if %errorLevel% neq 0 (
    popd
    echo [ERREUR] La construction de l'interface a echoue.
    pause
    exit /b 1
)
popd

echo.
echo [4/4] Configuration ^(cle de securite, base de donnees, raccourci de lancement^)...
if not exist "backend\database\ecolepay.sqlite" (
    echo   - Creation d'une base de donnees vierge...
    pushd backend
    call npm run migrate:sqlite
    popd
)
node backend\scripts\setup-deploiement.js

echo.
echo ============================================
echo   Installation terminee !
echo   Un raccourci "Lancer EcolePay" a ete place sur le Bureau.
echo   Double-cliquez dessus pour demarrer le logiciel.
echo ============================================
echo.
pause
