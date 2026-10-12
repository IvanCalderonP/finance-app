// Technical sandbox only. No financial tables or real user data.
export const DATABASE_NAME = 'finance-storage-lab-v1.db';
export const SCHEMA_VERSION = 1;
export const MIGRATION_1 = `
CREATE TABLE lab_parents (
  id TEXT PRIMARY KEY CHECK (id = 'lab-demo'),
  tag TEXT NOT NULL CHECK (tag = 'SYNTHETIC')
);
CREATE TABLE lab_samples (
  id TEXT PRIMARY KEY CHECK (id IN ('lab-seed', 'lab-persist', 'lab-probe')),
  parent_id TEXT NOT NULL REFERENCES lab_parents(id) ON DELETE RESTRICT,
  value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 1000000),
  tag TEXT NOT NULL CHECK (tag = 'SYNTHETIC')
);
PRAGMA user_version = 1;
`;
