import { assert, currency, date, integer, total } from './model.ts';
import type { Account, Context, Entry, LedgerNode, Split, Transaction } from './model.ts';

function accountMatches(context: Context, account: Account) {
  assert(context.profileId === account.profileId, 'Cuenta fuera del perfil');
  assert(account.active, 'La cuenta está inactiva'); currency(account.currency);
}
function counterpart(context: Context, account: Account, node: LedgerNode, kind: LedgerNode['kind']) {
  accountMatches(context, account);
  assert(node.profileId === context.profileId && node.currency === account.currency && node.kind === kind, 'Contrapartida inválida');
}
export function buildTransaction(context: Context, currencyCode: string, type: Transaction['type'], entries: Entry[], splits: Split[] = [], subtype: Transaction['subtype'] = 'regular', reversalOf: string | null = null): Transaction {
  assert(context.id.length > 0 && context.profileId.length > 0, 'Identificador inválido');
  assert(context.idempotencyKey.trim().length > 0 && context.idempotencyKey.length <= 200, 'Clave de operación inválida');
  assert(!Number.isNaN(Date.parse(context.createdAt)), 'Timestamp inválido'); date(context.effectiveDate); currency(currencyCode);
  assert((context.description ?? '').length <= 500, 'Descripción demasiado larga');
  assert(entries.length >= 2, 'La operación necesita asientos');
  for (const entry of entries) {
    integer(entry.debitMinor); integer(entry.creditMinor);
    assert(entry.debitMinor >= 0 && entry.creditMinor >= 0 && (entry.debitMinor > 0) !== (entry.creditMinor > 0), 'Asiento inválido');
  }
  assert(total(entries.map(row => row.debitMinor)) === total(entries.map(row => row.creditMinor)), 'Asientos desequilibrados');
  for (const split of splits) assert(integer(split.amountMinor) !== 0 && split.categoryId.length > 0, 'Desglose inválido');
  return { ...context, description: context.description?.trim() ?? '', currency: currencyCode, type, subtype, reversalOf, entries, splits };
}
function amount(value: number) { assert(integer(value) > 0, 'El monto debe ser mayor que cero'); }
export function registerOpeningBalance(context: Context, account: Account, value: number, equity: LedgerNode) {
  counterpart(context, account, equity, 'EQUITY'); assert(integer(value) !== 0, 'Saldo inicial cero no requiere movimiento');
  return buildTransaction(context, account.currency, 'OPENING', value > 0 ? [
    { nodeId: account.nodeId, debitMinor: value, creditMinor: 0 }, { nodeId: equity.id, debitMinor: 0, creditMinor: value },
  ] : [
    { nodeId: equity.id, debitMinor: -value, creditMinor: 0 }, { nodeId: account.nodeId, debitMinor: 0, creditMinor: -value },
  ]);
}
export function registerIncome(context: Context, account: Account, value: number, income: LedgerNode, categoryId: string) {
  counterpart(context, account, income, 'INCOME'); amount(value);
  return buildTransaction(context, account.currency, 'INCOME', [
    { nodeId: account.nodeId, debitMinor: value, creditMinor: 0 }, { nodeId: income.id, debitMinor: 0, creditMinor: value },
  ], [{ categoryId, amountMinor: value }]);
}
export function registerExpense(context: Context, account: Account, value: number, expense: LedgerNode, categoryId: string, balanceMinor: number, allowProtected = false) {
  counterpart(context, account, expense, 'EXPENSE'); amount(value);
  assert(integer(balanceMinor) >= value, 'Saldo insuficiente en la cuenta');
  assert(account.availabilityPolicy === 'free' || allowProtected, 'Confirma el uso de fondos protegidos');
  return buildTransaction(context, account.currency, 'EXPENSE', [
    { nodeId: expense.id, debitMinor: value, creditMinor: 0 }, { nodeId: account.nodeId, debitMinor: 0, creditMinor: value },
  ], [{ categoryId, amountMinor: value }]);
}
export function registerDailyExpenseWithdrawal(context: Context, account: Account, value: number, expense: LedgerNode, categoryId: string, balanceMinor: number, allowProtected = false) {
  const result = registerExpense(context, account, value, expense, categoryId, balanceMinor, allowProtected);
  return { ...result, subtype: 'daily' as const };
}
export function transferBetweenAccounts(context: Context, from: Account, to: Account, value: number, balanceMinor: number, allowProtected = false) {
  accountMatches(context, from); accountMatches(context, to); amount(value);
  assert(from.id !== to.id && from.nodeId !== to.nodeId, 'Selecciona dos cuentas diferentes');
  assert(from.currency === to.currency, 'V1 no permite transferencias entre monedas');
  assert(integer(balanceMinor) >= value, 'Saldo insuficiente en la cuenta');
  assert(from.availabilityPolicy === 'free' || allowProtected, 'Confirma el uso de fondos protegidos');
  return buildTransaction(context, from.currency, 'TRANSFER', [
    { nodeId: to.nodeId, debitMinor: value, creditMinor: 0 }, { nodeId: from.nodeId, debitMinor: 0, creditMinor: value },
  ]);
}
export function registerAdjustment(context: Context, account: Account, value: number, equity: LedgerNode) {
  assert((context.description ?? '').trim().length > 0, 'El ajuste necesita un motivo');
  const opening = registerOpeningBalance(context, account, value, equity);
  return { ...opening, type: 'ADJUSTMENT' as const };
}
export function reverseTransaction(context: Context, original: Transaction) {
  assert(context.profileId === original.profileId, 'Movimiento fuera del perfil');
  assert(original.type !== 'REVERSAL', 'No se permite revertir un reverso');
  assert((context.description ?? '').trim().length > 0, 'El reverso necesita un motivo');
  return buildTransaction(context, original.currency, 'REVERSAL', original.entries.map(row => ({
    nodeId: row.nodeId, debitMinor: row.creditMinor, creditMinor: row.debitMinor,
  })), original.splits.map(row => ({ categoryId: row.categoryId, amountMinor: -row.amountMinor })), original.subtype, original.id);
}
export function replaceExpenseSplits(original: Transaction, splits: Split[]): Split[] {
  assert(original.type === 'EXPENSE', 'Solo se desglosan gastos originales');
  const ids = new Set<string>();
  for (const split of splits) {
    amount(split.amountMinor); assert(!ids.has(split.categoryId), 'Categoría duplicada'); ids.add(split.categoryId);
  }
  assert(total(splits.map(row => row.amountMinor)) === total(original.splits.map(row => row.amountMinor)), 'El desglose debe conservar el gasto total');
  return splits.map(row => ({ ...row }));
}
