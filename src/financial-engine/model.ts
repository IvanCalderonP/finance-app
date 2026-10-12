export type AccountType = 'bank' | 'savings' | 'custom' | 'cash';
export type AvailabilityPolicy = 'free' | 'protected';
export type NodeKind = 'ASSET' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export type TransactionType = 'OPENING' | 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'ADJUSTMENT' | 'REVERSAL';
export interface Profile { id: string; name: string; currency: string; createdAt: string }
export interface Account {
  id: string; profileId: string; name: string; type: AccountType; currency: string;
  availabilityPolicy: AvailabilityPolicy; active: boolean; nodeId: string; createdAt: string;
}
export interface LedgerNode { id: string; profileId: string; currency: string; kind: NodeKind }
export interface Category { id: string; profileId: string; name: string; kind: 'INCOME' | 'EXPENSE'; code: string }
export interface Entry { nodeId: string; debitMinor: number; creditMinor: number }
export interface Split { categoryId: string; amountMinor: number }
export interface Transaction {
  id: string; profileId: string; currency: string; type: TransactionType;
  subtype: 'regular' | 'daily'; idempotencyKey: string; effectiveDate: string;
  createdAt: string; description: string; reversalOf: string | null;
  entries: Entry[]; splits: Split[];
}
export interface Context {
  id: string; profileId: string; idempotencyKey: string; effectiveDate: string;
  createdAt: string; description?: string;
}
export interface AccountBalance { account: Account; balanceMinor: number }
// Later projections provide only the portion not already excluded by protected accounts.
// No commitment records are created in this phase.
export interface Commitment {
  id: string; currency: string; amountMinor: number; alreadyExcludedMinor: number;
}
export class FinancialError extends Error {}
export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new FinancialError(message);
}
export function integer(value: number): number {
  assert(Number.isSafeInteger(value), 'El importe excede la precisión admitida');
  return value;
}
export function total(values: number[]): number {
  return values.reduce((sum, value) => integer(sum + integer(value)), 0);
}
export function currency(value: string) {
  assert(/^[A-Z]{3}$/.test(value), 'Moneda inválida');
}
export function date(value: string) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value), 'Fecha inválida');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  assert(!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, 'Fecha inválida');
}
