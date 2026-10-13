export const MIGRATION_003 = `
CREATE TABLE people (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL REFERENCES profiles(id),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100), note TEXT NOT NULL CHECK(length(note)<=500),
 created_at TEXT NOT NULL, creation_key TEXT NOT NULL, creation_request TEXT NOT NULL,
 UNIQUE(profile_id,id), UNIQUE(profile_id,creation_key)
);
CREATE TABLE debts (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL REFERENCES profiles(id),
 person_id TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('receivable','payable')),
 currency TEXT NOT NULL CHECK(length(currency)=3), initial_minor INTEGER NOT NULL CHECK(typeof(initial_minor)='integer' AND initial_minor BETWEEN 1 AND 9007199254740991),
 concept TEXT NOT NULL CHECK(length(trim(concept)) BETWEEN 1 AND 200), opened_on TEXT NOT NULL,
 due_on TEXT, notes TEXT NOT NULL CHECK(length(notes)<=1000), ledger_node_id TEXT NOT NULL UNIQUE,
 origin_kind TEXT NOT NULL CHECK(origin_kind IN ('loan_given','existing_payable','loan_received','financed_expense')),
 origin_transaction_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, creation_key TEXT NOT NULL, creation_request TEXT NOT NULL,
 FOREIGN KEY(profile_id,person_id) REFERENCES people(profile_id,id),
 FOREIGN KEY(profile_id,ledger_node_id,currency) REFERENCES ledger_nodes(profile_id,id,currency),
 FOREIGN KEY(profile_id,origin_transaction_id,currency) REFERENCES transactions(profile_id,id,currency),
 UNIQUE(profile_id,id), UNIQUE(profile_id,creation_key)
);
CREATE TABLE debt_payments (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL, debt_id TEXT NOT NULL,
 currency TEXT NOT NULL, transaction_id TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('received','paid')),
 FOREIGN KEY(profile_id,debt_id) REFERENCES debts(profile_id,id),
 FOREIGN KEY(profile_id,transaction_id,currency) REFERENCES transactions(profile_id,id,currency),
 FOREIGN KEY(profile_id,account_id,currency) REFERENCES accounts(profile_id,id,currency)
);
CREATE TABLE debt_events (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL, debt_id TEXT NOT NULL,
 transaction_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('ORIGIN','PAYMENT','REVERSAL')),
 FOREIGN KEY(profile_id,debt_id) REFERENCES debts(profile_id,id),
 FOREIGN KEY(profile_id,transaction_id) REFERENCES transactions(profile_id,id)
);
CREATE INDEX people_profile ON people(profile_id,name);
CREATE INDEX debts_person ON debts(profile_id,person_id);
CREATE INDEX debt_events_debt ON debt_events(profile_id,debt_id);
CREATE TRIGGER debt_node_kind BEFORE INSERT ON debts BEGIN
 SELECT CASE WHEN (SELECT kind FROM ledger_nodes WHERE id=NEW.ledger_node_id)!=(CASE NEW.direction WHEN 'receivable' THEN 'ASSET' ELSE 'LIABILITY' END)
 THEN RAISE(ABORT,'Debt node kind mismatch') END;
END;
CREATE TRIGGER debt_event_node BEFORE INSERT ON debt_events BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM transaction_entries e JOIN debts d ON d.id=NEW.debt_id WHERE e.transaction_id=NEW.transaction_id AND e.ledger_node_id=d.ledger_node_id)
 THEN RAISE(ABORT,'Debt event missing ledger entry') END;
END;
`;
