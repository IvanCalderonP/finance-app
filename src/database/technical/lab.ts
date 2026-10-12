import { MIGRATION_1, SCHEMA_VERSION } from './schema.ts';

export interface LabConnection {
  exec(sql: string): Promise<void>;
  run(sql: string, parameters?: (string | number)[]): Promise<void>;
  all<T>(sql: string): Promise<T[]>;
  close(): Promise<void>;
}
export type OpenLabConnection = () => Promise<LabConnection>;
export interface Sample { id: string; parent_id: string; value: number; tag: 'SYNTHETIC' }
export interface Snapshot {
  kind: 'FinanceApp_SYNTHETIC_LAB';
  formatVersion: 1;
  schemaVersion: 1;
  parents: { id: 'lab-demo'; tag: 'SYNTHETIC' }[];
  samples: Sample[];
}

export async function transaction<T>(db: LabConnection, operation: () => Promise<T>): Promise<T> {
  await db.exec('BEGIN IMMEDIATE');
  try {
    const result = await operation();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

export async function migrate(db: LabConnection) {
  await db.exec('PRAGMA foreign_keys = ON');
  const [{ foreign_keys }] = await db.all<{ foreign_keys: number }>('PRAGMA foreign_keys');
  if (foreign_keys !== 1) throw new Error('Foreign keys no están activas');
  const [{ user_version }] = await db.all<{ user_version: number }>('PRAGMA user_version');
  if (user_version > SCHEMA_VERSION) throw new Error('Esquema futuro no soportado');
  if (user_version === 0) await transaction(db, () => db.exec(MIGRATION_1));
  // A crash may leave the diagnostic-only probe; never remove the persistence marker.
  await db.run("DELETE FROM lab_samples WHERE id = 'lab-probe'");
}

export async function readSnapshot(db: LabConnection): Promise<Snapshot> {
  return {
    kind: 'FinanceApp_SYNTHETIC_LAB', formatVersion: 1, schemaVersion: 1,
    parents: await db.all('SELECT id, tag FROM lab_parents ORDER BY id'),
    samples: await db.all('SELECT id, parent_id, value, tag FROM lab_samples ORDER BY id'),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Objeto inválido');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).sort().join(',') !== expected.sort().join(',')) throw new Error('Campos no permitidos');
}
export function parseSnapshot(text: string): Snapshot {
  if (text.length > 16000) throw new Error('Archivo técnico demasiado grande');
  const data = object(JSON.parse(text));
  keys(data, ['kind', 'formatVersion', 'schemaVersion', 'parents', 'samples']);
  if (data.kind !== 'FinanceApp_SYNTHETIC_LAB' || data.formatVersion !== 1 || data.schemaVersion !== 1)
    throw new Error('Solo se admite el backup sintético V1 de este laboratorio');
  if (!Array.isArray(data.parents) || data.parents.length > 1 || !Array.isArray(data.samples) || data.samples.length > 2)
    throw new Error('Cantidad de filas no permitida');
  for (const row of data.parents) {
    const p = object(row); keys(p, ['id', 'tag']);
    if (p.id !== 'lab-demo' || p.tag !== 'SYNTHETIC') throw new Error('Padre sintético inválido');
  }
  const ids = new Set();
  for (const row of data.samples) {
    const p = object(row); keys(p, ['id', 'parent_id', 'value', 'tag']);
    if (!['lab-seed', 'lab-persist'].includes(p.id as string) || ids.has(p.id) ||
        p.parent_id !== 'lab-demo' || data.parents.length !== 1 || p.tag !== 'SYNTHETIC' ||
        !Number.isSafeInteger(p.value) || (p.value as number) < 0 || (p.value as number) > 1000000)
      throw new Error('Fila sintética inválida, duplicada o sin padre');
    ids.add(p.id);
  }
  return data as unknown as Snapshot;
}

export async function replaceSnapshot(db: LabConnection, snapshot: Snapshot) {
  // Validation is repeated at the boundary; callers cannot bypass it with a cast.
  const validated = parseSnapshot(JSON.stringify(snapshot));
  await transaction(db, async () => {
    await db.run('DELETE FROM lab_samples');
    await db.run('DELETE FROM lab_parents');
    for (const p of validated.parents) await db.run('INSERT INTO lab_parents VALUES (?, ?)', [p.id, p.tag]);
    for (const p of validated.samples)
      await db.run('INSERT INTO lab_samples VALUES (?, ?, ?, ?)', [p.id, p.parent_id, p.value, p.tag]);
  });
}

// A single owner serializes ALL access, including close/reopen/export/restore.
// This does not claim to solve cross-tab writers; those require separate tests.
export function createLab(open: OpenLabConnection) {
  let tail: Promise<unknown> = Promise.resolve();
  let connection: LabConnection | undefined;
  const queue = <T>(work: (db: LabConnection) => Promise<T>): Promise<T> => {
    const next = tail.then(async () => {
      if (!connection) {
        const candidate = await open();
        try { await migrate(candidate); connection = candidate; }
        catch (error) { await candidate.close(); throw error; }
      }
      return work(connection);
    });
    tail = next.catch(() => undefined);
    return next;
  };
  return {
    inspect: () => queue(readSnapshot),
    seed: () => queue(async db => {
      await transaction(db, async () => {
        await db.run("INSERT OR IGNORE INTO lab_parents VALUES ('lab-demo', 'SYNTHETIC')");
        await db.run("INSERT OR IGNORE INTO lab_samples VALUES ('lab-seed','lab-demo',42,'SYNTHETIC')");
        await db.run("INSERT OR IGNORE INTO lab_samples VALUES ('lab-persist','lab-demo',0,'SYNTHETIC')");
        await db.run("UPDATE lab_samples SET value = value + 1 WHERE id = 'lab-persist'");
      });
      return readSnapshot(db);
    }),
    reopen: () => queue(async db => {
      const before = await readSnapshot(db);
      await db.close(); connection = undefined;
      const reopened = await open();
      try {
        await migrate(reopened); connection = reopened;
        const after = await readSnapshot(reopened);
        if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Persistencia tras reabrir: fallo');
        return after;
      } catch (error) { await reopened.close(); connection = undefined; throw error; }
    }),
    exportText: () => queue(async db => JSON.stringify(await readSnapshot(db), null, 2)),
    restoreText: (text: string) => queue(async db => {
      await replaceSnapshot(db, parseSnapshot(text));
      return readSnapshot(db);
    }),
    diagnose: () => queue(async db => {
      const before = await readSnapshot(db);
      const checks: string[] = [];
      try {
        await transaction(db, async () => {
          await db.run("INSERT OR IGNORE INTO lab_parents VALUES ('lab-demo','SYNTHETIC')");
          await db.run("INSERT INTO lab_samples VALUES ('lab-probe','lab-demo',7,'SYNTHETIC')");
        });
        const committed = await db.all<{ value: number }>("SELECT value FROM lab_samples WHERE id = 'lab-probe'");
        if (committed[0]?.value !== 7) throw new Error('Commit no persistió');
        checks.push('Commit: OK');
        let rolledBack = false;
        try {
          await transaction(db, async () => {
            await db.run("UPDATE lab_samples SET value = 99 WHERE id = 'lab-probe'");
            throw new Error('LAB_EXPECTED_ROLLBACK');
          });
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'LAB_EXPECTED_ROLLBACK') throw error;
          rolledBack = true;
        }
        const rolled = await db.all<{ value: number }>("SELECT value FROM lab_samples WHERE id = 'lab-probe'");
        if (!rolledBack || rolled[0]?.value !== 7) throw new Error('Rollback falló');
        checks.push('Rollback: OK');
        let foreignKeyRejected = false;
        try { await db.run("INSERT INTO lab_samples VALUES ('lab-probe','missing',1,'SYNTHETIC') ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id"); }
        catch { foreignKeyRejected = true; }
        const violations = await db.all('PRAGMA foreign_key_check');
        const validParent = await db.all<{ parent_id: string }>("SELECT parent_id FROM lab_samples WHERE id = 'lab-probe'");
        if (!foreignKeyRejected || violations.length || validParent[0]?.parent_id !== 'lab-demo') throw new Error('Foreign key falló');
        checks.push('Foreign keys: OK');
      } finally { await replaceSnapshot(db, before); }
      if (JSON.stringify(before) !== JSON.stringify(await readSnapshot(db))) throw new Error('Restauración interna falló');
      checks.push('Snapshot / restauración interna: OK');
      return checks;
    }),
    close: () => queue(async db => { await db.close(); connection = undefined; }),
  };
}
