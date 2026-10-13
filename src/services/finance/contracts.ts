import type { DebtRepository } from './debt-contracts.ts';
import type { CreditCardRepository } from './card-contracts.ts';
import type { Account, Category, Entry, LedgerNode, Profile, Split, Transaction } from '../../financial-engine/model.ts';
export interface AccountRepository {
  list(profileId: string): Promise<Account[]>;
  find(profileId: string, id: string): Promise<Account | undefined>;
  byCreationKey(profileId: string, key: string): Promise<{ account: Account; fingerprint: string } | undefined>;
  insert(account: Account, key: string, fingerprint: string): Promise<void>;
  configure(profileId: string, id: string, active: boolean, policy: Account['availabilityPolicy']): Promise<void>;
}
export interface TransactionRepository {
  list(profileId: string): Promise<Transaction[]>;
  find(profileId: string, id: string): Promise<Transaction | undefined>;
  byKey(profileId: string, key: string): Promise<{ transaction: Transaction; fingerprint: string } | undefined>;
  reversedBy(profileId: string, originalId: string): Promise<Transaction | undefined>;
  insert(transaction: Transaction, fingerprint: string): Promise<void>;
  replaceSplits(profileId: string, transactionId: string, splits: Split[]): Promise<void>;
}
export interface LedgerRepository {
  entries(profileId: string): Promise<Entry[]>;
  systemNode(profileId: string, currency: string, kind: 'EQUITY' | 'INCOME' | 'EXPENSE'): Promise<LedgerNode>;
  insertNode(node: LedgerNode): Promise<void>;
}
export interface CategoryRepository { list(profileId: string): Promise<Category[]> }
export interface Repositories {
  cards: CreditCardRepository; debts: DebtRepository;
  accounts: AccountRepository; transactions: TransactionRepository; ledger: LedgerRepository; categories: CategoryRepository;
  profiles: { initial(): Promise<Profile> };
}
export interface UnitOfWork {
  execute<T>(operation: (repositories: Repositories) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export interface Runtime { id(): string; now(): string }
