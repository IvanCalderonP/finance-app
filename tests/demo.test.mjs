import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteUnitOfWork } from '../src/database/finance/repositories.ts';
import { createFinanceApplication } from '../src/services/finance/application.ts';
import { createCreditCardApplication } from '../src/services/finance/card-application.ts';
import { createDebtApplication } from '../src/services/finance/debt-application.ts';
import { loadDemoData } from '../src/services/finance/demo.ts';

async function fixture(work) {
  const directory = mkdtempSync(join(tmpdir(), 'finance-demo-tests-'));
  let now = '2026-10-13T12:00:00.000Z';
  const runtime = { id: randomUUID, now: () => now };
  const unit = createSqliteUnitOfWork(async () => {
    const raw = new DatabaseSync(join(directory, 'finance.db'));
    return { exec: async sql => raw.exec(sql), run: async (sql, values = []) => { raw.prepare(sql).run(...values); },
      all: async (sql, values = []) => raw.prepare(sql).all(...values), close: async () => raw.close() };
  }, runtime);
  const finance = createFinanceApplication(unit, runtime);
  const creditCards = createCreditCardApplication(unit, runtime);
  const debts = createDebtApplication(unit, runtime);
  try { await work({ finance, creditCards, debts, unit, nextDay: () => { now = '2026-10-14T12:00:00.000Z'; } }); }
  finally { await unit.close(); rmSync(directory, { recursive: true, force: true }); }
}

test('opt-in demo uses all current modules and reconciles available money', () => fixture(async apps => {
  const data = await loadDemoData(apps);
  assert.equal(data.accounts.length, 3);
  assert.equal(data.cards.length, 1);
  assert.equal(data.debts.length, 2);
  assert.deepEqual(data.totals[0], { currency: 'USD', payableMinor: 3000, receivableMinor: 7000,
    netWorthLiquidMinor: 128000, cardDebtMinor: 10000, physicalMinor: 141000, availableMinor: 108000,
    netWorthMinor: 135000, incomeMinor: 0, expenseMinor: 2000 });
  assert.equal(data.cards[0].debtMinor, 10000);
  assert.equal(data.cards[0].availableCreditMinor, 40000);
  assert.equal(data.debts.find(row => row.debt.direction === 'receivable').pendingMinor, 7000);
  for (const transaction of data.transactions) {
    assert.equal(transaction.entries.reduce((sum, row) => sum + row.debitMinor - row.creditMinor, 0), 0);
  }
}));

test('loading demo twice on different days creates no duplicate financial records', () => fixture(async apps => {
  const before = await loadDemoData(apps);
  apps.nextDay();
  const after = await loadDemoData(apps);
  assert.deepEqual(after.transactions, before.transactions);
  assert.deepEqual(after.accounts, before.accounts);
  assert.deepEqual(after.totals, before.totals);
  assert.deepEqual(after.cards.map(row => row.card), before.cards.map(row => row.card));
  assert.deepEqual(after.debts, before.debts);
  assert.equal((await apps.debts.people(before.accounts[0].account.profileId)).length, 2);
}));

test('demo refuses an unrelated existing account without changing it', () => fixture(async apps => {
  const profile = await apps.finance.initialProfile();
  await apps.finance.createAccount({ profileId: profile.id, idempotencyKey: randomUUID(), effectiveDate: '2026-10-13',
    name: 'Cuenta personal', type: 'bank', currency: 'USD', availabilityPolicy: 'free', initialBalanceMinor: 12345 });
  const before = await apps.finance.snapshot(profile.id);
  await assert.rejects(loadDemoData(apps), /perfil vacío/);
  assert.deepEqual(await apps.finance.snapshot(profile.id), before);
  assert.deepEqual(await apps.debts.people(profile.id), []);
}));

test('demo complements the previous development seed with its original date', () => fixture(async apps => {
  const profile = await apps.finance.initialProfile();
  const seeded = await apps.finance.seedDevelopment(profile.id);
  apps.nextDay();
  const demo = await loadDemoData(apps);
  assert.deepEqual(demo.accounts.map(row => row.account.id), seeded.accounts.map(row => row.account.id));
  assert.ok(demo.transactions.every(row => row.effectiveDate === '2026-10-13'));
  assert.equal(demo.totals[0].availableMinor, 108000);
}));

test('an interrupted demo load can safely resume without duplicate purchases', () => fixture(async apps => {
  const interrupted = { ...apps, creditCards: { ...apps.creditCards, pay: async () => { throw new Error('Injected interruption'); } } };
  await assert.rejects(loadDemoData(interrupted), /Injected interruption/);
  apps.nextDay();
  const resumed = await loadDemoData(apps);
  assert.equal(resumed.cards.length, 1);
  assert.equal(resumed.debts.length, 2);
  assert.equal(resumed.transactions.filter(row => row.idempotencyKey === 'demo-v1-card-purchase').length, 1);
  assert.equal(resumed.totals[0].availableMinor, 108000);
}));
