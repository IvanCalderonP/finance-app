import { assert, date, integer } from './model.ts';
export type Recurrence = { frequency: 'once' | 'weekly' | 'monthly' | 'custom'; intervalDays: number | null; anchorDate: string };
function utc(value: string) { date(value); return new Date(`${value}T00:00:00.000Z`); }
export function addDays(value: string, days: number) { integer(days); const result = utc(value); result.setUTCDate(result.getUTCDate() + days); const output = result.toISOString().slice(0, 10); date(output); return output; }
export function recurrenceDate(rule: Recurrence, occurrence: number): string {
  assert(integer(occurrence) >= 0 && occurrence <= 100000, 'Número de período inválido'); date(rule.anchorDate);
  assert(['once', 'weekly', 'monthly', 'custom'].includes(rule.frequency), 'Frecuencia inválida');
  if (rule.frequency === 'once') { assert(occurrence === 0, 'Un evento único no se renueva'); return rule.anchorDate; }
  if (rule.frequency === 'weekly') return addDays(rule.anchorDate, occurrence * 7);
  if (rule.frequency === 'custom') { assert(rule.intervalDays !== null && integer(rule.intervalDays) > 0 && rule.intervalDays <= 3660, 'Intervalo inválido'); return addDays(rule.anchorDate, occurrence * rule.intervalDays); }
  const anchor = utc(rule.anchorDate), value = utc(rule.anchorDate); value.setUTCDate(1); value.setUTCMonth(value.getUTCMonth() + occurrence);
  const month = value.getUTCMonth(); value.setUTCMonth(month + 1, 0); const last = value.getUTCDate(); value.setUTCDate(Math.min(anchor.getUTCDate(), last));
  const output = value.toISOString().slice(0, 10); date(output); return output;
}
export function recurrenceThrough(rule: Recurrence, through: string, maximum = 2400): { index: number; dueOn: string }[] {
  date(through); const rows: { index: number; dueOn: string }[] = [];
  for (let index = 0; index < maximum; index++) { const dueOn = recurrenceDate(rule, index); if (index > 0 && dueOn > through) return rows; rows.push({ index, dueOn }); if (rule.frequency === 'once') return rows; }
  throw new Error('La recurrencia contiene demasiados períodos; ajusta su fecha inicial');
}
