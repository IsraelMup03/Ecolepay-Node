cd# EcolePay v2.0 — Node.js / React

Réécriture complète de l'application **EcolePay** (gestion des paiements
scolaires), initialement en PHP + MySQL, vers une architecture moderne :

- **Backend** : Node.js + Express + MySQL (mysql2), authentification JWT
- **Frontend** : React 18 + Vite + React Router + Recharts

Aucune ligne de PHP n'est utilisée. Le schéma de base de données MySQL est
conservé (adapté), pour ne pas perdre la logique métier existante.

## Fonctionnalités reprises de la version PHP

- Authentification avec rôles (admin, comptable, directeur, agent/caissier)
  et permissions granulaires par utilisateur
- Changement de mot de passe obligatoire à la première connexion
- Tableau de bord avec statistiques et graphiques
- Gestion des élèves (inscription, fiche détaillée, export CSV, recherche
  instantanée, rétrogradation)
- Gestion des classes (frais, hiérarchie classe supérieure/inférieure)
- Caisse rapide : recherche d'élève + enregistrement de paiement
- Historique des paiements avec filtres et pagination
- Reçu de paiement imprimable
- Remboursements (demande + approbation par un administrateur)
- Promotion annuelle (passage à l'année suivante / diplôme)
- Rapports & statistiques (courbes, recouvrement par classe, répartition
  par mode de paiement, prévisions financières, listes élèves soldés/non
  soldés)
- Gestion des utilisateurs et permissions (admin uniquement)
- Paramètres (infos école + logo, taux de change, format des matricules,
  réinitialisation complète des données)
- Corbeille avec restauration (rétention 30 jours configurable)
- Journal d'activité (logs)
- Profil utilisateur + changement de mot de passe volontaire

## Prérequis

- Node.js 18 ou plus récent
- npm
- Windows 10/11 ou un autre OS compatible si vous utilisez les commandes manuelles
- Git (optionnel si vous clonez depuis GitHub)
- Pas besoin de XAMPP si vous utilisez le mode SQLite

## Prérequis pour un autre PC

Pour qu'un autre poste puisse utiliser le logiciel à partir du dossier partagé ou d'un clone GitHub, il doit remplir les points suivants :

- avoir `Node.js` et `npm` installés.
- cloner ou copier tout le dossier du projet (`backend/`, `frontend/`, `launch-ecolepay.bat`, etc.).
- si le dossier contient `backend/database/ecolepay.sqlite`, le destinataire peut lancer directement le logiciel.
- si le dossier contient déjà `node_modules/`, il n'est pas nécessaire de relancer `npm install`, mais cela reste recommandé après un clone GitHub.







- sur Windows, ouvrir `launch-ecolepay.bat` suffit pour démarrer automatiquement le backend, le frontend et ouvrir le navigateur : c'est une commande unique, simple et sans saisie manuelle.

Si la personne clone depuis GitHub :

```bash
git clone <URL-du-repo>
cd Ecolepay-Node/backend
npm install
cd ../frontend
npm install
```
ensuite allez tout simplement dans ouvrir `launch-ecolepay.bat` suffit pour démarrer automatiquement le backend, le frontend et ouvrir le navigateur : c'est une commande unique, simple et sans saisie manuelle.

si vous voulez plus compliqué 

```bash
cd backend
npm start
```

et dans un autre terminal :

```bash
cd frontend
npm run dev 
```


## Installation

### 1. Prérequis

- Node.js 18 ou plus récent
- npm
- pour le mode MySQL : MySQL ou MariaDB installé

### 2. Installation initiale

Ouvrez deux terminaux et installez les dépendances une seule fois :

```bash
cd backend
npm install

cd ../frontend
npm install
```


### 5. Accès administrateur

Compte administrateur par défaut :

- Email : `admin@ecolepay.com`
- Mot de passe : `Admin@2024`

Le changement de mot de passe peut être demandé à la première connexion.

### 6. Build de production

```bash
# Frontend
cd frontend
npm run build

# Backend
cd backend
npm start
```

## Structure du projet

```
ecolepay-node/
├── backend/
│   ├── database/ecolepay.sql       # schéma MySQL (utilisateurs, eleves, classes, paiements, ...)
│   ├── src/
│   │   ├── config/db.js            # pool de connexion MySQL
│   │   ├── middleware/auth.js      # vérification JWT + permissions
│   │   ├── routes/                 # une route Express par module (auth, eleves, classes, ...)
│   │   ├── utils/helpers.js        # matricule, référence de paiement, logs, corbeille, devises
│   │   ├── migrate.js              # script d'installation de la base (MySQL)
│   │   └── server.js               # point d'entrée Express
│   └── package.json
└── frontend/
    ├── src/
    │   ├── api/client.js           # client Axios (JWT automatique)
    │   ├── context/AuthContext.jsx # état d'authentification global
    │   ├── components/             # Layout, routes protégées
    │   ├── pages/                  # une page par écran
    │   └── styles/global.css       # thème (bleu marine / or), repris du design original
    └── package.json
```

## Notes de sécurité pour la production

- Changez impérativement `JWT_SECRET` dans `backend/.env`
- Changez le mot de passe administrateur par défaut dès la première connexion
- Servez le frontend en HTTPS et restreignez `FRONTEND_URL` (CORS) à votre domaine réel
- Les fichiers uploadés (logo de l'école) sont stockés dans `backend/uploads/`
  — pensez à sauvegarder ce dossier en plus de la base de données

## Support

Ce projet est une réécriture fonctionnelle de l'application PHP fournie.
Pour toute évolution ou question, la structure modulaire (une route =
un fichier) permet d'ajouter facilement de nouvelles fonctionnalités.
