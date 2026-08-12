require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

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

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Fichiers uploades (logos ecole, etc.)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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

// Gestion des erreurs globales
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur interne.' });
});

app.use((req, res) => res.status(404).json({ error: 'Route introuvable.' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`EcolePay API demarree sur http://localhost:${PORT}`);
});
