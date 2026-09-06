// Cree une base SQLite temporaire et isolee pour un fichier de test, en reutilisant le
// meme script de migration que l'installation reelle (src/migrate-sqlite.js) -- garantit
// que les tests tournent sur exactement le meme schema que la production, sans jamais
// toucher la base de developpement/demo.
//
// IMPORTANT : setupTestDb() doit etre appele en tout premier dans un fichier de test, avant
// tout autre require qui touche (directement ou indirectement) src/config/db.js -- celui-ci
// met en cache sa connexion des le premier appel, en lisant SQLITE_FILE a cet instant precis.
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function setupTestDb() {
  const dbFile = path.join(os.tmpdir(), `ecolepay-test-${crypto.randomBytes(6).toString('hex')}.sqlite`);
  execFileSync(process.execPath, [path.join(__dirname, '../../src/migrate-sqlite.js')], {
    env: { ...process.env, SQLITE_FILE: dbFile, DB_CLIENT: 'sqlite' },
    stdio: 'pipe',
  });
  process.env.SQLITE_FILE = dbFile;
  process.env.DB_CLIENT = 'sqlite';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-ne-jamais-utiliser-en-production';
  return dbFile;
}

// async : ferme d'abord la connexion sqlite avant de supprimer le fichier -- sur Windows,
// un fichier encore ouvert par ce meme processus ne peut pas etre supprime (verrou), la
// suppression echouerait silencieusement (try/catch) sans jamais liberer l'espace disque.
async function teardownTestDb(dbFile) {
  try { await require('../../src/config/db').close(); } catch (e) { /* deja ferme, ignore */ }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbFile + suffix); } catch (e) { /* deja absent, ignore */ }
  }
}

module.exports = { setupTestDb, teardownTestDb };
