export type SqlValue = string | number | null;
export interface SqlConnection {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  close(): Promise<void>;
}
export async function atomic<T>(db: SqlConnection, work: () => Promise<T>): Promise<T> {
  await db.exec('BEGIN IMMEDIATE');
  try { const result = await work(); await db.exec('COMMIT'); return result; }
  catch (error) { await db.exec('ROLLBACK'); throw error; }
}
