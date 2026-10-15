export const MIGRATION_005 = `
CREATE TABLE bill_series (
 id TEXT PRIMARY KEY CHECK(length(id)=36),profile_id TEXT NOT NULL REFERENCES profiles(id),name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),currency TEXT NOT NULL,
 expected_minor INTEGER NOT NULL CHECK(typeof(expected_minor)='integer' AND expected_minor BETWEEN 1 AND 9007199254740991),
 anchor_date TEXT NOT NULL,frequency TEXT NOT NULL CHECK(frequency IN ('once','weekly','monthly','custom')),interval_days INTEGER CHECK(interval_days BETWEEN 1 AND 3660),
 category_id TEXT NOT NULL,preferred_method TEXT NOT NULL CHECK(preferred_method IN ('bank','card')),account_id TEXT,card_id TEXT,
 active INTEGER NOT NULL CHECK(active IN (0,1)),creation_key TEXT NOT NULL,creation_request TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(profile_id,category_id) REFERENCES categories(profile_id,id),FOREIGN KEY(profile_id,account_id,currency) REFERENCES accounts(profile_id,id,currency),
 FOREIGN KEY(profile_id,card_id,currency) REFERENCES credit_cards(profile_id,id,currency),UNIQUE(profile_id,id,currency),UNIQUE(profile_id,creation_key)
);
CREATE TABLE bill_occurrences (
 id TEXT PRIMARY KEY CHECK(length(id)=36),profile_id TEXT NOT NULL,series_id TEXT NOT NULL,period_index INTEGER NOT NULL CHECK(period_index>=0),name TEXT NOT NULL,currency TEXT NOT NULL,
 expected_minor INTEGER NOT NULL CHECK(typeof(expected_minor)='integer' AND expected_minor BETWEEN 1 AND 9007199254740991),actual_minor INTEGER CHECK(actual_minor IS NULL OR (typeof(actual_minor)='integer' AND actual_minor BETWEEN 0 AND 9007199254740991)),
 due_on TEXT NOT NULL,category_id TEXT NOT NULL,preferred_method TEXT NOT NULL CHECK(preferred_method IN ('bank','card')),account_id TEXT,card_id TEXT,reservation_bucket_id TEXT,created_at TEXT NOT NULL,
 FOREIGN KEY(profile_id,series_id,currency) REFERENCES bill_series(profile_id,id,currency),FOREIGN KEY(profile_id,category_id) REFERENCES categories(profile_id,id),
 FOREIGN KEY(profile_id,account_id,currency) REFERENCES accounts(profile_id,id,currency),FOREIGN KEY(profile_id,card_id,currency) REFERENCES credit_cards(profile_id,id,currency),
 FOREIGN KEY(reservation_bucket_id) REFERENCES funding_buckets(id),UNIQUE(profile_id,series_id,period_index),UNIQUE(profile_id,id)
);
CREATE TABLE bill_payments (
 id TEXT PRIMARY KEY CHECK(length(id)=36),profile_id TEXT NOT NULL,bill_id TEXT NOT NULL,transaction_id TEXT NOT NULL,method TEXT NOT NULL CHECK(method IN ('bank','card')),
 source_id TEXT NOT NULL,operation_key TEXT NOT NULL,request_fingerprint TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(profile_id,bill_id) REFERENCES bill_occurrences(profile_id,id),FOREIGN KEY(profile_id,transaction_id) REFERENCES transactions(profile_id,id),
 UNIQUE(profile_id,operation_key),UNIQUE(profile_id,transaction_id)
);
CREATE TABLE distribution_templates (
 id TEXT PRIMARY KEY CHECK(length(id)=36),profile_id TEXT NOT NULL REFERENCES profiles(id),name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),currency TEXT NOT NULL,rules_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(profile_id,id)
);
CREATE TABLE income_distributions (
 id TEXT PRIMARY KEY CHECK(length(id)=36),profile_id TEXT NOT NULL,income_transaction_id TEXT NOT NULL,template_id TEXT NOT NULL,account_id TEXT NOT NULL,plan_json TEXT NOT NULL,
 operation_key TEXT NOT NULL,request_fingerprint TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(profile_id,income_transaction_id) REFERENCES transactions(profile_id,id),FOREIGN KEY(profile_id,template_id) REFERENCES distribution_templates(profile_id,id),
 FOREIGN KEY(account_id) REFERENCES accounts(id),UNIQUE(profile_id,income_transaction_id),UNIQUE(profile_id,operation_key)
);
CREATE INDEX bill_occurrences_date ON bill_occurrences(profile_id,due_on);
CREATE INDEX bill_payments_bill ON bill_payments(profile_id,bill_id);
`;
