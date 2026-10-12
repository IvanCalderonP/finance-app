// SQLite's documented table-rebuild procedure; no writable_schema shortcuts.
export const MIGRATION_002 = `
DROP TRIGGER post_balanced;
CREATE TABLE ledger_nodes_v2 (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL REFERENCES profiles(id),
 currency TEXT NOT NULL CHECK(length(currency)=3), kind TEXT NOT NULL CHECK(kind IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
 system_key TEXT, created_at TEXT NOT NULL,
 UNIQUE(profile_id,id,currency), UNIQUE(profile_id,currency,system_key)
);
INSERT INTO ledger_nodes_v2 SELECT * FROM ledger_nodes;
DROP TABLE ledger_nodes;
ALTER TABLE ledger_nodes_v2 RENAME TO ledger_nodes;
CREATE UNIQUE INDEX entry_identity_currency ON transaction_entries(profile_id,id,currency);
CREATE TABLE credit_cards (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL REFERENCES profiles(id),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100), currency TEXT NOT NULL,
 limit_minor INTEGER NOT NULL CHECK(typeof(limit_minor)='integer' AND limit_minor BETWEEN 1 AND 9007199254740991),
 closing_day INTEGER NOT NULL CHECK(closing_day BETWEEN 1 AND 31), due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 31),
 default_account_id TEXT, status TEXT NOT NULL CHECK(status IN ('active','inactive')),
 ledger_node_id TEXT NOT NULL UNIQUE, creation_key TEXT NOT NULL, creation_request TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(profile_id,ledger_node_id,currency) REFERENCES ledger_nodes(profile_id,id,currency),
 FOREIGN KEY(profile_id,default_account_id,currency) REFERENCES accounts(profile_id,id,currency),
 UNIQUE(profile_id,creation_key), UNIQUE(profile_id,id), UNIQUE(profile_id,id,currency)
);
CREATE TABLE credit_card_cycles (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL, card_id TEXT NOT NULL, currency TEXT NOT NULL,
 starts_on TEXT NOT NULL, closes_on TEXT NOT NULL, due_on TEXT NOT NULL,
 CHECK(starts_on<=closes_on AND due_on>closes_on),
 FOREIGN KEY(profile_id,card_id,currency) REFERENCES credit_cards(profile_id,id,currency),
 UNIQUE(profile_id,card_id,closes_on), UNIQUE(profile_id,id,card_id)
);
CREATE TABLE credit_card_cycle_entries (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL, card_id TEXT NOT NULL, currency TEXT NOT NULL,
 cycle_id TEXT NOT NULL, transaction_entry_id TEXT NOT NULL UNIQUE,
 FOREIGN KEY(profile_id,cycle_id,card_id) REFERENCES credit_card_cycles(profile_id,id,card_id),
 FOREIGN KEY(profile_id,transaction_entry_id,currency) REFERENCES transaction_entries(profile_id,id,currency)
);
CREATE TABLE credit_card_payments (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL, card_id TEXT NOT NULL, currency TEXT NOT NULL,
 transaction_id TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL,
 FOREIGN KEY(profile_id,card_id,currency) REFERENCES credit_cards(profile_id,id,currency),
 FOREIGN KEY(profile_id,transaction_id,currency) REFERENCES transactions(profile_id,id,currency),
 FOREIGN KEY(profile_id,account_id,currency) REFERENCES accounts(profile_id,id,currency), UNIQUE(profile_id,id,card_id)
);
CREATE TABLE credit_card_payment_applications (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL, card_id TEXT NOT NULL,
 payment_id TEXT NOT NULL, cycle_id TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor BETWEEN 1 AND 9007199254740991),
 FOREIGN KEY(profile_id,payment_id,card_id) REFERENCES credit_card_payments(profile_id,id,card_id),
 FOREIGN KEY(profile_id,cycle_id,card_id) REFERENCES credit_card_cycles(profile_id,id,card_id), UNIQUE(payment_id,cycle_id)
);
CREATE TABLE credit_card_cycle_corrections (
 id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, card_id TEXT NOT NULL, transaction_entry_id TEXT NOT NULL,
 previous_cycle_id TEXT NOT NULL, new_cycle_id TEXT NOT NULL, reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500), corrected_at TEXT NOT NULL,
 FOREIGN KEY(profile_id,previous_cycle_id,card_id) REFERENCES credit_card_cycles(profile_id,id,card_id),
 FOREIGN KEY(profile_id,new_cycle_id,card_id) REFERENCES credit_card_cycles(profile_id,id,card_id),
 FOREIGN KEY(transaction_entry_id) REFERENCES transaction_entries(id)
);
CREATE INDEX card_cycles_date ON credit_card_cycles(profile_id,card_id,closes_on);
CREATE INDEX card_entries_cycle ON credit_card_cycle_entries(profile_id,card_id,cycle_id);
CREATE INDEX card_payments_card ON credit_card_payments(profile_id,card_id);
CREATE TRIGGER card_liability_node BEFORE INSERT ON credit_cards BEGIN
 SELECT CASE WHEN (SELECT kind FROM ledger_nodes WHERE id=NEW.ledger_node_id)!='LIABILITY' THEN RAISE(ABORT,'Card requires liability') END;
END;
CREATE TRIGGER card_cycle_node BEFORE INSERT ON credit_card_cycle_entries BEGIN
 SELECT CASE WHEN (SELECT ledger_node_id FROM transaction_entries WHERE id=NEW.transaction_entry_id)!=(SELECT ledger_node_id FROM credit_cards WHERE id=NEW.card_id)
 THEN RAISE(ABORT,'Cycle entry must belong to card') END;
END;
CREATE TRIGGER card_cycle_reassign_node BEFORE UPDATE ON credit_card_cycle_entries BEGIN
 SELECT CASE WHEN OLD.transaction_entry_id!=NEW.transaction_entry_id OR OLD.card_id!=NEW.card_id OR OLD.profile_id!=NEW.profile_id THEN RAISE(ABORT,'Only cycle classification is mutable') END;
END;
`;
