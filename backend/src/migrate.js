/**
 * Script de migration : cree la base de donnees et les tables (ecolepay.sql),
 * puis (re)genere un hash bcrypt correct pour le mot de passe admin par defaut.
 *
 * Usage : npm run migrate
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    multipleStatements: true,
  });

  console.log('Connexion MySQL etablie. Execution du script SQL...');
  const sqlPath = path.join(__dirname, '../database/ecolepay.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await connection.query(sql);
  console.log('Schema et donnees de base crees (ou deja existants).');

  const dbName = process.env.DB_NAME || 'ecolepay';
  await connection.query(`USE \`${dbName}\``);

  const hash = await bcrypt.hash('Admin@2024', 10);
  await connection.query(
    "UPDATE utilisateurs SET mot_de_passe=? WHERE email='admin@ecolepay.com'",
    [hash]
  );
  console.log('Mot de passe admin par defaut regenere : admin@ecolepay.com / Admin@2024');

  await connection.end();
  console.log('Migration terminee avec succes.');
}

main().catch((err) => {
  console.error('Erreur de migration :', err.message);
  process.exit(1);
});
