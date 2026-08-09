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
- MySQL 5.7+ / MariaDB 10.3+ (optionnel pour le mode MySQL)
- npm

## Commandes rapides

Si tout est déjà installé :

```bash
# Backend
cd backend
npm start

# Frontend
cd frontend
npm run dev
```

Pour réinitialiser la base SQLite une fois :

```bash
cd backend
npm run migrate:sqlite
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

### 3. Mode SQLite (sans XAMPP)

Cette application peut tourner en SQLite sans MySQL ni XAMPP.
Dans ce mode, le backend utilise une base locale `backend/database/ecolepay.sqlite`.

```bash
cd backend
npm run migrate:sqlite
npm start
```

Puis dans un autre terminal :

```bash
cd frontend
npm run dev
```

- Backend : `http://localhost:5000`
- Frontend : `http://localhost:5173`

#### Raccourci bureau

Un fichier de démarrage `start-ecolepay.bat` est fourni à la racine du projet.
Copiez-le sur votre bureau ou créez un raccourci vers ce fichier, puis double-cliquez dessus.

Le script vérifie automatiquement :
- si Node.js et npm sont installés,
- si les dépendances backend/frontend sont présentes,
- si la base SQLite doit être créée.

Ensuite il lance le backend, le frontend et ouvre le navigateur sur `http://localhost:5173`.

### 4. Mode MySQL (optionnel)

Si vous préférez utiliser MySQL, configurez `backend/.env` :

```bash
cd backend
cp .env.example .env
# Éditez .env avec vos identifiants MySQL
```

Puis lancez :

```bash
npm install
npm run migrate
npm start
```

Dans un autre terminal :

```bash
cd ../frontend
npm install
npm run dev
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
│   │   ├── migrate.js              # script d'installation de la base
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
