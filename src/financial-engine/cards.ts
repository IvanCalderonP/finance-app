import { assert, date, integer, total } from './model.ts';
import type { Account, Context, Entry, LedgerNode, Transaction } from './model.ts';
import { buildTransaction } from './commands.ts';

export interface CreditCard {
  id: string; profileId: string; name: string; currency: string; nodeId: string;
  limitMinor: number; closingDay: number; dueDay: number; defaultAccountId: string | null;
  status: 'active' | 'inactive'; createdAt: string;
}
export interface CardCycle { id: string; cardId: string; startsOn: string; closesOn: string; dueOn: string }
export interface CycleCharge {
  entryId: string; transactionId: string; cycleId: string; amountMinor: number;
  effectiveDate: string; type: Transaction['type']; reversalOf: string | null;
}
export interface CardPayment {
  id: string; transactionId: string; cardId: string; accountId: string; amountMinor: number; effectiveDate: string; createdAt: string;
}
export interface PaymentApplication { paymentId: string; cycleId: string; amountMinor: number }
export interface CardData { cycles: CardCycle[]; charges: CycleCharge[]; payments: CardPayment[]; applications: PaymentApplication[] }
export interface CycleSummary extends CardCycle { chargesMinor: number; paidMinor: number; pendingMinor: number }
export interface CardSummary {
  card: CreditCard; debtMinor: number; availableCreditMinor: number; nextClosingOn: string; nextDueOn: string;
  lastClosingOn: string; lastClosingBalanceMinor: number; purchasesAfterClosingMinor: number;
  paymentsMinor: number; cycles: CycleSummary[]; data: CardData;
}
function day(value: number) { assert(Number.isInteger(value) && value >= 1 && value <= 31, 'El día debe estar entre 1 y 31'); }
function civil(year: number, month: number, configuredDay: number) {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(configuredDay, last))).toISOString().slice(0, 10);
}
export function cycleForDate(effectiveDate: string, closingDay: number, dueDay: number): Omit<CardCycle, 'id' | 'cardId'> {
  date(effectiveDate); day(closingDay); day(dueDay);
  const [year, month] = effectiveDate.split('-').map(Number);
  let closesOn = civil(year, month - 1, closingDay);
  if (effectiveDate > closesOn) closesOn = civil(year, month, closingDay);
  const closing = new Date(`${closesOn}T00:00:00Z`);
  const prior = civil(closing.getUTCFullYear(), closing.getUTCMonth() - 1, closingDay);
  const start = new Date(`${prior}T00:00:00Z`); start.setUTCDate(start.getUTCDate() + 1);
  let dueOn = civil(closing.getUTCFullYear(), closing.getUTCMonth(), dueDay);
  if (dueOn <= closesOn) dueOn = civil(closing.getUTCFullYear(), closing.getUTCMonth() + 1, dueDay);
  return { startsOn: start.toISOString().slice(0, 10), closesOn, dueOn };
}
export function latestClosingOn(asOf: string, closingDay: number): string {
  date(asOf); day(closingDay);
  const [year, month] = asOf.split('-').map(Number);
  const current = civil(year, month - 1, closingDay);
  return current <= asOf ? current : civil(year, month - 2, closingDay);
}
export function calculateCreditCardDebt(card: CreditCard, entries: Entry[]): number {
  return total(entries.filter(entry => entry.nodeId === card.nodeId).map(entry => integer(integer(entry.creditMinor) - integer(entry.debitMinor))));
}
function belongs(ctx: Context, card: CreditCard) {
  assert(ctx.profileId === card.profileId, 'Tarjeta fuera del perfil');
}
export function registerCreditCardOpening(ctx: Context, card: CreditCard, amountMinor: number, equity: LedgerNode) {
  belongs(ctx, card); assert(integer(amountMinor) > 0, 'Deuda inicial inválida');
  assert(equity.profileId === card.profileId && equity.currency === card.currency && equity.kind === 'EQUITY', 'Contrapartida inválida');
  return buildTransaction(ctx, card.currency, 'OPENING', [
    { nodeId: equity.id, debitMinor: amountMinor, creditMinor: 0 }, { nodeId: card.nodeId, debitMinor: 0, creditMinor: amountMinor },
  ]);
}
export function registerCreditCardPurchase(ctx: Context, card: CreditCard, amountMinor: number, debtMinor: number, expense: LedgerNode, categoryId: string) {
  belongs(ctx, card); assert(card.status === 'active', 'La tarjeta está inactiva');
  assert(integer(amountMinor) > 0 && integer(debtMinor) >= 0, 'Importe o deuda inválidos');
  assert(integer(debtMinor + amountMinor) <= card.limitMinor, 'La compra supera el límite de crédito');
  assert(expense.profileId === card.profileId && expense.currency === card.currency && expense.kind === 'EXPENSE', 'Contrapartida inválida');
  return buildTransaction(ctx, card.currency, 'EXPENSE', [
    { nodeId: expense.id, debitMinor: amountMinor, creditMinor: 0 }, { nodeId: card.nodeId, debitMinor: 0, creditMinor: amountMinor },
  ], [{ categoryId, amountMinor }]);
}
export function payCreditCard(ctx: Context, card: CreditCard, account: Account, amountMinor: number, debtMinor: number, balanceMinor: number, allowProtected = false) {
  belongs(ctx, card); assert(account.profileId === ctx.profileId && account.active, 'Cuenta de pago inválida');
  assert(account.currency === card.currency, 'La cuenta y tarjeta deben usar la misma moneda');
  assert(integer(amountMinor) > 0 && amountMinor <= integer(debtMinor), 'El pago debe ser positivo y no superar la deuda');
  assert(integer(balanceMinor) >= amountMinor, 'Saldo insuficiente en la cuenta de pago');
  assert(account.availabilityPolicy === 'free' || allowProtected, 'Confirma el uso de fondos protegidos');
  return buildTransaction(ctx, card.currency, 'TRANSFER', [
    { nodeId: card.nodeId, debitMinor: amountMinor, creditMinor: 0 }, { nodeId: account.nodeId, debitMinor: 0, creditMinor: amountMinor },
  ]);
}
export function allocatePaymentToCycles(amountMinor: number, pending: { cycleId: string; closesOn: string; pendingMinor: number }[]): Omit<PaymentApplication, 'paymentId'>[] {
  assert(integer(amountMinor) > 0, 'Pago inválido'); let remaining = amountMinor;
  const applications: Omit<PaymentApplication, 'paymentId'>[] = [];
  for (const cycle of [...pending].sort((a, b) => a.closesOn.localeCompare(b.closesOn) || a.cycleId.localeCompare(b.cycleId))) {
    assert(integer(cycle.pendingMinor) >= 0, 'Pendiente de ciclo inválido');
    const applied = Math.min(remaining, cycle.pendingMinor);
    if (applied > 0) applications.push({ cycleId: cycle.cycleId, amountMinor: applied });
    remaining -= applied; if (remaining === 0) break;
  }
  assert(remaining === 0, 'El pago supera el pendiente de los ciclos'); return applications;
}
// Reclassification changes allocations only, never cash or ledger entries.
export function rebuildPaymentApplications(data: CardData): PaymentApplication[] {
  const pending = data.cycles.map(cycle => ({ cycleId: cycle.id, closesOn: cycle.closesOn,
    pendingMinor: total(data.charges.filter(charge => charge.cycleId === cycle.id).map(charge => charge.amountMinor)) }));
  assert(pending.every(row => row.pendingMinor >= 0), 'Un ciclo no puede tener saldo acreedor en V1');
  const applications: PaymentApplication[] = [];
  for (const payment of [...data.payments].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    const applied = allocatePaymentToCycles(payment.amountMinor, pending);
    for (const value of applied) {
      applications.push({ ...value, paymentId: payment.id });
      const cycle = pending.find(row => row.cycleId === value.cycleId); assert(cycle !== undefined, 'Ciclo inexistente'); cycle.pendingMinor -= value.amountMinor;
    }
  }
  return applications;
}
export function summarizeCreditCard(card: CreditCard, entries: Entry[], data: CardData, transactions: Transaction[], asOf: string): CardSummary {
  const debtMinor = calculateCreditCardDebt(card, entries); assert(debtMinor >= 0, 'Saldo acreedor de tarjeta no soportado en V1');
  const cycles = data.cycles.map(cycle => {
    const chargesMinor = total(data.charges.filter(row => row.cycleId === cycle.id).map(row => row.amountMinor));
    const paidMinor = total(data.applications.filter(row => row.cycleId === cycle.id).map(row => row.amountMinor));
    const pendingMinor = integer(chargesMinor - paidMinor); assert(pendingMinor >= 0, 'Aplicación de pagos inconsistente');
    return { ...cycle, chargesMinor, paidMinor, pendingMinor };
  }).sort((a, b) => a.closesOn.localeCompare(b.closesOn));
  assert(total(cycles.map(row => row.pendingMinor)) === debtMinor, 'Los ciclos no concilian con el ledger');
  const upcoming = cycleForDate(asOf, card.closingDay, card.dueDay);
  const lastClosingOn = latestClosingOn(asOf, card.closingDay);
  // Debt at a date is a historical ledger projection, not total current cycle debt.
  const cutEntries = transactions.filter(row => row.effectiveDate <= lastClosingOn).flatMap(row => row.entries);
  const reversed = new Set(transactions.filter(row => row.type === 'REVERSAL').map(row => row.reversalOf));
  return { card, debtMinor, availableCreditMinor: integer(card.limitMinor - debtMinor), nextClosingOn: upcoming.closesOn,
    nextDueOn: cycles.find(row => row.pendingMinor > 0)?.dueOn ?? upcoming.dueOn,
    lastClosingOn, lastClosingBalanceMinor: calculateCreditCardDebt(card, cutEntries),
    purchasesAfterClosingMinor: total(data.charges.filter(row => row.type === 'EXPENSE' && row.effectiveDate > lastClosingOn && !reversed.has(row.transactionId)).map(row => row.amountMinor)),
    paymentsMinor: total(data.payments.map(row => row.amountMinor)), cycles, data };
}
