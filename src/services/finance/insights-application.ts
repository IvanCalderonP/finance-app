import { assert, currency, date, integer } from '../../financial-engine/model.ts';
import type { AccountBalance } from '../../financial-engine/model.ts';
import { calendarDays, calendarRange, manualCalendarEvent, remindersForEvents, validateManualEvent } from '../../financial-engine/financial-calendar.ts';
import type { CalendarView, FinancialCalendarEvent, ManualFinancialEvent } from '../../financial-engine/financial-calendar.ts';
import { calculateStatistics, historicalBalances, categoryDescendants } from '../../financial-engine/statistics.ts';
import type { StatisticsFilter } from '../../financial-engine/statistics.ts';
import { cycleForDate } from '../../financial-engine/cards.ts';
import { recurrenceThrough } from '../../financial-engine/recurrence.ts';
import { calculateAccountBalance } from '../../financial-engine/calculations.ts';
import type { Repositories, Runtime, UnitOfWork } from './contracts.ts';
import { runtimeDay, scopedUnitOfWork } from './contracts.ts';
import { createFinanceApplication } from './application.ts';
import { createBillingApplication } from './billing-application.ts';
import { planningProjections } from './planning-projections.ts';
import { ensureBudgetPeriods } from './planning-application.ts';
import type { InsightsSettings, NotificationMapping } from './insights-contracts.ts';
export interface SaveFinancialEventInput {
    profileId: string;
    id?: string;
    title: string;
    date: string;
    kind: 'income' | 'event';
    currency: string;
    amountMinor: number | null;
    description: string;
    completed: boolean;
}
function currentDay(runtime: Runtime) { return runtimeDay(runtime); }
async function events(repositories: Repositories, runtime: Runtime, profileId: string, start: string, end: string, materializeThrough = end, forecastBills = false): Promise<FinancialCalendarEvent[]> {
    const asOf = currentDay(runtime);
    const unit = scopedUnitOfWork(repositories);
    const [finance, billing, manual] = await Promise.all([createFinanceApplication(unit, runtime).snapshot(profileId), createBillingApplication(unit, runtime).snapshot(profileId, materializeThrough > asOf ? materializeThrough : asOf), repositories.insights.events(profileId)]);
    const planning = await planningProjections(repositories, profileId, finance.accounts, finance.transactions, finance.categories, asOf);
    const result = manual.map(row => manualCalendarEvent(row, asOf));
    for (const row of billing.bills)
        result.push({ key: `bill:${row.bill.seriesId}:${row.bill.periodIndex}`, reminderGroupKey: `bill-series:${row.bill.seriesId}`, source: 'bill', sourceId: row.bill.id, title: row.bill.name, date: row.bill.dueOn, amountMinor: row.status === 'paid' ? row.paidMinor : row.remainingMinor, currency: row.bill.currency, status: row.remainingMinor === 0 ? 'paid' : row.bill.dueOn < asOf ? 'overdue' : 'pending', route: `/bills?billId=${row.bill.id}`, description: row.status === 'reserved' ? 'Dinero reservado para este recibo' : 'Recibo o pago recurrente', editable: false });
    if (forecastBills) for (const series of billing.series.filter(row => row.active)) for (const period of recurrenceThrough(series, end)) {
        const key = `bill:${series.id}:${period.index}`;
        if (!result.some(row => row.key === key)) result.push({ key, reminderGroupKey: `bill-series:${series.id}`, source: 'bill', sourceId: series.id, title: series.name, date: period.dueOn, amountMinor: series.expectedMinor, currency: series.currency, status: period.dueOn < asOf ? 'overdue' : 'pending', route: '/bills', description: 'Próximo recibo de la serie; importe esperado', editable: false });
    }
    for (const row of finance.cards) {
        const openedOn = finance.transactions.filter(transaction => transaction.entries.some(entry => entry.nodeId === row.card.nodeId)).map(transaction => transaction.effectiveDate).sort()[0] ?? row.card.createdAt.slice(0, 10);
        for (const cycle of row.cycles)
            if (cycle.chargesMinor > 0)
                result.push({ key: `card-payment:${row.card.id}:${cycle.id}`, reminderGroupKey: `card-payment:${row.card.id}`, source: 'card_payment', sourceId: row.card.id, title: `Pago · ${row.card.name}`, date: cycle.dueOn, amountMinor: cycle.pendingMinor, currency: row.card.currency, status: cycle.pendingMinor === 0 ? 'paid' : cycle.dueOn < asOf ? 'overdue' : 'pending', route: `/cards?cardId=${row.card.id}`, description: `Ciclo que cierra ${cycle.closesOn}`, editable: false });
        let month = `${start.slice(0, 7)}-01`;
        const finalMonth = `${end.slice(0, 7)}-01`;
        while (month <= finalMonth) {
            const cycle = cycleForDate(month, row.card.closingDay, row.card.dueDay);
            if (cycle.closesOn >= openedOn)
                result.push({ key: `card-cut:${row.card.id}:${cycle.closesOn}`, reminderGroupKey: `card-cut:${row.card.id}`, source: 'card_cut', sourceId: row.card.id, title: `Corte · ${row.card.name}`, date: cycle.closesOn, amountMinor: null, currency: row.card.currency, status: cycle.closesOn < asOf ? 'completed' : 'pending', route: `/cards?cardId=${row.card.id}`, description: 'El corte no crea un movimiento financiero', editable: false });
            const d = new Date(`${month}T12:00:00Z`);
            d.setUTCMonth(d.getUTCMonth() + 1);
            month = d.toISOString().slice(0, 10);
        }
    }
    for (const row of finance.debts)
        if (row.debt.dueOn && row.status !== 'anulada')
            result.push({ key: `debt:${row.debt.id}`, source: 'debt', sourceId: row.debt.id, title: `${row.debt.direction === 'receivable' ? 'Cobrar' : 'Pagar'} · ${row.person.name}`, date: row.debt.dueOn, amountMinor: row.pendingMinor, currency: row.debt.currency, status: row.pendingMinor === 0 ? 'paid' : row.debt.dueOn < asOf ? 'overdue' : row.debt.direction === 'receivable' ? 'income' : 'pending', route: `/debts?debtId=${row.debt.id}`, description: row.debt.concept, editable: false });
    for (const row of planning.goals)
        if (row.goal.targetOn)
            result.push({ key: `goal:${row.goal.id}`, source: 'goal', sourceId: row.goal.id, title: row.goal.name, date: row.goal.targetOn, amountMinor: row.remainingMinor, currency: row.goal.currency, status: row.remainingMinor === 0 ? 'completed' : row.goal.targetOn < asOf ? 'overdue' : 'pending', route: `/goals?goalId=${row.goal.id}`, description: 'Fecha objetivo de ahorro', editable: false });
    for (const row of planning.reserves) result.push({ key: `reserve:${row.reserve.id}`, source: 'reserve', sourceId: row.reserve.id, title: `Liberación · ${row.reserve.name}`, date: row.reserve.unlockOn, amountMinor: row.amountMinor, currency: row.reserve.currency, status: row.status === 'released' ? 'completed' : 'pending', route: `/reserves?reserveId=${row.reserve.id}`, description: row.status === 'releasable' ? 'Disponible para liberar; confirma desde Reservas.' : 'La fecha no libera dinero automáticamente.', editable: false });
    return result.filter(row => row.date >= start && row.date <= end).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}
export function createInsightsApplication(unit: UnitOfWork, runtime: Runtime) {
    return {
        calendar: (profileId: string, input: {
            date: string;
            view: CalendarView;
        }) => unit.execute(async (repositories) => { const range = calendarRange(input.date, input.view); return { ...range, view: input.view, date: input.date, events: await events(repositories, runtime, profileId, range.start, range.end), reminders: await repositories.insights.reminders(profileId) }; }),
        upcoming: (profileId: string, start = currentDay(runtime), days = 31) => unit.execute(async (repositories) => { date(start); assert(Number.isInteger(days) && days >= 0 && days <= 366, 'Período inválido'); const d = new Date(`${start}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return events(repositories, runtime, profileId, start, d.toISOString().slice(0, 10)); }),
        saveEvent: (input: SaveFinancialEventInput) => unit.execute(async (repositories) => {
            const previous = input.id ? await repositories.insights.event(input.profileId, input.id) : undefined;
            assert(!input.id || !!previous, 'Evento inexistente en este perfil');
            const row: ManualFinancialEvent = { ...input, id: input.id ?? runtime.id(), title: input.title.trim(), description: input.description.trim(), createdAt: previous?.createdAt ?? runtime.now(), updatedAt: runtime.now(), incomeTransactionId: previous?.incomeTransactionId ?? null };
            assert(!row.incomeTransactionId || (row.kind === 'income' && row.currency === previous?.currency), 'Un ingreso recibido debe conservar su tipo y moneda');
            validateManualEvent(row);
            await repositories.insights.saveEvent(row);
            return row;
        }),
        completeEvent: (profileId: string, id: string, completed: boolean) => unit.execute(async (repositories) => { const row = await repositories.insights.event(profileId, id); assert(!!row, 'Evento inexistente en este perfil'); assert(row.kind === 'event', 'Registra el ingreso recibido desde Movimientos'); const updated = { ...row, completed, updatedAt: runtime.now() }; await repositories.insights.saveEvent(updated); return updated; }),
        linkIncome: (profileId: string, eventId: string, transactionId: string) => unit.execute(async (repositories) => { const event = await repositories.insights.event(profileId, eventId); assert(!!event && event.kind === 'income', 'Ingreso previsto inexistente'); const transaction = await repositories.transactions.find(profileId, transactionId); assert(!!transaction && transaction.type === 'INCOME' && transaction.currency === event.currency, 'Ingreso recibido incompatible'); assert(!(await repositories.transactions.reversedBy(profileId, transactionId)), 'El ingreso está revertido'); assert(!event.completed || event.incomeTransactionId === transactionId, 'Este ingreso previsto ya fue recibido'); const updated = { ...event, incomeTransactionId: transactionId, completed: true, updatedAt: runtime.now() }; await repositories.insights.saveEvent(updated); return updated; }),
        event: (profileId: string, id: string) => unit.execute(repositories => repositories.insights.event(profileId, id)),
        reminders: (profileId: string) => unit.execute(repositories => repositories.insights.reminders(profileId)),
        saveReminder: (profileId: string, eventKey: string, offsets: number[], enabled: boolean) => unit.execute(async (repositories) => { assert(eventKey.length > 0 && eventKey.length <= 200, 'Evento inválido'); assert(offsets.every(value => Number.isInteger(value) && value >= 0 && value <= 30), 'Anticipación inválida'); assert(!enabled || offsets.length > 0, 'Selecciona una anticipación'); const preference = { eventKey, enabled, offsets: [...new Set(offsets)].sort((a, b) => a - b) }; await repositories.insights.saveReminder(profileId, preference); return preference; }),
        reminderJobs: (profileId: string) => unit.execute(async (repositories) => { const today = currentDay(runtime); const end = new Date(`${today}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 366); const preferences = await repositories.insights.reminders(profileId); if (!preferences.some(row => row.enabled)) return []; const all = await events(repositories, runtime, profileId, today, end.toISOString().slice(0, 10), today, true); return remindersForEvents(all, preferences); }),
        mappings: (profileId: string) => unit.execute(repositories => repositories.insights.mappings(profileId)),
        replaceMappings: (profileId: string, mappings: NotificationMapping[]) => unit.execute(repositories => repositories.insights.replaceMappings(profileId, mappings)),
        settings: (profileId: string) => unit.execute(repositories => repositories.insights.settings(profileId)),
        saveSettings: (profileId: string, input: InsightsSettings) => unit.execute(async (repositories) => { currency(input.currency); assert(integer(input.smallThresholdMinor) > 0, 'Umbral inválido'); await repositories.insights.saveSettings(profileId, input); return input; }),
        snapshot: (profileId: string, filter: StatisticsFilter) => unit.execute(async (repositories) => {
            date(filter.start);
            date(filter.end);
            currency(filter.currency);
            assert(filter.start <= filter.end, 'Período inválido');
            assert(calendarDays(filter.start, filter.end).length <= 366, 'Consulta hasta un año por vez');
            const [accounts, transactions, categories, cards, debts, settings, policyHistory] = await Promise.all([repositories.accounts.list(profileId), repositories.transactions.list(profileId), repositories.categories.list(profileId), repositories.cards.list(profileId), repositories.debts.list(profileId), repositories.insights.settings(profileId), repositories.accounts.policyHistory(profileId)]);
            const stats = calculateStatistics(transactions, categories, accounts, cards, debts, filter, settings.find(row => row.currency === filter.currency)?.smallThresholdMinor ?? 500);
            const days = calendarDays(filter.start, filter.end);
            for (const day of days)
                await ensureBudgetPeriods(repositories, runtime, profileId, day);
            const [bucketRows, fundingEvents, budgetRows, periodRows, goalRows, reserveRows] = await Promise.all([repositories.planning.listBuckets(profileId), repositories.planning.listEvents(profileId), repositories.planning.listBudgets(profileId), repositories.planning.listPeriods(profileId), repositories.planning.listGoals(profileId), repositories.planning.listReserves(profileId)]);
            // Load once; daily projections stay in memory instead of issuing thousands of SQLite bridge calls.
            const projectionRepos: Repositories = { ...repositories, planning: { ...repositories.planning, listBuckets: async () => bucketRows, listEvents: async () => fundingEvents, listBudgets: async () => budgetRows, listPeriods: async () => periodRows, listGoals: async () => goalRows, listReserves: async () => reserveRows }, cards: { ...repositories.cards, list: async () => cards }, debts: { ...repositories.debts, list: async () => debts } };
            const commitments = new Map<string, Awaited<ReturnType<typeof planningProjections>>>();
            for (const asOf of days) {
                const entries = transactions.filter(row => row.effectiveDate <= asOf).flatMap(row => row.entries);
                const balances: AccountBalance[] = accounts.map(account => { const policies = policyHistory.filter(row => row.accountId === account.id && row.effectiveDate <= asOf); const datedAccount = { ...account, availabilityPolicy: policies.at(-1)?.policy ?? account.availabilityPolicy }; return { account: datedAccount, balanceMinor: calculateAccountBalance(account, entries) }; });
                commitments.set(asOf, await planningProjections(projectionRepos, profileId, balances, transactions, categories, asOf));
            }
            const balances = historicalBalances({ transactions, accounts, cards, debts, ...filter, policyHistory, commitmentsAt: asOf => commitments.get(asOf)?.commitments ?? [], liabilityExcludedAt: asOf => commitments.get(asOf)?.liabilityExcluded ?? [] });
            const planning = commitments.get(filter.end)!;
            const budgets = planning.budgets.filter(row => row.period.endsOn >= filter.start && row.period.startsOn <= filter.end && row.budget.currency === filter.currency).map(row => { const ids = categoryDescendants(categories, row.budget.categoryId); const spentMinor = stats.expenses.filter(expense => expense.transaction.effectiveDate >= row.period.startsOn && expense.transaction.effectiveDate <= row.period.endsOn).flatMap(expense => expense.splits.filter(split => ids.has(split.categoryId))).reduce((sum, split) => integer(sum + split.amountMinor), 0); return { ...row, spentMinor, remainingMinor: integer(row.assignedMinor - spentMinor), percentUsed: spentMinor / row.assignedMinor * 100, exceeded: spentMinor > row.assignedMinor }; });
            return { ...stats, balances, accounts, categoryOptions: categories, cards, budgets, goals: planning.goals, goalContributions: planning.goals.map(row => ({ goalId: row.goal.id, name: row.goal.name, currency: row.goal.currency, amountMinor: row.history.filter(event => event.effectiveDate >= filter.start && event.effectiveDate <= filter.end && event.amountMinor > 0 && (event.kind === 'fund' || event.kind === 'move')).reduce((sum, event) => integer(sum + event.amountMinor), 0) })) };
        }),
    };
}
export type InsightsApplication = ReturnType<typeof createInsightsApplication>;
export type InsightsSnapshot = Awaited<ReturnType<InsightsApplication['snapshot']>>;
export type CalendarSnapshot = Awaited<ReturnType<InsightsApplication['calendar']>>;
