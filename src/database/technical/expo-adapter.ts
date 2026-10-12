import { createLab } from './lab';
import { DATABASE_NAME } from './schema';

export const lab = createLab(async () => {
  // SQLite/worker must load only when the local lab opens, never during SSR.
  const SQLite = await import('expo-sqlite');
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
  return {
    exec: sql => db.execAsync(sql),
    run: async (sql, parameters = []) => { await db.runAsync(sql, parameters); },
    all: <T>(sql: string) => db.getAllAsync<T>(sql),
    close: () => db.closeAsync(),
  };
});
