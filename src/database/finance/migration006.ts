export const MIGRATION_006 = `
CREATE TABLE financial_events (
 id TEXT PRIMARY KEY CHECK(length(id)=36), profile_id TEXT NOT NULL REFERENCES profiles(id),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 100), event_date TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('income','event')), currency TEXT NOT NULL CHECK(length(currency)=3),
 amount_minor INTEGER CHECK(amount_minor IS NULL OR (typeof(amount_minor)='integer' AND amount_minor BETWEEN 1 AND 9007199254740991)),
 description TEXT NOT NULL CHECK(length(description)<=500), completed INTEGER NOT NULL CHECK(completed IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, income_transaction_id TEXT, UNIQUE(profile_id,id),
 FOREIGN KEY(profile_id,income_transaction_id) REFERENCES transactions(profile_id,id)
);
CREATE TABLE financial_reminders (
 profile_id TEXT NOT NULL REFERENCES profiles(id), event_key TEXT NOT NULL CHECK(length(event_key) BETWEEN 1 AND 200),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), offsets_json TEXT NOT NULL,
 PRIMARY KEY(profile_id,event_key)
);
CREATE TABLE insights_settings (
 profile_id TEXT NOT NULL REFERENCES profiles(id), currency TEXT NOT NULL CHECK(length(currency)=3),
 small_threshold_minor INTEGER NOT NULL CHECK(typeof(small_threshold_minor)='integer' AND small_threshold_minor BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(profile_id,currency)
);
CREATE TABLE local_notification_mappings (
 profile_id TEXT NOT NULL REFERENCES profiles(id), event_key TEXT NOT NULL,
 offset_days INTEGER NOT NULL CHECK(offset_days BETWEEN 0 AND 30), notification_id TEXT NOT NULL,
 scheduled_date TEXT NOT NULL, signature TEXT NOT NULL,
 PRIMARY KEY(profile_id,event_key,offset_days), UNIQUE(notification_id)
);
CREATE INDEX financial_events_date ON financial_events(profile_id,event_date);
`;
