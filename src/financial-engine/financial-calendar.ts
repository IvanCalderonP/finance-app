import { assert, date, integer } from './model.ts';
export type CalendarView = 'day' | 'week' | 'month';
export type CalendarStatus = 'paid' | 'pending' | 'overdue' | 'income' | 'completed';
export interface FinancialCalendarEvent {
    key: string;
    reminderGroupKey?: string;
    source: 'bill' | 'card_payment' | 'card_cut' | 'debt' | 'income' | 'goal' | 'reserve' | 'manual';
    sourceId: string;
    title: string;
    date: string;
    amountMinor: number | null;
    currency: string;
    status: CalendarStatus;
    route: string;
    description: string;
    editable: boolean;
}
export interface ManualFinancialEvent {
    id: string;
    profileId: string;
    title: string;
    date: string;
    kind: 'income' | 'event';
    currency: string;
    amountMinor: number | null;
    description: string;
    completed: boolean;
    incomeTransactionId?: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface ReminderPreference {
    eventKey: string;
    enabled: boolean;
    offsets: number[];
}
export interface ReminderJob {
    eventKey: string;
    date: string;
    title: string;
    body: string;
    route: string;
    offsetDays: number;
}
export function addCalendarDays(value: string, days: number) { date(value); assert(Number.isInteger(days), 'Desplazamiento inválido'); const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function calendarRange(selected: string, view: CalendarView) {
    date(selected);
    const d = new Date(`${selected}T12:00:00Z`);
    if (view === 'day')
        return { start: selected, end: selected };
    if (view === 'week') {
        const start = addCalendarDays(selected, -((d.getUTCDay() + 6) % 7));
        return { start, end: addCalendarDays(start, 6) };
    }
    assert(view === 'month', 'Vista inválida');
    const start = `${selected.slice(0, 7)}-01`;
    d.setUTCMonth(d.getUTCMonth() + 1, 0);
    return { start, end: d.toISOString().slice(0, 10) };
}
export function shiftCalendarPeriod(selected: string, view: CalendarView, direction: 1 | -1) {
    if (view === 'day')
        return addCalendarDays(selected, direction);
    if (view === 'week')
        return addCalendarDays(selected, 7 * direction);
    const d = new Date(`${selected.slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + direction);
    return d.toISOString().slice(0, 10);
}
export function calendarDays(start: string, end: string) { date(start); date(end); assert(start <= end, 'Período inválido'); const days: string[] = []; for (let d = start; d <= end; d = addCalendarDays(d, 1)) {
    assert(days.length < 3700, 'El período es demasiado largo');
    days.push(d);
} return days; }
export function manualCalendarEvent(row: ManualFinancialEvent, today: string): FinancialCalendarEvent {
    date(today);
    return { key: `manual:${row.id}`, source: row.kind === 'income' ? 'income' : 'manual', sourceId: row.id, title: row.title, date: row.date, amountMinor: row.amountMinor, currency: row.currency,
        status: row.completed ? 'completed' : row.kind === 'income' ? 'income' : row.date < today ? 'overdue' : 'pending',
        route: row.kind === 'income' ? (row.completed ? '/transactions' : `/transactions?action=INCOME&currency=${row.currency}&eventId=${row.id}&amount=${row.amountMinor ?? ''}&currency=${row.currency}&description=${encodeURIComponent(row.title)}`) : `/calendar?eventId=${row.id}`, description: row.description, editable: true };
}
export function remindersForEvents(events: FinancialCalendarEvent[], preferences: ReminderPreference[]): ReminderJob[] {
    const seen = new Set<string>();
    const jobs: ReminderJob[] = [];
    for (const event of events) {
        if (['paid', 'completed'].includes(event.status))
            continue;
        const preference = preferences.find(row => row.eventKey === event.key) ?? preferences.find(row => row.eventKey === event.reminderGroupKey);
        if (!preference?.enabled)
            continue;
        for (const offsetDays of preference.offsets) {
            assert(Number.isInteger(offsetDays) && offsetDays >= 0 && offsetDays <= 30, 'Anticipación inválida');
            const key = `${event.key}:${offsetDays}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            jobs.push({ eventKey: event.key, date: addCalendarDays(event.date, -offsetDays), offsetDays, title: event.title, body: offsetDays === 0 ? 'Tu evento financiero es hoy.' : `Tu evento financiero es dentro de ${offsetDays} ${offsetDays === 1 ? 'día' : 'días'}.`, route: event.route });
        }
    }
    return jobs.sort((a, b) => a.date.localeCompare(b.date) || a.eventKey.localeCompare(b.eventKey) || a.offsetDays - b.offsetDays);
}
export function validateManualEvent(event: ManualFinancialEvent) { date(event.date); assert(event.title.trim().length > 0 && event.title.length <= 100, 'Nombre de evento inválido'); assert(event.kind === 'income' || event.kind === 'event', 'Tipo de evento inválido'); assert(/^[A-Z]{3}$/.test(event.currency), 'Moneda inválida'); if (event.amountMinor !== null)
    assert(integer(event.amountMinor) > 0, 'Monto previsto inválido'); assert(event.description.length <= 500, 'Descripción demasiado larga'); }
