@echo off
setlocal
title EcolePay - Preparer un dossier pour un nouveau client
cd /d "%~dp0"

:: Cree une copie propre du projet, prete a etre transportee (cle USB, etc.) et installee
:: chez un nouveau client, SANS : node_modules (install.bat les reinstalle), le frontend
:: deja construit (idem), la base de donnees et le .env de CE poste de developpement (sinon
:: le nouveau client heriterait de vos donnees et de votre cle de securite au lieu d'en
:: avoir des neuves et uniques a lui).
::
:: Le dossier original (celui-ci) n'est jamais modifie par ce script.

set "DEST=%~dp0..\EcolePay-a-livrer"

echo ============================================
echo   Preparation d'un dossier client neuf
echo ============================================
echo.

if exist "%DEST%" (
    echo Le dossier "%DEST%" existe deja, il va etre remplace.
    rmdir /s /q "%DEST%"
)
mkdir "%DEST%"

robocopy "%~dp0." "%DEST%" /E /XD node_modules .git dist /XF "*.sqlite*" ".env" ".ecolepay-write-test.tmp" "Lancer EcolePay.bat" >nul

echo.
echo Dossier pret : %DEST%
echo   - Sans node_modules (install.bat les reinstalle chez le client)
echo   - Sans base de donnees (une base neuve et vide sera creee a l'installation)
echo   - Sans .env (une cle de securite unique sera generee a l'installation)
echo.
echo Copiez ce dossier "EcolePay-a-livrer" dans "Programmes" chez le client, renommez-le
echo si besoin, puis double-cliquez sur install.bat a l'interieur.
echo.
pause
