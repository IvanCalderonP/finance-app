import { runtimeDay } from './contracts.ts';
import { canonicalJson } from '../../utils/canonical.ts';
import { planningProjections } from './planning-projections.ts';
import type { PlanningSnapshot } from './planning-projections.ts';
import type { FundingOwner } from '../../financial-engine/planning.ts';
import { ensureBudgetPeriods, spendability, consumeFunding, restoreConsumption, validateFunding, reconcileLiabilityFunding } from './planning-application.ts';
import { debtProjections } from './debt-projections.ts';
import type { DebtSummary } from '../../financial-engine/debts.ts';
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
  expectedEventId?:string; fundingOwner?:FundingOwner; accountId: string; amountMinor: number; categoryId?: string; toAccountId?: string; allowProtected?: boolean;
}
export interface FinanceSnapshot {
  planning:PlanningSnapshot; cards: CardSummary[]; debts: DebtSummary[]; accounts: AccountBalance[]; categories: Category[]; transactions: Transaction[];
  totals: { currency: string; physicalMinor: number; committedMinor:number;reservedMinor:number; cardDebtMinor: number; payableMinor: number; receivableMinor: number; netWorthLiquidMinor: number; availableMinor: number; netWorthMinor: number; incomeMinor: number; expenseMinor: number }[];
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
  const debts = await debtProjections(repositories, profileId, entries, asOf);
  const receivables = debts.filter(row => row.debt.direction === 'receivable').map(row => ({currency:row.debt.currency,amountMinor:row.pendingMinor}));
  const payable = debts.filter(row => row.debt.direction === 'payable').map(row => ({id:row.debt.id,currency:row.debt.currency,amountMinor:row.pendingMinor,alreadyExcludedMinor:0}));
  const liabilities = cards.map(row => ({ id: row.card.id, currency: row.card.currency, amountMinor: row.debtMinor, alreadyExcludedMinor: 0 }));
  const planning=await planningProjections(repositories,profileId,balances,transactions,categories,asOf);
  for(const liability of liabilities)liability.alreadyExcludedMinor=planning.liabilityExcluded.find(row=>row.kind==='card'&&row.id===liability.id)?.amountMinor??0;
  for(const liability of payable)liability.alreadyExcludedMinor=planning.liabilityExcluded.find(row=>row.kind==='debt'&&row.id===liability.id)?.amountMinor??0;
  const debtLiabilities=[...liabilities,...payable];
  const commitments = [...debtLiabilities,...planning.commitments];
  return { planning, cards, debts, accounts: balances, categories, transactions,
    totals: [...new Set([...accounts.map(row => row.currency), ...cards.map(row => row.card.currency),...debts.map(row => row.debt.currency)])].map(currency => ({
      currency, payableMinor: total(payable.filter(row => row.currency === currency).map(row => row.amountMinor)),
      receivableMinor: total(receivables.filter(row => row.currency === currency).map(row => row.amountMinor)),
      committedMinor: integer(calculatePhysicalBalance(balances,currency)-calculateAvailableBalance(balances,currency,commitments)),
      reservedMinor: total(planning.buckets.filter(row=>row.bucket.currency===currency&&row.bucket.kind!=='card'&&row.bucket.kind!=='debt').map(row=>row.fundedMinor)),
      netWorthLiquidMinor: calculateNetWorth(balances,currency,[],debtLiabilities), cardDebtMinor: total(liabilities.filter(row => row.currency === currency).map(row => row.amountMinor)), physicalMinor: calculatePhysicalBalance(balances, currency), availableMinor: calculateAvailableBalance(balances, currency, commitments),
      netWorthMinor: calculateNetWorth(balances, currency, receivables, debtLiabilities),
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
    const fingerprint = canonicalJson(normalized);
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
    await repositories.accounts.recordPolicy(input.profileId,{id:runtime.id(),accountId:account.id,effectiveDate:input.effectiveDate,policy:account.availabilityPolicy,createdAt:runtime.now()});
    if (input.initialBalanceMinor !== 0) {
      const equity = await repositories.ledger.systemNode(input.profileId, input.currency, 'EQUITY');
      const opening = registerOpeningBalance(context({ ...input, idempotencyKey: `${input.idempotencyKey}:opening`, description: 'Saldo inicial' }), account, input.initialBalanceMinor, equity);
      await repositories.transactions.insert(opening, fingerprint);
    }
    await snapshot(repositories, input.profileId, runtimeDay(runtime)); // Reject overflow before committing.
    return account;
  }
  return {
    preferences:(profileId:string)=>unit.execute(repositories=>repositories.preferences.get(profileId)),
    setPreferences:(profileId:string,value:{theme:'light'|'dark'|'system';hideAmounts:boolean})=>unit.execute(async repositories=>{
      assert(['light','dark','system'].includes(value.theme)&&typeof value.hideAmounts==='boolean','Preferencias inválidas');
      await repositories.preferences.set(profileId,value);return value;
    }),
    createCategory:(input:{profileId:string;idempotencyKey:string;name:string;kind:Category['kind'];parentId?:string|null})=>unit.execute(async repositories=>{
      key(input.idempotencyKey);const name=input.name.trim(),parentId=input.parentId??null;
      assert(name.length>0&&name.length<=100&&['INCOME','EXPENSE'].includes(input.kind),'Categoría inválida');
      const normalized={profileId:input.profileId,name,kind:input.kind,parentId};const fingerprint=JSON.stringify(normalized);
      const previous=await repositories.categories.byKey(input.profileId,input.idempotencyKey);
      if(previous){assert(previous.fingerprint===fingerprint,'La clave corresponde a otra categoría');return previous.category;}
      if(parentId)assert((await repositories.categories.list(input.profileId)).some(row=>row.id===parentId&&row.kind===input.kind),'Categoría padre incompatible');
      const category:Category={id:runtime.id(),profileId:input.profileId,name,kind:input.kind,code:`custom-${runtime.id()}`,parentId};
      await repositories.categories.insert(category,input.idempotencyKey,fingerprint);return category;
    }),
    renameCategory:(profileId:string,id:string,name:string)=>unit.execute(async repositories=>{
      const trimmed=name.trim();assert(trimmed.length>0&&trimmed.length<=100,'Nombre inválido');
      assert((await repositories.categories.list(profileId)).some(row=>row.id===id),'Categoría inexistente');await repositories.categories.rename(profileId,id,trimmed);
    }),
    initialProfile: () => unit.execute(repositories => repositories.profiles.initial()),
    snapshot: (profileId: string) => unit.execute(async repositories => {await ensureBudgetPeriods(repositories,runtime,profileId,runtimeDay(runtime));return snapshot(repositories, profileId, runtimeDay(runtime));}),
    createAccount: (input: CreateAccountInput) => unit.execute(repositories => createAccount(repositories, input)),
    configureAccount: (profileId: string, accountId: string, active: boolean, policy: Account['availabilityPolicy']) => unit.execute(async repositories => {
      const current = await requireAccount(repositories, profileId, accountId);
      assert(['free', 'protected'].includes(policy), 'Disponibilidad inválida');
      await repositories.accounts.configure(profileId, accountId, active, policy);
      if(current.availabilityPolicy!==policy)await repositories.accounts.recordPolicy(profileId,{id:runtime.id(),accountId,effectiveDate:runtimeDay(runtime),policy,createdAt:runtime.now()});
      await validateFunding(repositories,profileId);
      return snapshot(repositories, profileId, runtimeDay(runtime));
    }),
    post: (input: MovementInput) => unit.execute(async repositories => {
      assert(['INCOME', 'EXPENSE', 'DAILY', 'TRANSFER', 'ADJUSTMENT'].includes(input.kind), 'Operación no soportada');
      const normalized = { profileId: input.profileId, kind: input.kind, accountId: input.accountId, amountMinor: input.amountMinor,
        idempotencyKey: input.idempotencyKey, effectiveDate: input.effectiveDate, description: input.description.trim(),
        categoryId: input.kind === 'INCOME' || input.kind === 'EXPENSE' ? input.categoryId : undefined,
        toAccountId: input.kind === 'TRANSFER' ? input.toAccountId : undefined, allowProtected: input.allowProtected ?? false, fundingOwner:input.fundingOwner,expectedEventId:input.kind==='INCOME'?input.expectedEventId:undefined };
      const fingerprint = canonicalJson(normalized);
      key(input.idempotencyKey);
      const previous = await repositories.transactions.byKey(input.profileId, input.idempotencyKey);
      if (previous) { assert(previous.fingerprint === fingerprint, 'La clave ya corresponde a otra operación'); return previous.transaction; }
      const account = await requireAccount(repositories, input.profileId, input.accountId);
      if(input.expectedEventId){
        assert(input.kind==='INCOME','Solo un ingreso puede completar un ingreso previsto');
        const event=await repositories.insights.event(input.profileId,input.expectedEventId);
        assert(!!event&&event.kind==='income'&&event.currency===account.currency,'Ingreso previsto inexistente o incompatible');
        assert(!event.completed,'El ingreso previsto ya fue recibido');
      }
      const ctx = context(input);
      let transaction: Transaction;
      if (input.kind === 'TRANSFER') {
        assert(input.toAccountId !== undefined, 'Selecciona la cuenta destino');
        const to = await requireAccount(repositories, input.profileId, input.toAccountId);
        transaction = transferBetweenAccounts(ctx, account, to, input.amountMinor, await spendability(repositories,input.profileId,account.id), input.allowProtected);
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
        else if (input.kind === 'DAILY') transaction = registerDailyExpenseWithdrawal(ctx, account, input.amountMinor, node, categoryId, await spendability(repositories,input.profileId,account.id,input.fundingOwner,[categoryId]), input.allowProtected);
        else transaction = registerExpense(ctx, account, input.amountMinor, node, categoryId, await spendability(repositories,input.profileId,account.id,input.fundingOwner,[categoryId]), input.allowProtected);
      }
      await repositories.transactions.insert(transaction, fingerprint);
      if(input.kind==='EXPENSE'||input.kind==='DAILY')await consumeFunding(repositories,runtime,{profileId:input.profileId,accountId:account.id,amountMinor:input.amountMinor,transactionId:transaction.id,owner:input.fundingOwner,categoryAmounts:transaction.splits,ownerAcrossAccounts:input.fundingOwner?.kind==='bill'});
      if(input.expectedEventId)await repositories.insights.linkIncome(input.profileId,input.expectedEventId,transaction.id);
      await validateFunding(repositories,input.profileId);
      await snapshot(repositories, input.profileId, runtimeDay(runtime));
      return transaction;
    }),
    reverse: (input: BaseInput & { originalId: string }) => unit.execute(async repositories => {
      const normalized = { ...input, description: input.description.trim() };
      const fingerprint = canonicalJson(normalized);
      key(input.idempotencyKey);
      const previous = await repositories.transactions.byKey(input.profileId, input.idempotencyKey);
      if (previous) { assert(previous.fingerprint === fingerprint, 'Clave de reverso reutilizada'); return previous.transaction; }
      const original = await repositories.transactions.find(input.profileId, input.originalId);
      assert(original !== undefined, 'Movimiento inexistente en este perfil');
      assert(!(await repositories.cards.related(input.profileId, input.originalId)), 'Usa Tarjetas para revertir compras; reverso de pagos fuera de V1');
      assert(!(await repositories.debts.related(input.profileId,input.originalId)), 'Usa Deudas para revertir este movimiento');
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
      await restoreConsumption(repositories,runtime,input.profileId,original.id,reversal.id);
      await reconcileLiabilityFunding(repositories,runtime,input.profileId,input.effectiveDate,reversal.id);
      await validateFunding(repositories,input.profileId);
      await snapshot(repositories, input.profileId, runtimeDay(runtime));
      return reversal;
    }),
    splitExpense: (profileId: string, originalId: string, splits: Split[]) => unit.execute(async repositories => {
      const original = await repositories.transactions.find(profileId, originalId);
      assert(original !== undefined, 'Gasto inexistente en este perfil');
      const replacement = replaceExpenseSplits(original, splits);
      await categoriesValid(repositories, profileId, replacement, 'EXPENSE');
      const unchanged=JSON.stringify([...original.splits].sort((a,b)=>a.categoryId.localeCompare(b.categoryId)))===JSON.stringify([...replacement].sort((a,b)=>a.categoryId.localeCompare(b.categoryId)));
      if(!unchanged){
        await repositories.categories.recordSplitEdit(profileId,originalId,original.splits,replacement);
        await repositories.transactions.replaceSplits(profileId,originalId,replacement);
        const reversal=await repositories.transactions.reversedBy(profileId,originalId);
        if(reversal){const reverseSplits=replacement.map(row=>({...row,amountMinor:-row.amountMinor}));await repositories.categories.recordSplitEdit(profileId,reversal.id,reversal.splits,reverseSplits);await repositories.transactions.replaceSplits(profileId,reversal.id,reverseSplits);}
      }
      return repositories.transactions.find(profileId, originalId);
    }),
    seedDevelopment: (profileId: string) => unit.execute(async repositories => {
      const existing = await repositories.accounts.list(profileId);
      if (existing.length) {
        const seeded = await Promise.all(['bank', 'saving', 'secondary'].map(key => repositories.accounts.byCreationKey(profileId, `dev-${key}`)));
        assert(seeded.every(Boolean), 'Los datos de ejemplo solo se cargan en un perfil vacío');
        return snapshot(repositories, profileId, runtimeDay(runtime));
      }
      const effectiveDate = runtimeDay(runtime);
      for (const value of [
        { name: 'Banco · ejemplo', type: 'bank', availabilityPolicy: 'free', initialBalanceMinor: 120000, key: 'bank' },
        { name: 'Ahorro · ejemplo', type: 'savings', availabilityPolicy: 'protected', initialBalanceMinor: 20000, key: 'saving' },
        { name: 'Secundaria · ejemplo', type: 'custom', availabilityPolicy: 'free', initialBalanceMinor: 10000, key: 'secondary' },
      ] satisfies (Omit<CreateAccountInput, 'profileId' | 'currency' | 'effectiveDate' | 'idempotencyKey'> & { key: string })[]) {
        await createAccount(repositories, { ...value, profileId, currency: 'USD', effectiveDate, idempotencyKey: `dev-${value.key}` });
      }
      return snapshot(repositories, profileId, runtimeDay(runtime));
    }),
    close: () => unit.close(),
  };
}
export type FinanceApplication = ReturnType<typeof createFinanceApplication>;
