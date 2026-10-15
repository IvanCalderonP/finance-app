export const MIGRATION_004 = `
CREATE TABLE funding_buckets (
 id TEXT PRIMARY KEY CHECK(length(id)=36),profile_id TEXT NOT NULL REFERENCES profiles(id),name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),currency TEXT NOT NULL CHECK(length(currency)=3),
 kind TEXT NOT NULL CHECK(kind IN ('category','goal','reserve','bill','card','debt')),target_id TEXT,category_id TEXT,created_on TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(profile_id,id),UNIQUE(profile_id,id,currency),FOREIGN KEY(profile_id,category_id) REFERENCES categories(profile_id,id)
);
CREATE TABLE budgets (
 id TEXT PRIMARY KEY CHECK(length(id)=36),profile_id TEXT NOT NULL REFERENCES profiles(id),name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),currency TEXT NOT NULL,category_id TEXT NOT NULL,
 limit_minor INTEGER NOT NULL CHECK(typeof(limit_minor)='integer' AND limit_minor BETWEEN 1 AND 9007199254740991),frequency TEXT NOT NULL CHECK(frequency IN ('monthly','weekly','custom')),starts_on TEXT NOT NULL,ends_on TEXT NOT NULL CHECK(ends_on>=starts_on),renew INTEGER NOT NULL CHECK(renew IN (0,1)),created_at TEXT NOT NULL,
 UNIQUE(profile_id,id),FOREIGN KEY(profile_id,category_id) REFERENCES categories(profile_id,id)
);
CREATE TABLE budget_periods (
 id TEXT PRIMARY KEY CHECK(length(id)=36),profile_id TEXT NOT NULL,budget_id TEXT NOT NULL,bucket_id TEXT NOT NULL,starts_on TEXT NOT NULL,ends_on TEXT NOT NULL CHECK(ends_on>=starts_on),closed INTEGER NOT NULL CHECK(closed IN (0,1)),
 UNIQUE(profile_id,id),UNIQUE(profile_id,budget_id,starts_on),FOREIGN KEY(profile_id,budget_id) REFERENCES budgets(profile_id,id),FOREIGN KEY(profile_id,bucket_id) REFERENCES funding_buckets(profile_id,id)
);
CREATE TABLE savings_goals (
 id TEXT PRIMARY KEY CHECK(length(id)=36),profile_id TEXT NOT NULL,bucket_id TEXT NOT NULL UNIQUE,name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),currency TEXT NOT NULL,target_minor INTEGER NOT NULL CHECK(typeof(target_minor)='integer' AND target_minor BETWEEN 1 AND 9007199254740991),target_on TEXT,is_primary INTEGER NOT NULL CHECK(is_primary IN (0,1)),created_on TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(profile_id,id),FOREIGN KEY(profile_id,bucket_id,currency) REFERENCES funding_buckets(profile_id,id,currency)
);
CREATE UNIQUE INDEX one_primary_goal ON savings_goals(profile_id) WHERE is_primary=1;
CREATE TABLE locked_reserves (
 id TEXT PRIMARY KEY CHECK(length(id)=36),profile_id TEXT NOT NULL,bucket_id TEXT NOT NULL UNIQUE,name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),currency TEXT NOT NULL,unlock_on TEXT NOT NULL,released INTEGER NOT NULL CHECK(released IN (0,1)),created_on TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(profile_id,id),FOREIGN KEY(profile_id,bucket_id,currency) REFERENCES funding_buckets(profile_id,id,currency)
);
CREATE TABLE funding_events (
 id TEXT PRIMARY KEY CHECK(length(id)=36),profile_id TEXT NOT NULL,bucket_id TEXT NOT NULL,account_id TEXT NOT NULL,currency TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor !=0 AND amount_minor BETWEEN -9007199254740991 AND 9007199254740991),kind TEXT NOT NULL CHECK(kind IN ('fund','release','move','consume','restore')),effective_date TEXT NOT NULL,created_at TEXT NOT NULL,transaction_id TEXT,note TEXT NOT NULL,
 FOREIGN KEY(profile_id,bucket_id,currency) REFERENCES funding_buckets(profile_id,id,currency),FOREIGN KEY(profile_id,account_id,currency) REFERENCES accounts(profile_id,id,currency),FOREIGN KEY(profile_id,transaction_id) REFERENCES transactions(profile_id,id)
);
CREATE INDEX funding_by_owner ON funding_buckets(profile_id,kind,target_id);
CREATE INDEX funding_by_date ON funding_events(profile_id,effective_date,bucket_id,account_id);
CREATE UNIQUE INDEX one_funding_tx ON funding_events(profile_id,transaction_id,bucket_id,account_id,kind) WHERE transaction_id IS NOT NULL AND kind IN ('consume','restore');
CREATE TRIGGER immutable_funding BEFORE UPDATE ON funding_events BEGIN SELECT RAISE(ABORT,'Immutable funding event'); END;
CREATE TRIGGER no_delete_funding BEFORE DELETE ON funding_events BEGIN SELECT RAISE(ABORT,'Immutable funding event'); END;
CREATE TABLE planning_operations (profile_id TEXT NOT NULL REFERENCES profiles(id),idempotency_key TEXT NOT NULL,request_fingerprint TEXT NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(profile_id,idempotency_key));
`;
