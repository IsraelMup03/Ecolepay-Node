@echo off
setlocal
title EcolePay - Preparer un dossier pour un nouveau client
cd /d "%~dp0"

:: Cree une copie propre du projet, prete a etre transportee (cle USB, etc.) et installee
:: chez un nouveau client :
::   - L'interface (frontend) est construite ICI, une seule fois, et seul le resultat deja
::     compile est copie -- jamais le code source de l'interface. L'installation chez le
::     client n'a donc plus besoin de la reconstruire (plus rapide) et le client n'y a pas
::     acces.
::   - Le code source du serveur (backend) doit rester lisible par Node.js pour fonctionner
::     (impossible de faire autrement sans changer toute l'architecture), mais il est rendu
::     "cache" au sens Windows : invisible dans l'Explorateur pour un client normal.
::   - node_modules (reinstalles par install.bat), la base de donnees et le .env de CE
::     poste de developpement, le dossier .claude et les outils internes ne sont jamais
::     inclus.
::
:: Le dossier original (celui-ci) n'est jamais modifie par ce script.

set "DEST=%~dp0..\Ecolepay-FoxGroup"

echo ============================================
echo   Preparation d'un dossier client neuf
echo ============================================
echo.

echo [1/3] Construction de l'interface...
pushd frontend
call npm run build
if %errorLevel% neq 0 (
    popd
    echo [ERREUR] La construction de l'interface a echoue.
    pause
    exit /b 1
)
popd

echo.
echo [2/3] Copie des fichiers...
if exist "%DEST%" (
    echo Le dossier "%DEST%" existe deja, il va etre remplace.
    rmdir /s /q "%DEST%"
)
mkdir "%DEST%"

:: Copie principale : tout, sauf le dossier frontend complet (traite a part juste apres,
:: seul frontend/dist doit etre livre), les outils internes et les donnees de ce poste.
robocopy "%~dp0." "%DEST%" /E ^
    /XD node_modules .git .claude frontend ^
    /XF "*.sqlite*" ".env" ".ecolepay-write-test.tmp" "Lancer EcolePay.bat" "EcolePay.lnk" "COPIE DE SECURITE*" "preparer-nouveau-client.bat" "launch-ecolepay.bat" "README.md" "package-lock.json" "*.log" >nul

:: Copie separee : uniquement l'interface deja construite (frontend/dist), jamais son code
:: source (frontend/src) ni ses fichiers de configuration de developpement.
robocopy "%~dp0frontend\dist" "%DEST%\frontend\dist" /E >nul

echo.
echo [3/3] Masquage du code source du serveur...
attrib +h +s "%DEST%\backend\src" >nul 2>&1
attrib +h +s "%DEST%\backend\scripts" >nul 2>&1

echo.
echo Dossier pret : %DEST%
echo   - Interface deja construite, code source non inclus
echo   - Code source du serveur present mais cache (backend\src, backend\scripts)
echo   - Sans node_modules (install.bat les reinstalle chez le client)
echo   - Sans base de donnees (une base neuve et vide sera creee a l'installation)
echo   - Sans .env (une cle de securite unique sera generee a l'installation)
echo.
echo Copiez ce dossier "Ecolepay-FoxGroup" dans "Programmes" chez le client, renommez-le
echo si besoin, puis double-cliquez sur install.bat a l'interieur.
echo.
pause
