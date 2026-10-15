import { assert, date, integer, total } from './model.ts';
import type { Account, Category, Commitment, Transaction } from './model.ts';
import { calculateAccountBalance, calculateAvailableBalance, calculateNetWorth, calculatePhysicalBalance } from './calculations.ts';
import type { CreditCard } from './cards.ts';
import { calculateCreditCardDebt } from './cards.ts';
import { calculateDebtPending } from './debts.ts';
import type { Debt } from './debts.ts';
import { calendarDays } from './financial-calendar.ts';
export interface StatisticsFilter {
    start: string;
    end: string;
    currency: string;
    accountId?: string;
    categoryId?: string;
    cardId?: string;
}
export interface PaymentMethod {
    id: string;
    kind: 'bank' | 'cash' | 'savings' | 'custom' | 'card' | 'financed';
    name: string;
    accountId?: string;
    cardId?: string;
}
export interface ClassifiedExpense {
    transaction: Transaction;
    sourceTransactionId: string;
    amountMinor: number;
    method: PaymentMethod;
    splits: {
        categoryId: string;
        amountMinor: number;
    }[];
}
export interface CategoryStatistics {
    categoryId: string;
    name: string;
    parentId: string | null;
    directMinor: number;
    rolledUpMinor: number;
}
export interface StatisticsResult {
    filter: StatisticsFilter;
    incomeMinor: number;
    expenseMinor: number;
    operatingSurplusMinor: number;
    cashFlowMinor: number;
    prior: {
        start: string;
        end: string;
        incomeMinor: number;
        expenseMinor: number;
        operatingSurplusMinor: number;
    };
    categories: CategoryStatistics[];
    methods: {
        method: PaymentMethod;
        amountMinor: number;
    }[];
    expenses: ClassifiedExpense[];
    smallExpenses: ClassifiedExpense[];
    smallExpenseMinor: number;
    smallThresholdMinor: number;
}
export interface BalancePoint {
    date: string;
    physicalMinor: number;
    availableMinor: number;
    netWorthMinor: number;
    netWorthWithoutReceivablesMinor: number;
    cardDebtMinor: number;
    payableMinor: number;
    receivableMinor: number;
    committedMinor: number;
}
export interface AccountPolicyHistory {
    id: string;
    accountId: string;
    effectiveDate: string;
    policy: 'free' | 'protected';
    createdAt: string;
}
function parent(category: Category) { return (category as Category & {
    parentId?: string | null;
}).parentId ?? null; }
export function categoryDescendants(categories: Category[], id: string) {
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const row of categories)
            if (parent(row) && ids.has(parent(row)!) && !ids.has(row.id)) {
                ids.add(row.id);
                changed = true;
            }
    }
    return ids;
}
function methodFor(transaction: Transaction, accounts: Account[], cards: CreditCard[], debts: Debt[]): PaymentMethod {
    const card = cards.find(row => transaction.entries.some(entry => entry.nodeId === row.nodeId));
    if (card)
        return { id: `card:${card.id}`, kind: 'card', name: card.name, cardId: card.id };
    const account = accounts.find(row => transaction.entries.some(entry => entry.nodeId === row.nodeId && entry.creditMinor > 0));
    if (account)
        return { id: `account:${account.id}`, kind: account.type, name: account.name, accountId: account.id };
    const debt = debts.find(row => transaction.entries.some(entry => entry.nodeId === row.nodeId));
    if (debt)
        return { id: `debt:${debt.id}`, kind: 'financed', name: debt.concept };
    return { id: 'other', kind: 'financed', name: 'Otro financiamiento' };
}
export function classifyExpenses(transactions: Transaction[], categories: Category[], accounts: Account[], cards: CreditCard[], debts: Debt[]): ClassifiedExpense[] {
    const expenseIds = new Set(categories.filter(row => row.kind === 'EXPENSE').map(row => row.id));
    return transactions.flatMap(transaction => {
        const splits = transaction.splits.filter(row => expenseIds.has(row.categoryId));
        const amountMinor = total(splits.map(row => row.amountMinor));
        if (amountMinor === 0)
            return [];
        const source = transaction.reversalOf ? transactions.find(row => row.id === transaction.reversalOf) ?? transaction : transaction;
        return [{ transaction, sourceTransactionId: source.id, amountMinor, method: methodFor(source, accounts, cards, debts), splits }];
    });
}
export function previousStatisticsPeriod(start: string, end: string) {
    date(start);
    date(end);
    assert(start <= end, 'Período inválido');
    const first = new Date(`${start}T12:00:00Z`), last = new Date(`${end}T12:00:00Z`);
    const monthEnd = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12));
    if (first.getUTCDate() === 1 && last.getTime() === monthEnd.getTime()) {
        const priorEnd = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 0, 12));
        const priorStart = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, 1, 12));
        return { start: priorStart.toISOString().slice(0, 10), end: priorEnd.toISOString().slice(0, 10) };
    }
    const days = Math.round((last.getTime() - first.getTime()) / 86400000) + 1;
    first.setUTCDate(first.getUTCDate() - days);
    last.setUTCDate(last.getUTCDate() - days);
    return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}
export function calculateStatistics(transactions: Transaction[], categories: Category[], accounts: Account[], cards: CreditCard[], debts: Debt[], filter: StatisticsFilter, smallThresholdMinor = 500): StatisticsResult {
    date(filter.start);
    date(filter.end);
    assert(filter.start <= filter.end, 'Período inválido');
    assert(integer(smallThresholdMinor) > 0, 'Umbral inválido');
    const categoryIds = filter.categoryId ? categoryDescendants(categories, filter.categoryId) : undefined;
    const expenses = classifyExpenses(transactions, categories, accounts, cards, debts);
    function selection(start: string, end: string) { return expenses.filter(row => row.transaction.currency === filter.currency && row.transaction.effectiveDate >= start && row.transaction.effectiveDate <= end && (!filter.accountId || row.method.accountId === filter.accountId) && (!filter.cardId || row.method.cardId === filter.cardId)).map(row => ({ ...row, splits: row.splits.filter(split => !categoryIds || categoryIds.has(split.categoryId)) })).map(row => ({ ...row, amountMinor: total(row.splits.map(split => split.amountMinor)) })).filter(row => row.amountMinor !== 0); }
    function income(start: string, end: string) {
        return total(transactions.filter(row => row.currency === filter.currency && row.effectiveDate >= start && row.effectiveDate <= end && !filter.cardId && (!filter.accountId || row.entries.some(entry => accounts.some(account => account.id === filter.accountId && account.nodeId === entry.nodeId)))).flatMap(row => row.splits.filter(split => categories.some(category => category.id === split.categoryId && category.kind === 'INCOME') && (!categoryIds || categoryIds.has(split.categoryId))).map(split => split.amountMinor)));
    }
    const selected = selection(filter.start, filter.end), expenseMinor = total(selected.map(row => row.amountMinor)), incomeMinor = income(filter.start, filter.end);
    const categoryRows = categories.filter(row => row.kind === 'EXPENSE').map(category => { const descendants = categoryDescendants(categories, category.id); return { categoryId: category.id, name: category.name, parentId: parent(category), directMinor: total(selected.flatMap(row => row.splits.filter(split => split.categoryId === category.id).map(split => split.amountMinor))), rolledUpMinor: total(selected.flatMap(row => row.splits.filter(split => descendants.has(split.categoryId)).map(split => split.amountMinor))) }; });
    const methods = [...new Set(selected.map(row => row.method.id))].map(id => ({ method: selected.find(row => row.method.id === id)!.method, amountMinor: total(selected.filter(row => row.method.id === id).map(row => row.amountMinor)) }));
    const smallIds = new Set(expenses.filter(row => row.amountMinor > 0 && row.amountMinor < smallThresholdMinor).map(row => row.sourceTransactionId));
    const smallExpenses = selected.filter(row => smallIds.has(row.sourceTransactionId));
    const priorRange = previousStatisticsPeriod(filter.start, filter.end), priorExpense = total(selection(priorRange.start, priorRange.end).map(row => row.amountMinor)), priorIncome = income(priorRange.start, priorRange.end);
    const selectedAccountNodes = new Set(accounts.filter(row => (!filter.accountId || row.id === filter.accountId) && row.currency === filter.currency).map(row => row.nodeId));
    let cashFlowMinor = total(transactions.filter(row => row.currency === filter.currency && row.effectiveDate >= filter.start && row.effectiveDate <= filter.end && (!filter.cardId || row.entries.some(entry => cards.some(card => card.id === filter.cardId && card.nodeId === entry.nodeId))) && !['OPENING', 'ADJUSTMENT'].includes(row.type) && !(row.reversalOf && ['OPENING', 'ADJUSTMENT'].includes(transactions.find(original => original.id === row.reversalOf)?.type ?? ''))).flatMap(row => row.entries.filter(entry => selectedAccountNodes.has(entry.nodeId)).map(entry => entry.debitMinor - entry.creditMinor)));
    if (categoryIds)
        cashFlowMinor = integer(incomeMinor - total(selected.filter(row => row.method.kind !== 'card' && row.method.kind !== 'financed').map(row => row.amountMinor)));
    return { filter, incomeMinor, expenseMinor, operatingSurplusMinor: integer(incomeMinor - expenseMinor), cashFlowMinor, prior: { ...priorRange, incomeMinor: priorIncome, expenseMinor: priorExpense, operatingSurplusMinor: integer(priorIncome - priorExpense) }, categories: categoryRows, methods, expenses: selected, smallExpenses, smallExpenseMinor: total(smallExpenses.map(row => row.amountMinor)), smallThresholdMinor };
}
// Prefix all previous ledger entries, including opening balances; never restart at zero at the period boundary.
export function historicalBalances(input: {
    transactions: Transaction[];
    accounts: Account[];
    cards: CreditCard[];
    debts: Debt[];
    start: string;
    end: string;
    currency: string;
    policyHistory?: AccountPolicyHistory[];
    commitmentsAt?: (asOf: string, accounts: {
        account: Account;
        balanceMinor: number;
    }[]) => Commitment[];
    liabilityExcludedAt?: (asOf: string) => {
        kind: 'card' | 'debt';
        id: string;
        amountMinor: number;
    }[];
}): BalancePoint[] {
    return calendarDays(input.start, input.end).map(asOf => {
        const entries = input.transactions.filter(row => row.effectiveDate <= asOf).flatMap(row => row.entries);
        const accounts = input.accounts.map(account => { const history = (input.policyHistory ?? []).filter(row => row.accountId === account.id && row.effectiveDate <= asOf).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.createdAt.localeCompare(b.createdAt)); return { ...account, availabilityPolicy: history.at(-1)?.policy ?? account.availabilityPolicy }; });
        const balances = accounts.map(account => ({ account, balanceMinor: calculateAccountBalance(account, entries) }));
        const cards = input.cards.map(card => ({ id: card.id, currency: card.currency, amountMinor: calculateCreditCardDebt(card, entries), alreadyExcludedMinor: 0 }));
        const payables = input.debts.filter(row => row.direction === 'payable').map(debt => ({ id: debt.id, currency: debt.currency, amountMinor: calculateDebtPending(debt, entries), alreadyExcludedMinor: 0 }));
        const receivables = input.debts.filter(row => row.direction === 'receivable').map(debt => ({ currency: debt.currency, amountMinor: calculateDebtPending(debt, entries) }));
        const excluded = input.liabilityExcludedAt?.(asOf) ?? [];
        const financial = [...cards.map(row => ({ ...row, alreadyExcludedMinor: excluded.find(value => value.kind === 'card' && value.id === row.id)?.amountMinor ?? 0 })), ...payables.map(row => ({ ...row, alreadyExcludedMinor: excluded.find(value => value.kind === 'debt' && value.id === row.id)?.amountMinor ?? 0 }))];
        const reserved = input.commitmentsAt?.(asOf, balances) ?? [];
        return { date: asOf, physicalMinor: calculatePhysicalBalance(balances, input.currency), availableMinor: calculateAvailableBalance(balances, input.currency, [...financial, ...reserved]), netWorthMinor: calculateNetWorth(balances, input.currency, receivables, financial), netWorthWithoutReceivablesMinor: calculateNetWorth(balances, input.currency, [], financial), cardDebtMinor: total(cards.filter(row => row.currency === input.currency).map(row => row.amountMinor)), payableMinor: total(payables.filter(row => row.currency === input.currency).map(row => row.amountMinor)), receivableMinor: total(receivables.filter(row => row.currency === input.currency).map(row => row.amountMinor)), committedMinor: total(reserved.filter(row => row.currency === input.currency).map(row => Math.max(0, row.amountMinor - row.alreadyExcludedMinor))) };
    });
}
