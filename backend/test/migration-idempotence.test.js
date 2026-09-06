// Verifie que relancer migrate-sqlite.js plusieurs fois sur le MEME fichier (le cas reel
// d'une base de developpement/client existante, migree a chaque nouvelle fonctionnalite) ne
// duplique jamais les lignes de seed ("ecole", "niveaux") qui n'ont pas de contrainte UNIQUE
// autre que leur id auto-incremente -- "INSERT OR IGNORE" seul ne protege pas contre ca.
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

test('relancer la migration plusieurs fois ne duplique pas "ecole" ni "niveaux"', async () => {
  const dbFile = path.join(os.tmpdir(), `ecolepay-migration-idem-${crypto.randomBytes(6).toString('hex')}.sqlite`);
  const migratePath = path.join(__dirname, '../src/migrate-sqlite.js');
  const env = { ...process.env, SQLITE_FILE: dbFile, DB_CLIENT: 'sqlite' };

  try {
    execFileSync(process.execPath, [migratePath], { env, stdio: 'pipe' });
    execFileSync(process.execPath, [migratePath], { env, stdio: 'pipe' });
    execFileSync(process.execPath, [migratePath], { env, stdio: 'pipe' });

    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    const [{ n: nbEcoles }] = await db.all('SELECT COUNT(*) as n FROM ecole');
    const [{ n: nbNiveaux }] = await db.all('SELECT COUNT(*) as n FROM niveaux');
    await db.close();

    assert.equal(nbEcoles, 1, 'une seule ligne "ecole" apres 3 migrations successives');
    assert.equal(nbNiveaux, 3, 'toujours 3 niveaux (Maternelle/Primaire/Secondaire) apres 3 migrations successives');
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbFile + suffix); } catch (e) { /* deja absent, ignore */ }
    }
  }
});
