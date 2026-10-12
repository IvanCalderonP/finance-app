import { cardProjections } from './card-projections.ts';
import type { CardSummary } from '../../financial-engine/cards.ts';
import { assert, currency, date, integer, total } from '../../financial-engine/model.ts';
import type { Account, AccountBalance, Category, Context, Split, Transaction } from '../../financial-engine/model.ts';
import { calculateAccountBalance, calculateAvailableBalance, calculateNetWorth, calculatePhysicalBalance } from '../../financial-engine/calculations.ts';
import { registerAdjustment, registerDailyExpenseWithdrawal, registerExpense, registerIncome, registerOpeningBalance, replaceExpenseSplits, reverseTransaction, transferBetweenAccounts } from '../../financial-engine/commands.ts';
import type { Repositories, Runtime, UnitOfWork } from './contracts.ts';
export interface CreateAccountInput {
  profileId: string; name: string; type: Account['type']; currency: string; availabilityPolicy: Account['availabilityPolicy'];
  initialBalanceMinor: number; effectiveDate: string; idempotencyKey: string;
}
interface BaseInput { profileId: string; idempotencyKey: string; effectiveDate: string; description: string }
export interface MovementInput extends BaseInput {
  kind: 'INCOME' | 'EXPENSE' | 'DAILY' | 'TRANSFER' | 'ADJUSTMENT';
  accountId: string; amountMinor: number; categoryId?: string; toAccountId?: string; allowProtected?: boolean;
}
export interface FinanceSnapshot {
  cards: CardSummary[]; accounts: AccountBalance[]; categories: Category[]; transactions: Transaction[];
  totals: { currency: string; physicalMinor: number; cardDebtMinor: number; availableMinor: number; netWorthMinor: number; incomeMinor: number; expenseMinor: number }[];
}
function key(value: string) { assert(value.trim().length > 0 && value.length <= 180, 'Clave de operación inválida'); }
async function requireAccount(repositories: Repositories, profileId: string, accountId: string) {
  const account = await repositories.accounts.find(profileId, accountId);
  assert(account !== undefined, 'Cuenta inexistente en este perfil'); return account;
}
async function categoriesValid(repositories: Repositories, profileId: string, splits: Split[], kind: Category['kind']) {
  const categories = await repositories.categories.list(profileId);
  for (const split of splits) assert(categories.some(category => category.id === split.categoryId && category.kind === kind), 'Categoría inexistente o incompatible con este perfil');
}
async function snapshot(repositories: Repositories, profileId: string, asOf: string): Promise<FinanceSnapshot> {
  const accounts = await repositories.accounts.list(profileId);
  const entries = await repositories.ledger.entries(profileId);
  const balances = accounts.map(account => ({ account, balanceMinor: calculateAccountBalance(account, entries) }));
  const transactions = await repositories.transactions.list(profileId);
  const categories = await repositories.categories.list(profileId);
  const cards = await cardProjections(repositories, profileId, entries, transactions, asOf);
  const liabilities = cards.map(row => ({ id: row.card.id, currency: row.card.currency, amountMinor: row.debtMinor, alreadyExcludedMinor: 0 }));
  return { cards, accounts: balances, categories, transactions,
    totals: [...new Set([...accounts.map(row => row.currency), ...cards.map(row => row.card.currency)])].map(currency => ({
      currency, cardDebtMinor: total(liabilities.filter(row => row.currency === currency).map(row => row.amountMinor)), physicalMinor: calculatePhysicalBalance(balances, currency), availableMinor: calculateAvailableBalance(balances, currency, liabilities),
      netWorthMinor: calculateNetWorth(balances, currency, [], liabilities),
      incomeMinor: total(transactions.filter(row => row.currency === currency).flatMap(row => row.splits.filter(split => categories.some(category => category.id === split.categoryId && category.kind === 'INCOME')).map(split => split.amountMinor))),
      expenseMinor: total(transactions.filter(row => row.currency === currency).flatMap(row => row.splits.filter(split => categories.some(category => category.id === split.categoryId && category.kind === 'EXPENSE')).map(split => split.amountMinor))),
    })),
  };
}
export function createFinanceApplication(unit: UnitOfWork, runtime: Runtime) {
  function context(input: BaseInput): Context {
    key(input.idempotencyKey); date(input.effectiveDate);
    return { id: runtime.id(), profileId: input.profileId, idempotencyKey: input.idempotencyKey, effectiveDate: input.effectiveDate,
      createdAt: runtime.now(), description: input.description.trim() };
  }
  async function createAccount(repositories: Repositories, input: CreateAccountInput): Promise<Account> {
    const normalized = { ...input, name: input.name.trim() };
    const fingerprint = JSON.stringify(normalized, Object.keys(normalized).sort());
    key(input.idempotencyKey); date(input.effectiveDate); currency(input.currency); integer(input.initialBalanceMinor);
    assert(normalized.name.length > 0 && normalized.name.length <= 100, 'Nombre de cuenta inválido');
    assert(['bank', 'savings', 'custom', 'cash'].includes(input.type), 'Tipo de cuenta inválido');
    assert(['free', 'protected'].includes(input.availabilityPolicy), 'Disponibilidad inválida');
    const previous = await repositories.accounts.byCreationKey(input.profileId, input.idempotencyKey);
    if (previous) { assert(previous.fingerprint === fingerprint, 'La clave ya corresponde a otra cuenta'); return previous.account; }
    const account: Account = { id: runtime.id(), profileId: input.profileId, name: normalized.name, type: input.type, currency: input.currency,
      availabilityPolicy: input.availabilityPolicy, active: true, nodeId: runtime.id(), createdAt: runtime.now() };
    await repositories.ledger.insertNode({ id: account.nodeId, profileId: account.profileId, currency: account.currency, kind: 'ASSET' });
    await repositories.accounts.insert(account, input.idempotencyKey, fingerprint);
    if (input.initialBalanceMinor !== 0) {
      const equity = await repositories.ledger.systemNode(input.profileId, input.currency, 'EQUITY');
      const opening = registerOpeningBalance(context({ ...input, idempotencyKey: `${input.idempotencyKey}:opening`, description: 'Saldo inicial' }), account, input.initialBalanceMinor, equity);
      await repositories.transactions.insert(opening, fingerprint);
    }
    await snapshot(repositories, input.profileId, runtime.now().slice(0, 10)); // Reject overflow before committing.
    return account;
  }
  return {
    initialProfile: () => unit.execute(repositories => repositories.profiles.initial()),
    snapshot: (profileId: string) => unit.execute(repositories => snapshot(repositories, profileId, runtime.now().slice(0, 10))),
    createAccount: (input: CreateAccountInput) => unit.execute(repositories => createAccount(repositories, input)),
    configureAccount: (profileId: string, accountId: string, active: boolean, policy: Account['availabilityPolicy']) => unit.execute(async repositories => {
      await requireAccount(repositories, profileId, accountId);
      assert(['free', 'protected'].includes(policy), 'Disponibilidad inválida');
      await repositories.accounts.configure(profileId, accountId, active, policy);
      return snapshot(repositories, profileId, runtime.now().slice(0, 10));
    }),
    post: (input: MovementInput) => unit.execute(async repositories => {
      assert(['INCOME', 'EXPENSE', 'DAILY', 'TRANSFER', 'ADJUSTMENT'].includes(input.kind), 'Operación no soportada');
      const normalized = { profileId: input.profileId, kind: input.kind, accountId: input.accountId, amountMinor: input.amountMinor,
        idempotencyKey: input.idempotencyKey, effectiveDate: input.effectiveDate, description: input.description.trim(),
        categoryId: input.kind === 'INCOME' || input.kind === 'EXPENSE' ? input.categoryId : undefined,
        toAccountId: input.kind === 'TRANSFER' ? input.toAccountId : undefined, allowProtected: input.allowProtected ?? false };
      const fingerprint = JSON.stringify(normalized, Object.keys(normalized).sort());
      key(input.idempotencyKey);
      const previous = await repositories.transactions.byKey(input.profileId, input.idempotencyKey);
      if (previous) { assert(previous.fingerprint === fingerprint, 'La clave ya corresponde a otra operación'); return previous.transaction; }
      const account = await requireAccount(repositories, input.profileId, input.accountId);
      const balance = calculateAccountBalance(account, await repositories.ledger.entries(input.profileId));
      const ctx = context(input);
      let transaction: Transaction;
      if (input.kind === 'TRANSFER') {
        assert(input.toAccountId !== undefined, 'Selecciona la cuenta destino');
        const to = await requireAccount(repositories, input.profileId, input.toAccountId);
        transaction = transferBetweenAccounts(ctx, account, to, input.amountMinor, balance, input.allowProtected);
      } else if (input.kind === 'ADJUSTMENT') {
        transaction = registerAdjustment(ctx, account, input.amountMinor, await repositories.ledger.systemNode(input.profileId, account.currency, 'EQUITY'));
      } else {
        const kind = input.kind === 'INCOME' ? 'INCOME' : 'EXPENSE';
        let categoryId = input.categoryId;
        if (input.kind === 'DAILY') categoryId = (await repositories.categories.list(input.profileId)).find(row => row.code === 'daily')?.id;
        assert(categoryId !== undefined, 'Selecciona una categoría');
        await categoriesValid(repositories, input.profileId, [{ categoryId, amountMinor: input.amountMinor }], kind);
        const node = await repositories.ledger.systemNode(input.profileId, account.currency, kind);
        if (input.kind === 'INCOME') transaction = registerIncome(ctx, account, input.amountMinor, node, categoryId);
        else if (input.kind === 'DAILY') transaction = registerDailyExpenseWithdrawal(ctx, account, input.amountMinor, node, categoryId, balance, input.allowProtected);
        else transaction = registerExpense(ctx, account, input.amountMinor, node, categoryId, balance, input.allowProtected);
      }
      await repositories.transactions.insert(transaction, fingerprint);
      await snapshot(repositories, input.profileId, runtime.now().slice(0, 10));
      return transaction;
    }),
    reverse: (input: BaseInput & { originalId: string }) => unit.execute(async repositories => {
      const normalized = { ...input, description: input.description.trim() };
      const fingerprint = JSON.stringify(normalized, Object.keys(normalized).sort());
      key(input.idempotencyKey);
      const previous = await repositories.transactions.byKey(input.profileId, input.idempotencyKey);
      if (previous) { assert(previous.fingerprint === fingerprint, 'Clave de reverso reutilizada'); return previous.transaction; }
      const original = await repositories.transactions.find(input.profileId, input.originalId);
      assert(original !== undefined, 'Movimiento inexistente en este perfil');
      assert(!(await repositories.cards.related(input.profileId, input.originalId)), 'Usa Tarjetas para revertir compras; reverso de pagos fuera de V1');
      assert(!(await repositories.transactions.reversedBy(input.profileId, input.originalId)), 'El movimiento ya fue revertido');
      const reversal = reverseTransaction(context(input), original);
      const entries = await repositories.ledger.entries(input.profileId);
      for (const account of await repositories.accounts.list(input.profileId)) {
        const before = calculateAccountBalance(account, entries);
        const delta = calculateAccountBalance(account, reversal.entries);
        const after = integer(before + delta);
        assert(after >= 0 || after >= before, 'El reverso dejaría una cuenta sin fondos suficientes');
      }
      await repositories.transactions.insert(reversal, fingerprint);
      await snapshot(repositories, input.profileId, runtime.now().slice(0, 10));
      return reversal;
    }),
    splitExpense: (profileId: string, originalId: string, splits: Split[]) => unit.execute(async repositories => {
      const original = await repositories.transactions.find(profileId, originalId);
      assert(original !== undefined, 'Gasto inexistente en este perfil');
      assert(!(await repositories.transactions.reversedBy(profileId, originalId)), 'No se puede desglosar un gasto revertido');
      const replacement = replaceExpenseSplits(original, splits);
      await categoriesValid(repositories, profileId, replacement, 'EXPENSE');
      await repositories.transactions.replaceSplits(profileId, originalId, replacement);
      return repositories.transactions.find(profileId, originalId);
    }),
    seedDevelopment: (profileId: string) => unit.execute(async repositories => {
      const existing = await repositories.accounts.list(profileId);
      if (existing.length) {
        const seeded = await Promise.all(['bank', 'saving', 'secondary'].map(key => repositories.accounts.byCreationKey(profileId, `dev-${key}`)));
        assert(seeded.every(Boolean), 'Los datos de ejemplo solo se cargan en un perfil vacío');
        return snapshot(repositories, profileId, runtime.now().slice(0, 10));
      }
      const effectiveDate = runtime.now().slice(0, 10);
      for (const value of [
        { name: 'Banco · ejemplo', type: 'bank', availabilityPolicy: 'free', initialBalanceMinor: 120000, key: 'bank' },
        { name: 'Ahorro · ejemplo', type: 'savings', availabilityPolicy: 'protected', initialBalanceMinor: 20000, key: 'saving' },
        { name: 'Secundaria · ejemplo', type: 'custom', availabilityPolicy: 'free', initialBalanceMinor: 10000, key: 'secondary' },
      ] satisfies (Omit<CreateAccountInput, 'profileId' | 'currency' | 'effectiveDate' | 'idempotencyKey'> & { key: string })[]) {
        await createAccount(repositories, { ...value, profileId, currency: 'USD', effectiveDate, idempotencyKey: `dev-${value.key}` });
      }
      return snapshot(repositories, profileId, runtime.now().slice(0, 10));
    }),
    close: () => unit.close(),
  };
}
export type FinanceApplication = ReturnType<typeof createFinanceApplication>;
