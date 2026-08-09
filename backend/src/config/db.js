require('dotenv').config();

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
    return db;
  }

  let _dbPromise = null;
  function getDb() {
    if (!_dbPromise) _dbPromise = createConnection();
    return _dbPromise;
  }

  function translateSql(sql) {
    return sql
      .replace(/\bNOW\(\)/gi, "CURRENT_TIMESTAMP")
      .replace(/\bCURDATE\(\)/gi, "date('now')")
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

  module.exports = { query, getConnection };
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
  });

  module.exports = pool;
}
