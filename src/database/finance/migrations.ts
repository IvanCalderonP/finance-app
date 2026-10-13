import { MIGRATION_003 } from './migration003.ts';
import { MIGRATION_002 } from './migration002.ts';
import { atomic } from './connection.ts';
import type { SqlConnection } from './connection.ts';
import { assert } from '../../financial-engine/model.ts';
export const FINANCE_DATABASE_NAME = 'finance-local-v1.db';
export const MIGRATION_001 = `
CREATE TABLE profiles (
 id TEXT PRIMARY KEY CHECK(length(id)=36), local_key TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL, currency TEXT NOT NULL CHECK(length(currency)=3), created_at TEXT NOT NULL
);
CREATE TABLE ledger_nodes (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL REFERENCES profiles(id),
 currency TEXT NOT NULL CHECK(length(currency)=3), kind TEXT NOT NULL CHECK(kind IN ('ASSET','EQUITY','INCOME','EXPENSE')),
 system_key TEXT, created_at TEXT NOT NULL,
 UNIQUE(profile_id, id, currency), UNIQUE(profile_id,currency,system_key)
);
CREATE TABLE accounts (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL REFERENCES profiles(id),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
 type TEXT NOT NULL CHECK(type IN ('bank','savings','custom','cash')), currency TEXT NOT NULL,
 availability_policy TEXT NOT NULL CHECK(availability_policy IN ('free','protected')),
 active INTEGER NOT NULL CHECK(active IN (0,1)), ledger_node_id TEXT NOT NULL UNIQUE,
 creation_key TEXT NOT NULL, creation_request TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(profile_id,ledger_node_id,currency) REFERENCES ledger_nodes(profile_id,id,currency),
 UNIQUE(profile_id,creation_key), UNIQUE(profile_id,id,currency)
);
CREATE TABLE categories (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL REFERENCES profiles(id),
 name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('INCOME','EXPENSE')), code TEXT NOT NULL,
 created_at TEXT NOT NULL, UNIQUE(profile_id,code), UNIQUE(profile_id,id)
);
CREATE TABLE transactions (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL REFERENCES profiles(id),
 currency TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('OPENING','INCOME','EXPENSE','TRANSFER','ADJUSTMENT','REVERSAL')),
 subtype TEXT NOT NULL CHECK(subtype IN ('regular','daily')),
 status TEXT NOT NULL CHECK(status IN ('DRAFT','POSTED')), effective_date TEXT NOT NULL, created_at TEXT NOT NULL,
 description TEXT NOT NULL CHECK(length(description)<=500), idempotency_key TEXT NOT NULL,
 request_fingerprint TEXT NOT NULL, reversal_of TEXT,
 UNIQUE(profile_id,idempotency_key), UNIQUE(profile_id,id,currency), UNIQUE(profile_id,id), UNIQUE(profile_id,reversal_of),
 FOREIGN KEY(profile_id,reversal_of) REFERENCES transactions(profile_id,id),
 CHECK((type='REVERSAL' AND reversal_of IS NOT NULL) OR (type!='REVERSAL' AND reversal_of IS NULL))
);
CREATE TABLE transaction_entries (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL, transaction_id TEXT NOT NULL,
 currency TEXT NOT NULL, ledger_node_id TEXT NOT NULL,
 debit_minor INTEGER NOT NULL CHECK(typeof(debit_minor)='integer' AND debit_minor BETWEEN 0 AND 9007199254740991),
 credit_minor INTEGER NOT NULL CHECK(typeof(credit_minor)='integer' AND credit_minor BETWEEN 0 AND 9007199254740991),
 CHECK((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0)),
 FOREIGN KEY(profile_id,transaction_id,currency) REFERENCES transactions(profile_id,id,currency),
 FOREIGN KEY(profile_id,ledger_node_id,currency) REFERENCES ledger_nodes(profile_id,id,currency)
);
CREATE TABLE transaction_splits (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL, transaction_id TEXT NOT NULL,
 category_id TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor!=0 AND amount_minor BETWEEN -9007199254740991 AND 9007199254740991),
 FOREIGN KEY(profile_id,transaction_id) REFERENCES transactions(profile_id,id),
 FOREIGN KEY(profile_id,category_id) REFERENCES categories(profile_id,id), UNIQUE(transaction_id,category_id)
);
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE INDEX entries_node ON transaction_entries(profile_id,ledger_node_id);
CREATE INDEX entries_transaction ON transaction_entries(profile_id,transaction_id);
CREATE INDEX transactions_date ON transactions(profile_id,effective_date,created_at);
CREATE INDEX splits_category ON transaction_splits(profile_id,category_id);
CREATE TRIGGER post_balanced BEFORE UPDATE OF status ON transactions WHEN NEW.status='POSTED' BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM transaction_entries WHERE transaction_id=NEW.id)<2
 OR (SELECT SUM(debit_minor)-SUM(credit_minor) FROM transaction_entries WHERE transaction_id=NEW.id)!=0
 THEN RAISE(ABORT,'Unbalanced transaction') END;
 SELECT CASE WHEN NEW.type IN ('INCOME','EXPENSE','REVERSAL') AND
 COALESCE((SELECT SUM(amount_minor) FROM transaction_splits WHERE transaction_id=NEW.id),0) !=
 COALESCE((SELECT SUM(CASE n.kind WHEN 'EXPENSE' THEN e.debit_minor-e.credit_minor WHEN 'INCOME' THEN e.credit_minor-e.debit_minor ELSE 0 END)
 FROM transaction_entries e JOIN ledger_nodes n ON n.id=e.ledger_node_id WHERE e.transaction_id=NEW.id),0)
 THEN RAISE(ABORT,'Invalid split total') END;
END;
CREATE TRIGGER prevent_posted_insert BEFORE INSERT ON transactions WHEN NEW.status='POSTED' BEGIN SELECT RAISE(ABORT,'Post through ledger'); END;
CREATE TRIGGER immutable_transaction BEFORE UPDATE ON transactions WHEN OLD.status='POSTED' BEGIN SELECT RAISE(ABORT,'Immutable transaction'); END;
CREATE TRIGGER no_delete_transaction BEFORE DELETE ON transactions WHEN OLD.status='POSTED' BEGIN SELECT RAISE(ABORT,'Immutable transaction'); END;
CREATE TRIGGER no_new_posted_entry BEFORE INSERT ON transaction_entries WHEN (SELECT status FROM transactions WHERE id=NEW.transaction_id)='POSTED' BEGIN SELECT RAISE(ABORT,'Immutable entry'); END;
CREATE TRIGGER immutable_entry BEFORE UPDATE ON transaction_entries WHEN (SELECT status FROM transactions WHERE id=OLD.transaction_id)='POSTED' BEGIN SELECT RAISE(ABORT,'Immutable entry'); END;
CREATE TRIGGER no_delete_entry BEFORE DELETE ON transaction_entries WHEN (SELECT status FROM transactions WHERE id=OLD.transaction_id)='POSTED' BEGIN SELECT RAISE(ABORT,'Immutable entry'); END;
CREATE TRIGGER valid_reversal BEFORE INSERT ON transactions WHEN NEW.type='REVERSAL' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.reversal_of AND profile_id=NEW.profile_id AND status='POSTED' AND type!='REVERSAL')
 THEN RAISE(ABORT,'Invalid reversal') END;
END;
`;
export async function migrateFinance(db: SqlConnection, timestamp: string) {
  await db.exec('PRAGMA foreign_keys=ON');
  const fk = await db.all<{ foreign_keys: number }>('PRAGMA foreign_keys');
  assert(fk[0]?.foreign_keys === 1, 'No se pudieron activar las relaciones');
  const version = (await db.all<{ user_version: number }>('PRAGMA user_version'))[0].user_version;
  assert(version <= 3, 'La base pertenece a una versión futura');
  if (version === 0) await atomic(db, async () => {
    // Recheck after obtaining the writer lock, including another connection's migration.
    const current = (await db.all<{ user_version: number }>('PRAGMA user_version'))[0].user_version;
    if (current === 0) {
      await db.exec(MIGRATION_001);
      await db.run('INSERT INTO schema_migrations VALUES(?,?)', [1, timestamp]);
      await db.exec('PRAGMA user_version=1');
    }
  });
  if ((await db.all<{ user_version: number }>('PRAGMA user_version'))[0].user_version < 2) {
    // SQLite's documented table rebuild requires FK suspension outside the transaction.
    // The private connection is unavailable to application work until validation succeeds.
    await db.exec('PRAGMA foreign_keys=OFF');
    try {
      await atomic(db, async () => {
        const current = (await db.all<{ user_version: number }>('PRAGMA user_version'))[0].user_version;
        if (current === 2) return;
        assert(current === 1, 'Versión de migración inesperada');
        await db.exec(MIGRATION_002);
        await db.exec(MIGRATION_001.slice(MIGRATION_001.indexOf('CREATE TRIGGER post_balanced'), MIGRATION_001.indexOf('CREATE TRIGGER prevent_posted_insert')));
        assert((await db.all('PRAGMA foreign_key_check')).length === 0, 'Relaciones inválidas después de migrar');
        await db.run('INSERT INTO schema_migrations VALUES(?,?)', [2, timestamp]);
        await db.exec('PRAGMA user_version=2');
      });
    } finally {
      await db.exec('PRAGMA foreign_keys=ON');
      assert((await db.all<{ foreign_keys: number }>('PRAGMA foreign_keys'))[0].foreign_keys === 1, 'Relaciones desactivadas');
    }
  }

  if ((await db.all<{ user_version: number }>('PRAGMA user_version'))[0].user_version < 3) {
    await atomic(db, async () => {
      const current = (await db.all<{ user_version: number }>('PRAGMA user_version'))[0].user_version;
      if (current === 3) return;
      assert(current === 2, 'Versión de migración inesperada');
      await db.exec(MIGRATION_003);
      assert((await db.all('PRAGMA foreign_key_check')).length === 0, 'Relaciones inválidas después de migrar deudas');
      await db.run('INSERT INTO schema_migrations VALUES(?,?)', [3, timestamp]);
      await db.exec('PRAGMA user_version=3');
    });
  }

}
