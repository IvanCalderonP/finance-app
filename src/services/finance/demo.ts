import { assert } from '../../financial-engine/model.ts';
import type { FinanceApplication, FinanceSnapshot } from './application.ts';
import type { CreditCardApplication } from './card-application.ts';
import type { DebtApplication } from './debt-application.ts';

interface DemoApplications {
  finance: FinanceApplication;
  creditCards: CreditCardApplication;
  debts: DebtApplication;
}

const demoAccounts = ['Banco · ejemplo', 'Ahorro · ejemplo', 'Secundaria · ejemplo'];
const emptyProfileMessage = 'Los datos de demostración solo se pueden cargar en un perfil vacío o en el ejemplo existente. Tus datos se conservaron.';

/** Opt-in synthetic scenario. Every write uses the existing financial services. */
export async function loadDemoData({ finance, creditCards, debts }: DemoApplications): Promise<FinanceSnapshot> {
  const profile = await finance.initialProfile();
  const before = await finance.snapshot(profile.id);
  const people = await debts.people(profile.id);
  if (before.accounts.length === 0) {
    assert(before.cards.length === 0 && before.debts.length === 0 && before.transactions.length === 0 && people.length === 0, emptyProfileMessage);
  } else {
    assert(before.accounts.length === demoAccounts.length && before.accounts.every(row => demoAccounts.includes(row.account.name)), emptyProfileMessage);
  }
  // This service also checks the original account creation keys before any write.
  const seeded = await finance.seedDevelopment(profile.id);
  const bank = seeded.accounts.find(row => row.account.name === demoAccounts[0])?.account;
  const opening = seeded.transactions.find(row => row.idempotencyKey === 'dev-bank:opening');
  const category = seeded.categories.find(row => row.kind === 'EXPENSE' && row.name === 'Comida');
  assert(bank !== undefined && opening !== undefined && category !== undefined, 'No se pudo preparar el ejemplo local');
  // Keep fingerprints stable even when an interrupted load is retried on another day.
  const effectiveDate = opening.effectiveDate;
  const base = { profileId: profile.id, effectiveDate };
  const card = await creditCards.create({ ...base, idempotencyKey: 'demo-v1-card',
    name: 'Tarjeta · ejemplo', currency: 'USD', limitMinor: 50000, initialDebtMinor: 10000,
    closingDay: 15, dueDay: 12, defaultAccountId: bank.id, description: 'Deuda inicial · ejemplo sintético' });
  await creditCards.purchase({ ...base, idempotencyKey: 'demo-v1-card-purchase', cardId: card.id,
    amountMinor: 2000, categoryId: category.id, description: 'Comida · ejemplo sintético' });
  await creditCards.pay({ ...base, idempotencyKey: 'demo-v1-card-payment', cardId: card.id,
    accountId: bank.id, amountMinor: 2000, full: false, description: 'Pago parcial · ejemplo sintético' });
  const carlos = await debts.createPerson({ profileId: profile.id, idempotencyKey: 'demo-v1-person-carlos',
    name: 'Carlos · ejemplo', note: 'Persona sintética para probar ME DEBEN' });
  const loan = await debts.create({ ...base, idempotencyKey: 'demo-v1-loan', personId: carlos.id,
    originKind: 'loan_given', currency: 'USD', initialMinor: 10000, concept: 'Préstamo · ejemplo',
    dueOn: null, notes: 'Solo datos sintéticos', accountId: bank.id, description: 'Préstamo a Carlos · ejemplo sintético' });
  await debts.settle({ ...base, idempotencyKey: 'demo-v1-collection', debtId: loan.id,
    accountId: bank.id, amountMinor: 3000, full: false, description: 'Cobro parcial · ejemplo sintético' });
  const juan = await debts.createPerson({ profileId: profile.id, idempotencyKey: 'demo-v1-person-juan',
    name: 'Juan · ejemplo', note: 'Persona sintética para probar YO DEBO' });
  await debts.create({ ...base, idempotencyKey: 'demo-v1-payable', personId: juan.id,
    originKind: 'existing_payable', currency: 'USD', initialMinor: 3000, concept: 'Obligación · ejemplo',
    dueOn: null, notes: 'Solo datos sintéticos', description: 'Deuda existente con Juan · ejemplo sintético' });
  return finance.snapshot(profile.id);
}
