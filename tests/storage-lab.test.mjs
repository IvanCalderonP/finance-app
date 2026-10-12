import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createLab, migrate, parseSnapshot, replaceSnapshot } from '../src/database/technical/lab.ts';

function adapter(path) {
  const db = new DatabaseSync(path);
  return {
    exec: async sql => { db.exec(sql); },
    run: async (sql, parameters = []) => { db.prepare(sql).run(...parameters); },
    all: async sql => db.prepare(sql).all(),
    close: async () => { db.close(); },
  };
}
async function fixture(work) {
  const directory = mkdtempSync(join(tmpdir(), 'finance-synthetic-'));
  const path = join(directory, 'lab.db');
  const lab = createLab(async () => adapter(path));
  try { await work({ lab, path, directory }); }
  finally { await lab.close(); rmSync(directory, { recursive: true, force: true }); }
}
test('migration is repeatable; opening does not seed or mask persistence', () => fixture(async ({ lab }) => {
  assert.deepEqual((await lab.inspect()).samples, []);
  await lab.reopen(); assert.deepEqual((await lab.inspect()).samples, []);
  await lab.seed(); const initial = await lab.inspect();
  assert.deepEqual(await lab.reopen(), initial);
}));
test('commit, rollback, FK and roundtrip execute actual shared SQL', () => fixture(async ({ lab }) => {
  await lab.seed(); const before = await lab.inspect();
  assert.equal((await lab.diagnose()).length, 4);
  assert.deepEqual(await lab.inspect(), before);
}));
test('persistence survives a second process, without seeding', () => fixture(async ({ lab, path }) => {
  await lab.seed(); await lab.close();
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);console.log(db.prepare(\"SELECT value FROM lab_samples WHERE id='lab-persist'\").get().value);db.close();", path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), '1');
  assert.equal((await lab.inspect()).samples.find(row => row.id === 'lab-persist').value, 1);
}));
test('export/file/import replaces and is idempotent', () => fixture(async ({ lab, directory }) => {
  await lab.seed(); const text = await lab.exportText();
  const file = join(directory, 'synthetic.json'); writeFileSync(file, text);
  await lab.seed();
  await lab.restoreText(readFileSync(file, 'utf8')); assert.equal(await lab.exportText(), text);
  await lab.restoreText(text); assert.equal(await lab.exportText(), text);
}));
test('reject malformed, duplicate, future and non-synthetic backups without modifying DB', () => fixture(async ({ lab }) => {
  await lab.seed(); const before = await lab.exportText();
  for (const modify of [
    x => { x.kind = 'real-finance'; }, x => { x.schemaVersion = 2; },
    x => { x.samples.push(x.samples[0]); }, x => { x.samples[0].value = 1.5; },
    x => { x.samples[0].parent_id = 'missing'; }, x => { x.samples[0].note = 'not permitted'; },
  ]) {
    const x = JSON.parse(before); modify(x);
    await assert.rejects(lab.restoreText(JSON.stringify(x)));
    assert.equal(await lab.exportText(), before);
  }
  assert.throws(() => parseSnapshot('{'));
  assert.throws(() => parseSnapshot(' '.repeat(16001)));
}));
test('failure during replacement rolls back deleted and inserted rows', () => fixture(async ({ lab, path }) => {
  await lab.seed(); const before = await lab.exportText(); await lab.close();
  const db = adapter(path); await migrate(db);
  await db.exec("CREATE TRIGGER lab_fault BEFORE INSERT ON lab_samples BEGIN SELECT RAISE(ABORT,'TEST_FAILURE'); END;");
  try {
    await assert.rejects(replaceSnapshot(db, parseSnapshot(before)), /TEST_FAILURE/);
  } finally { await db.exec('DROP TRIGGER lab_fault'); await db.close(); }
  assert.equal(await lab.exportText(), before);
}));
test('single-owner queue serializes writes with close and export', () => fixture(async ({ lab }) => {
  await Promise.all([lab.seed(), lab.seed(), lab.reopen(), lab.seed()]);
  assert.equal((await lab.inspect()).samples.find(row => row.id === 'lab-persist').value, 3);
}));
test('FK is enabled again on every new connection; invalid parent fails', () => fixture(async ({ lab, path }) => {
  await lab.seed(); await lab.close();
  const db = adapter(path); await migrate(db);
  try { await assert.rejects(db.run("UPDATE lab_samples SET parent_id='missing' WHERE id='lab-seed'"), /FOREIGN KEY/); }
  finally { await db.close(); }
  assert.equal((await lab.inspect()).samples[0].parent_id, 'lab-demo');
}));
test('future migration version is rejected without rewriting it', () => fixture(async ({ lab, path }) => {
  await lab.inspect(); await lab.close();
  const db = adapter(path); await db.exec('PRAGMA user_version=2');
  try {
    await assert.rejects(migrate(db), /Esquema futuro/);
    assert.equal((await db.all('PRAGMA user_version'))[0].user_version, 2);
  } finally { await db.exec('PRAGMA user_version=1'); await db.close(); }
}));
test('a failed first migration rolls back schema and version together', async () => {
  const db = adapter(':memory:');
  const failing = {
    ...db,
    exec: async sql => {
      if (sql.includes('CREATE TABLE lab_parents')) {
        await db.exec('CREATE TABLE lab_parents (id TEXT PRIMARY KEY)');
        throw new Error('MIGRATION_FAILURE');
      }
      await db.exec(sql);
    },
  };
  try {
    await assert.rejects(migrate(failing), /MIGRATION_FAILURE/);
    assert.equal((await db.all('PRAGMA user_version'))[0].user_version, 0);
    assert.deepEqual(await db.all("SELECT name FROM sqlite_master WHERE type='table'"), []);
    await migrate(db); assert.equal((await db.all('PRAGMA user_version'))[0].user_version, 1);
  } finally { await db.close(); }
});
test('interrupted diagnostics recover without resetting the persistence marker', () => fixture(async ({ lab, path }) => {
  await lab.seed(); const before = await lab.exportText(); await lab.close();
  const db = adapter(path); await migrate(db);
  await db.run("INSERT INTO lab_samples VALUES ('lab-probe','lab-demo',7,'SYNTHETIC')");
  await db.close();
  assert.equal(await lab.exportText(), before);
  assert.equal((await lab.diagnose()).length, 4);
}));
