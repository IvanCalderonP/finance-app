export const MIGRATION_007=`
ALTER TABLE categories ADD COLUMN parent_id TEXT REFERENCES categories(id);
CREATE TABLE category_requests (
 profile_id TEXT NOT NULL REFERENCES profiles(id), idempotency_key TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES categories(id), fingerprint TEXT NOT NULL,
 PRIMARY KEY(profile_id,idempotency_key)
);
CREATE TRIGGER category_parent_insert BEFORE INSERT ON categories WHEN NEW.parent_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM categories WHERE id=NEW.parent_id AND profile_id=NEW.profile_id AND kind=NEW.kind)
 THEN RAISE(ABORT,'Incompatible category parent') END;
END;
CREATE TRIGGER category_parent_update BEFORE UPDATE OF parent_id,profile_id,kind ON categories BEGIN
 SELECT CASE WHEN OLD.profile_id!=NEW.profile_id OR OLD.kind!=NEW.kind OR OLD.parent_id IS NOT NEW.parent_id THEN RAISE(ABORT,'Category hierarchy immutable') END;
END;
CREATE TABLE split_edits (
 id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, transaction_id TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(profile_id,transaction_id) REFERENCES transactions(profile_id,id)
);
CREATE UNIQUE INDEX account_profile_identity ON accounts(profile_id,id);
CREATE TABLE account_availability_events (
 id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, account_id TEXT NOT NULL, effective_date TEXT NOT NULL,
 policy TEXT NOT NULL CHECK(policy IN ('free','protected')),created_at TEXT NOT NULL,
 FOREIGN KEY(profile_id,account_id) REFERENCES accounts(profile_id,id)
);
INSERT INTO account_availability_events
 SELECT a.id,a.profile_id,a.id,COALESCE((SELECT MIN(t.effective_date) FROM transaction_entries e JOIN transactions t ON t.id=e.transaction_id WHERE e.ledger_node_id=a.ledger_node_id AND t.status='POSTED'),substr(a.created_at,1,10)),a.availability_policy,a.created_at FROM accounts a;
CREATE INDEX availability_date ON account_availability_events(profile_id,effective_date,created_at);
CREATE TABLE app_preferences (
 profile_id TEXT PRIMARY KEY REFERENCES profiles(id), theme TEXT NOT NULL CHECK(theme IN ('light','dark','system')),
 hide_amounts INTEGER NOT NULL CHECK(hide_amounts IN (0,1))
);
`;
