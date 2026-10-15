import type { PlanningRepository } from './planning-contracts.ts';
import type { BillingRepository } from './billing-contracts.ts';
import type { InsightsRepository } from './insights-contracts.ts';
import type { DebtRepository } from './debt-contracts.ts';
import type { CreditCardRepository } from './card-contracts.ts';
import type { Account, Category, Entry, LedgerNode, Profile, Split, Transaction, AccountPolicyEvent, AppPreferences } from '../../financial-engine/model.ts';
export interface AccountRepository {
  policyHistory(profileId:string):Promise<AccountPolicyEvent[]>;
  recordPolicy(profileId:string,event:AccountPolicyEvent):Promise<void>;
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
export interface CategoryRepository {
 list(profileId:string):Promise<Category[]>;
 byKey(profileId:string,key:string):Promise<{category:Category;fingerprint:string}|undefined>;
 insert(category:Category,key:string,fingerprint:string):Promise<void>;
 rename(profileId:string,id:string,name:string):Promise<void>;
 recordSplitEdit(profileId:string,transactionId:string,before:Split[],after:Split[]):Promise<void>;
}
export interface PreferenceRepository {get(profileId:string):Promise<AppPreferences>;set(profileId:string,preferences:AppPreferences):Promise<void>}
export interface Repositories {
  planning:PlanningRepository;billing:BillingRepository;insights:InsightsRepository;
  cards: CreditCardRepository; debts: DebtRepository;
  accounts: AccountRepository; transactions: TransactionRepository; ledger: LedgerRepository; categories: CategoryRepository;
  preferences:PreferenceRepository;
  profiles: { initial(): Promise<Profile> };
}
export interface UnitOfWork {
  execute<T>(operation: (repositories: Repositories) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export interface Runtime { id(): string; now(): string; today?(): string }

/** Financial dates are civil dates on the device, not the UTC date of an instant. */
export function runtimeDay(runtime: Runtime): string {
  if (runtime.today) return runtime.today();
  const instant = new Date(runtime.now());
  return `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`;
}

/** Reuse services inside one already-open transaction without nesting BEGIN or queue. */
export function scopedUnitOfWork(repositories:Repositories):UnitOfWork {return {execute:work=>work(repositories),close:async()=>{}};}
