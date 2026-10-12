import { assert, integer, total } from './model.ts';
import type { Account, AccountBalance, Commitment, Entry } from './model.ts';

export function calculateAccountBalance(account: Account, entries: Entry[]): number {
  return total(entries.filter(entry => entry.nodeId === account.nodeId).map(entry => integer(integer(entry.debitMinor) - integer(entry.creditMinor))));
}
export function calculatePhysicalBalance(balances: AccountBalance[], currency: string): number {
  return total(balances.filter(row => row.account.currency === currency).map(row => row.balanceMinor));
}
export function calculateAvailableBalance(balances: AccountBalance[], currency: string, commitments: Commitment[] = []): number {
  const protectedAmount = total(balances.filter(row => row.account.currency === currency && row.account.availabilityPolicy === 'protected')
    .map(row => Math.max(0, integer(row.balanceMinor))));
  const ids = new Set<string>();
  const remaining = commitments.filter(row => row.currency === currency).map(row => {
    assert(!ids.has(row.id), 'Compromiso duplicado'); ids.add(row.id);
    integer(row.amountMinor); integer(row.alreadyExcludedMinor);
    assert(row.amountMinor >= 0 && row.alreadyExcludedMinor >= 0 && row.alreadyExcludedMinor <= row.amountMinor, 'Compromiso inválido');
    return row.amountMinor - row.alreadyExcludedMinor;
  });
  return integer(calculatePhysicalBalance(balances, currency) - protectedAmount - total(remaining));
}
export function calculateNetWorth(balances: AccountBalance[], currency: string,
  assets: { currency: string; amountMinor: number }[] = [], liabilities: { currency: string; amountMinor: number }[] = []): number {
  return integer(calculatePhysicalBalance(balances, currency) + total(assets.filter(row => row.currency === currency).map(row => row.amountMinor))
    - total(liabilities.filter(row => row.currency === currency).map(row => row.amountMinor)));
}
