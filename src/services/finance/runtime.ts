import { createDebtApplication } from './debt-application';
import { createCreditCardApplication } from './card-application';
import { createFinanceApplication } from './application';
import { createSqliteUnitOfWork } from '../../database/finance/repositories';
import { FINANCE_DATABASE_NAME } from '../../database/finance/migrations';
import type { Runtime } from './contracts';
import type { SqlConnection } from '../../database/finance/connection';

// IDs and platform access are outside the Financial Engine.
const runtime: Runtime = {
  id: () => {
    if (!idGenerator) throw new Error('El generador local no está listo');
    return idGenerator();
  },
  now: () => new Date().toISOString(),
};
let idGenerator: (() => string) | undefined;
export async function initializeRuntime() {
  const crypto = await import('expo-crypto');
  idGenerator = crypto.randomUUID;
}
export async function newOperationKey() {
  await initializeRuntime(); return runtime.id();
}
const unit = createSqliteUnitOfWork(async (): Promise<SqlConnection> => {
  await initializeRuntime();
  const SQLite = await import('expo-sqlite');
  // Replace this adapter later for encrypted SQLite; no UI/domain changes required.
  const db = await SQLite.openDatabaseAsync(FINANCE_DATABASE_NAME, { useNewConnection: true });
  return {
    exec: sql => db.execAsync(sql),
    run: async (sql, parameters = []) => { await db.runAsync(sql, parameters); },
    all: <T>(sql: string, parameters = []) => db.getAllAsync<T>(sql, parameters),
    close: () => db.closeAsync(),
  };
}, runtime);
export const finance = createFinanceApplication(unit, runtime);
export const creditCards = createCreditCardApplication(unit, runtime);

export const debts = createDebtApplication(unit, runtime);
