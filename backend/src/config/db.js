require('dotenv').config();
if (!process.env.TZ) process.env.TZ = 'Africa/Kinshasa';

if ((process.env.DB_CLIENT || '').toLowerCase() === 'sqlite') {
  // sqlite fallback: expose a `query(sql, params)` async function similar to mysql2
  const fs = require('fs');
  const path = require('path');
  const sqlite3 = require('sqlite3');
  const { open } = require('sqlite');

  // default to backend/database (matches migrate-sqlite.js)
  const dbFile = process.env.SQLITE_FILE || path.join(__dirname, '../../database/ecolepay.sqlite');

  async function createConnection() {
    // ensure directory exists
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    // enable foreign keys
    await db.run('PRAGMA foreign_keys = ON');
    // WAL (Write-Ahead Logging) au lieu du journal par defaut : les lecteurs (dashboard,
    // rapports...) ne bloquent plus les ecrivains (caisse, comptabilite...) et vice-versa,
    // ce qui est important des que plusieurs postes du reseau local utilisent le logiciel
    // en meme temps -- et WAL survit bien mieux a une coupure de courant en plein
    // encaissement qu'un journal rollback classique.
    await db.run('PRAGMA journal_mode = WAL');
    // synchronous=NORMAL est le reglage recommande avec WAL : securite suffisante contre
    // la corruption (toujours sur en cas de crash de l'appli) pour un net gain de vitesse
    // par rapport a FULL, sans les risques de synchronous=OFF.
    await db.run('PRAGMA synchronous = NORMAL');
    // Si deux ecritures se chevauchent malgre tout (deux caisses qui valident au meme
    // instant), la seconde attend jusqu'a 5s au lieu d'echouer immediatement avec
    // "database is locked" -- une erreur auparavant possible, maintenant tres rare.
    await db.run('PRAGMA busy_timeout = 5000');
    return db;
  }

  let _dbPromise = null;
  function getDb() {
    if (!_dbPromise) _dbPromise = createConnection();
    return _dbPromise;
  }

  function translateSql(sql) {
    return sql
      // Traiter DATE_SUB avant NOW : le remplacement de NOW contient une
      // virgule, que l'expression reguliere DATE_SUB ne doit pas capturer.
      .replace(/DATE_SUB\(NOW\(\),\s*INTERVAL\s*(\d+)\s*MONTH\)/gi, "datetime('now','localtime','-$1 months')")
      .replace(/\bNOW\(\)/gi, "datetime('now','localtime')")
      .replace(/\bCURDATE\(\)/gi, "date('now','localtime')")
      .replace(/DATE\(([^)]+)\)/gi, 'date($1)')
      .replace(/\bYEAR\(([^)]+)\)/gi, "strftime('%Y',$1)")
      .replace(/\bMONTH\(([^)]+)\)/gi, "strftime('%m',$1)")
      .replace(/DATE_FORMAT\(([^,]+),\s*'([^']+)'\)/gi, (_match, expr, fmt) => {
        const format = fmt
          .replace('%Y', '%Y')
          .replace('%m', '%m')
          .replace('%b', '%m')
          .replace('%d', '%d');
        return `strftime('${format}', ${expr})`;
      })
      .replace(/DATE_SUB\(([^,]+),\s*INTERVAL\s*(\d+)\s*MONTH\)/gi, "date($1, '-$2 months')");
  }

  async function query(sql, params = []) {
    const db = await getDb();
    const translatedSql = translateSql(sql);
    const trim = translatedSql.trim().toLowerCase();
    try {
      if (trim.startsWith('select') || trim.startsWith('pragma')) {
        const rows = await db.all(translatedSql, params);
        return [rows, []];
      }
      const result = await db.run(translatedSql, params);
      return [{ affectedRows: result.changes, insertId: result.lastID }, []];
    } catch (err) {
      throw err;
    }
  }
  // Simulate a connection object with transaction helpers
  async function getConnection() {
    const db = await getDb();
    return {
      query: async (sql, params = []) => {
        let translatedSql = translateSql(sql);
        if (/ON DUPLICATE KEY UPDATE/i.test(translatedSql) && /INSERT INTO parametres/i.test(translatedSql)) {
          translatedSql = translatedSql.replace(/ON DUPLICATE KEY UPDATE\s+valeur\s*=\s*VALUES\(valeur\)/i,
            'ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur');
        }
        const trimmed = translatedSql.trim().toLowerCase();
        if (trimmed.startsWith('select') || trimmed.startsWith('pragma')) {
          const rows = await db.all(translatedSql, params);
          return [rows, []];
        }
        const result = await db.run(translatedSql, params);
        return [{ affectedRows: result.changes, insertId: result.lastID }, []];
      },
      beginTransaction: async () => db.run('BEGIN TRANSACTION'),
      commit: async () => db.run('COMMIT'),
      rollback: async () => db.run('ROLLBACK'),
      release: () => {},
    };
  }

  // Ferme la connexion sqlite sous-jacente : necessaire notamment pour les tests
  // automatises, qui suppriment leur fichier de base temporaire juste apres -- sur
  // Windows, un fichier encore ouvert par ce processus ne peut pas etre supprime
  // (verrou de fichier) tant que sa connexion n'a pas ete explicitement fermee.
  async function close() {
    if (!_dbPromise) return;
    const db = await _dbPromise;
    _dbPromise = null;
    await db.close();
  }

  module.exports = { query, getConnection, close };
} else {
  const mysql = require('mysql2/promise');

  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'ecolepay',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true,
    timezone: '+01:00',
  });

  module.exports = pool;
}
