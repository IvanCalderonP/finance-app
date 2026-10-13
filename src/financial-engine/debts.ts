import { assert, date, integer, total } from './model.ts';
import type { Account, Context, Entry, LedgerNode, Transaction } from './model.ts';
import { buildTransaction } from './commands.ts';
export type DebtDirection = 'receivable' | 'payable';
export type DebtOrigin = 'loan_given' | 'existing_payable' | 'loan_received' | 'financed_expense';
export interface Person { id: string; profileId: string; name: string; note: string; createdAt: string }
export interface Debt {
 id: string; profileId: string; personId: string; direction: DebtDirection; currency: string; initialMinor: number;
 concept: string; openedOn: string; dueOn: string | null; notes: string; nodeId: string;
 originKind: DebtOrigin; originTransactionId: string; createdAt: string;
}
export interface DebtEvent { id: string; debtId: string; transactionId: string; kind: 'ORIGIN' | 'PAYMENT' | 'REVERSAL'; effectiveDate: string; createdAt: string; description: string; amountMinor: number; reversalOf: string | null }
export interface DebtSummary { debt: Debt; person: Person; pendingMinor: number; settledMinor: number; status: 'pendiente' | 'pagada' | 'vencida' | 'anulada'; history: DebtEvent[] }
function matches(ctx: Context, debt: Debt) { assert(ctx.profileId === debt.profileId, 'Deuda fuera del perfil'); }
function account(ctx: Context, debt: Debt, value: Account, available: number | null, protectedConfirmed = false) {
 matches(ctx, debt); assert(value.profileId === debt.profileId && value.currency === debt.currency && value.active, 'Cuenta incompatible o inactiva');
 if (available !== null) { assert(integer(available) >= 0, 'Saldo inválido'); assert(value.availabilityPolicy === 'free' || protectedConfirmed, 'Confirma el uso de fondos protegidos'); }
}
function positive(value: number) { assert(integer(value) > 0, 'El principal debe ser mayor que cero'); }
export function calculateDebtPending(debt: Debt, entries: Entry[]) {
 const sign = debt.direction === 'receivable' ? 1 : -1;
 return total(entries.filter(row => row.nodeId === debt.nodeId).map(row => integer(sign * integer(row.debitMinor - row.creditMinor))));
}
export function registerLoanGiven(ctx: Context, debt: Debt, source: Account, sourceBalance: number, allowProtected = false): Transaction {
 assert(debt.direction === 'receivable' && debt.originKind === 'loan_given', 'Origen de deuda incompatible');
 positive(debt.initialMinor); account(ctx, debt, source, sourceBalance, allowProtected); assert(sourceBalance >= debt.initialMinor, 'Saldo insuficiente');
 return buildTransaction(ctx, debt.currency, 'TRANSFER', [
  {nodeId:debt.nodeId,debitMinor:debt.initialMinor,creditMinor:0}, {nodeId:source.nodeId,debitMinor:0,creditMinor:debt.initialMinor},
 ]);
}
export function registerExistingPayable(ctx: Context, debt: Debt, equity: LedgerNode): Transaction {
 matches(ctx,debt); assert(debt.direction==='payable' && debt.originKind==='existing_payable','Origen de deuda incompatible'); positive(debt.initialMinor);
 assert(equity.profileId===debt.profileId && equity.currency===debt.currency && equity.kind==='EQUITY','Contrapartida inválida');
 return buildTransaction(ctx,debt.currency,'OPENING',[
  {nodeId:equity.id,debitMinor:debt.initialMinor,creditMinor:0},{nodeId:debt.nodeId,debitMinor:0,creditMinor:debt.initialMinor},
 ]);
}
export function registerLoanReceived(ctx: Context, debt: Debt, destination: Account): Transaction {
 assert(debt.direction==='payable' && debt.originKind==='loan_received','Origen de deuda incompatible');positive(debt.initialMinor);account(ctx,debt,destination,null);
 return buildTransaction(ctx,debt.currency,'TRANSFER',[
  {nodeId:destination.nodeId,debitMinor:debt.initialMinor,creditMinor:0},{nodeId:debt.nodeId,debitMinor:0,creditMinor:debt.initialMinor},
 ]);
}
export function registerFinancedDebtExpense(ctx: Context, debt: Debt, expense: LedgerNode, categoryId: string): Transaction {
 matches(ctx,debt);assert(debt.direction==='payable' && debt.originKind==='financed_expense','Origen de deuda incompatible');positive(debt.initialMinor);
 assert(expense.profileId===debt.profileId && expense.currency===debt.currency && expense.kind==='EXPENSE','Categoría monetaria incompatible');
 return buildTransaction(ctx,debt.currency,'EXPENSE',[
  {nodeId:expense.id,debitMinor:debt.initialMinor,creditMinor:0},{nodeId:debt.nodeId,debitMinor:0,creditMinor:debt.initialMinor},
 ],[{categoryId,amountMinor:debt.initialMinor}]);
}
export function settleDebt(ctx: Context, debt: Debt, value: number, pending: number, paymentAccount: Account, accountBalance: number, allowProtected = false): Transaction {
 positive(value); assert(integer(pending)>=value,'El pago supera el principal pendiente');
 account(ctx,debt,paymentAccount,debt.direction==='payable'?accountBalance:null,allowProtected);
 if(debt.direction==='payable') assert(accountBalance>=value,'Saldo insuficiente');
 return debt.direction==='receivable'
  ?buildTransaction(ctx,debt.currency,'TRANSFER',[{nodeId:paymentAccount.nodeId,debitMinor:value,creditMinor:0},{nodeId:debt.nodeId,debitMinor:0,creditMinor:value}])
  :buildTransaction(ctx,debt.currency,'TRANSFER',[{nodeId:debt.nodeId,debitMinor:value,creditMinor:0},{nodeId:paymentAccount.nodeId,debitMinor:0,creditMinor:value}]);
}
export function debtStatus(pending: number, dueOn: string | null, asOf: string): DebtSummary['status'] {
 date(asOf);if(dueOn)date(dueOn);assert(integer(pending)>=0,'Saldo de deuda inválido');
 return pending===0?'pagada':dueOn && dueOn<asOf?'vencida':'pendiente';
}
