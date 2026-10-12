import { sqliteCardRepository } from './card-repositories.ts';
import type { Account, Category, Entry, LedgerNode, Profile, Split, Transaction } from '../../financial-engine/model.ts';
import { assert } from '../../financial-engine/model.ts';
import type { Repositories, Runtime, UnitOfWork } from '../../services/finance/contracts.ts';
import type { SqlConnection } from './connection.ts';
import { atomic } from './connection.ts';
import { migrateFinance } from './migrations.ts';

const accountColumns = 'id, profile_id AS profileId, name, type, currency, availability_policy AS availabilityPolicy, active, ledger_node_id AS nodeId, created_at AS createdAt';
type AccountRow = Omit<Account, 'active'> & { active: number };
const account = (row: AccountRow): Account => ({ id: row.id, profileId: row.profileId, name: row.name, type: row.type, currency: row.currency, availabilityPolicy: row.availabilityPolicy, active: row.active === 1, nodeId: row.nodeId, createdAt: row.createdAt });
const transactionColumns = `id,profile_id AS profileId,currency,type,subtype,idempotency_key AS idempotencyKey,
 effective_date AS effectiveDate,created_at AS createdAt,description,reversal_of AS reversalOf`;
type TransactionRow = Omit<Transaction, 'entries' | 'splits'>;

export function sqliteRepositories(db: SqlConnection, runtime: Runtime): Repositories {
  async function hydrate(row: TransactionRow): Promise<Transaction> {
    return { ...row,
      entries: (await db.all<Entry>('SELECT ledger_node_id AS nodeId,debit_minor AS debitMinor,credit_minor AS creditMinor FROM transaction_entries WHERE profile_id=? AND transaction_id=? ORDER BY rowid', [row.profileId, row.id])).map(entry => ({ ...entry })),
      splits: (await db.all<Split>('SELECT category_id AS categoryId,amount_minor AS amountMinor FROM transaction_splits WHERE profile_id=? AND transaction_id=? ORDER BY rowid', [row.profileId, row.id])).map(split => ({ ...split })),
    };
  }
  const repositories: Repositories = {
    cards: sqliteCardRepository(db, runtime),
    profiles: {
      async initial() {
        const rows = await db.all<Profile>("SELECT id,name,currency,created_at AS createdAt FROM profiles WHERE local_key='initial'");
        if (rows[0]) return rows[0];
        const profile = { id: runtime.id(), name: 'Perfil LOCAL', currency: 'USD', createdAt: runtime.now() };
        await db.run('INSERT INTO profiles VALUES(?,?,?,?,?)', [profile.id, 'initial', profile.name, profile.currency, profile.createdAt]);
        const names = ['Comida', 'Transporte', 'Servicios', 'Compras', 'Entretenimiento', 'Gastos cotidianos', 'Otros'];
        for (const [index, name] of names.entries())
          await db.run('INSERT INTO categories VALUES(?,?,?,?,?,?)', [runtime.id(), profile.id, name, 'EXPENSE', index === 5 ? 'daily' : `expense-${index}`, runtime.now()]);
        await db.run('INSERT INTO categories VALUES(?,?,?,?,?,?)', [runtime.id(), profile.id, 'Ingresos', 'INCOME', 'income', runtime.now()]);
        return profile;
      },
    },
    accounts: {
      async list(profileId) { return (await db.all<AccountRow>(`SELECT ${accountColumns} FROM accounts WHERE profile_id=? ORDER BY created_at,rowid`, [profileId])).map(account); },
      async find(profileId, id) { const rows = await db.all<AccountRow>(`SELECT ${accountColumns} FROM accounts WHERE profile_id=? AND id=?`, [profileId, id]); return rows[0] ? account(rows[0]) : undefined; },
      async byCreationKey(profileId, key) {
        const rows = await db.all<AccountRow & { creation_request: string }>(`SELECT ${accountColumns},creation_request FROM accounts WHERE profile_id=? AND creation_key=?`, [profileId, key]);
        return rows[0] ? { account: account(rows[0]), fingerprint: rows[0].creation_request } : undefined;
      },
      async insert(value, key, fingerprint) {
        await db.run('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?,?,?,?)', [value.id, value.profileId, value.name, value.type, value.currency, value.availabilityPolicy, value.active ? 1 : 0, value.nodeId, key, fingerprint, value.createdAt]);
      },
      async configure(profileId, id, active, policy) {
        await db.run('UPDATE accounts SET active=?,availability_policy=? WHERE profile_id=? AND id=?', [active ? 1 : 0, policy, profileId, id]);
      },
    },
    ledger: {
      async entries(profileId) {
        return db.all<Entry>(`SELECT e.ledger_node_id AS nodeId,e.debit_minor AS debitMinor,e.credit_minor AS creditMinor
          FROM transaction_entries e JOIN transactions t ON t.id=e.transaction_id WHERE e.profile_id=? AND t.status='POSTED' ORDER BY e.rowid`, [profileId]);
      },
      async insertNode(node) {
        await db.run('INSERT INTO ledger_nodes VALUES(?,?,?,?,?,?)', [node.id, node.profileId, node.currency, node.kind, null, runtime.now()]);
      },
      async systemNode(profileId, currency, kind) {
        const rows = await db.all<LedgerNode>('SELECT id,profile_id AS profileId,currency,kind FROM ledger_nodes WHERE profile_id=? AND currency=? AND system_key=?', [profileId, currency, kind]);
        if (rows[0]) return rows[0];
        const node = { id: runtime.id(), profileId, currency, kind };
        await db.run('INSERT INTO ledger_nodes VALUES(?,?,?,?,?,?)', [node.id, profileId, currency, kind, kind, runtime.now()]);
        return node;
      },
    },
    categories: { async list(profileId) { return db.all<Category>('SELECT id,profile_id AS profileId,name,kind,code FROM categories WHERE profile_id=? ORDER BY rowid', [profileId]); } },
    transactions: {
      async list(profileId) {
        const rows = await db.all<TransactionRow>(`SELECT ${transactionColumns} FROM transactions WHERE profile_id=? AND status='POSTED' ORDER BY effective_date DESC,created_at DESC,rowid DESC`, [profileId]);
        return Promise.all(rows.map(hydrate));
      },
      async find(profileId, id) {
        const rows = await db.all<TransactionRow>(`SELECT ${transactionColumns} FROM transactions WHERE profile_id=? AND id=? AND status='POSTED'`, [profileId, id]);
        return rows[0] ? hydrate(rows[0]) : undefined;
      },
      async byKey(profileId, key) {
        const rows = await db.all<TransactionRow & { request_fingerprint: string }>(`SELECT ${transactionColumns},request_fingerprint FROM transactions WHERE profile_id=? AND idempotency_key=? AND status='POSTED'`, [profileId, key]);
        if (!rows[0]) return undefined;
        const { request_fingerprint: fingerprint, ...row } = rows[0];
        return { transaction: await hydrate(row), fingerprint };
      },
      async reversedBy(profileId, originalId) {
        const rows = await db.all<TransactionRow>(`SELECT ${transactionColumns} FROM transactions WHERE profile_id=? AND reversal_of=? AND status='POSTED'`, [profileId, originalId]);
        return rows[0] ? hydrate(rows[0]) : undefined;
      },
      async insert(value, fingerprint) {
        await db.run('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [value.id, value.profileId, value.currency, value.type, value.subtype, 'DRAFT', value.effectiveDate, value.createdAt, value.description, value.idempotencyKey, fingerprint, value.reversalOf]);
        for (const entry of value.entries)
          await db.run('INSERT INTO transaction_entries VALUES(?,?,?,?,?,?,?)', [runtime.id(), value.profileId, value.id, value.currency, entry.nodeId, entry.debitMinor, entry.creditMinor]);
        for (const split of value.splits)
          await db.run('INSERT INTO transaction_splits VALUES(?,?,?,?,?)', [runtime.id(), value.profileId, value.id, split.categoryId, split.amountMinor]);
        await db.run("UPDATE transactions SET status='POSTED' WHERE id=? AND profile_id=?", [value.id, value.profileId]);
      },
      async replaceSplits(profileId, transactionId, splits) {
        await db.run('DELETE FROM transaction_splits WHERE profile_id=? AND transaction_id=?', [profileId, transactionId]);
        for (const split of splits)
          await db.run('INSERT INTO transaction_splits VALUES(?,?,?,?,?)', [runtime.id(), profileId, transactionId, split.categoryId, split.amountMinor]);
      },
    },
  };
  return repositories;
}
export function createSqliteUnitOfWork(open: () => Promise<SqlConnection>, runtime: Runtime): UnitOfWork {
  let connection: SqlConnection | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  function queue<T>(operation: () => Promise<T>): Promise<T> {
    const next = tail.then(operation); tail = next.catch(() => undefined); return next;
  }
  return {
    execute: work => queue(async () => {
      if (!connection) {
        const candidate = await open();
        try { await migrateFinance(candidate, runtime.now()); connection = candidate; }
        catch (error) { await candidate.close(); throw error; }
      }
      const db = connection;
      assert(db !== undefined, 'Conexión no disponible');
      return atomic(db, async () => {
        const result = await work(sqliteRepositories(db, runtime));
        const drafts = await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM transactions WHERE status='DRAFT'");
        assert(drafts[0].count === 0, 'No se puede confirmar una operación incompleta');
        return result;
      });
    }),
    close: () => queue(async () => { if (connection) { await connection.close(); connection = undefined; } }),
  };
}
