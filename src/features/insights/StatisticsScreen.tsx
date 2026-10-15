import { ThemeText as Text, ThemeView as View, useAppearance, maskMoney } from '@/components/appearance';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppButton, Badge, Card, Chip, EmptyState, Field, FormSheet, Loading, Metric, Notice, Screen, SectionHeading, palette, ui } from '../../components/ui';
import { displayDate, displayMoney, localToday } from '../../components/format';
import { calendarRange } from '../../financial-engine/financial-calendar';
import { parseAmountMinor, formatAmountMinor } from '../../financial-engine/money';
import type { BalancePoint, StatisticsFilter } from '../../financial-engine/statistics';
import { finance, insights } from '../../services/finance/runtime';
import type { InsightsSnapshot } from '../../services/finance/insights-application';
const errorText = (value: unknown) => value instanceof Error ? value.message : 'No pudimos cargar las estadísticas';
function TinyChart({ points, field, currency, label }: {
    points: BalancePoint[];
    field: 'availableMinor' | 'netWorthMinor' | 'cardDebtMinor';
    currency: string;
    label: string;
}) {
    const { preferences } = useAppearance();
    const selected = points.length <= 12 ? points : Array.from({ length: 12 }, (_, index) => points[Math.round(index * (points.length - 1) / 11)]);
    const lower = Math.min(0, ...selected.map(row => row[field])), upper = Math.max(0, ...selected.map(row => row[field]));
    const scale = Math.max(1, upper - lower), baseline = -lower / scale * 85;
    return <Card><SectionHeading title={label}/><View style={{ height: 116, flexDirection: 'row', gap: 5, alignItems: 'flex-end' }}>{selected.map(point => <View key={point.date} accessibilityLabel={`${displayDate(point.date)}: ${maskMoney(displayMoney(point[field], currency), preferences.hideAmounts)}`} style={{ flex: 1, height: 116, justifyContent: 'flex-end', gap: 5 }}><View style={{ height: 85, position: 'relative' }}><View style={{ position: 'absolute', bottom: baseline, left: 0, right: 0, height: 1, backgroundColor: palette.border }}/><View style={{ position: 'absolute', left: 0, right: 0, bottom: point[field] < 0 ? baseline - Math.abs(point[field]) / scale * 85 : baseline, height: point[field] === 0 ? 0 : Math.max(1, Math.abs(point[field]) / scale * 85), borderRadius: 5, backgroundColor: point[field] < 0 ? palette.danger : palette.primary, opacity: .65 + .3 * (selected.indexOf(point) / Math.max(1, selected.length - 1)) }}/></View><Text style={{ fontSize: 9, textAlign: 'center', color: palette.muted }}>{point.date.slice(8)}</Text></View>)}</View><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={ui.muted}>{points[0] && displayDate(points[0].date)}</Text><Text style={ui.muted}>{points.at(-1) && displayDate(points.at(-1)!.date)}</Text></View>{points.at(-1) && <Text style={ui.heading}>{displayMoney(points.at(-1)![field], currency)}</Text>}</Card>;
}
function Bars({ rows, currency }: {
    rows: {
        id: string;
        name: string;
        amountMinor: number;
    }[];
    currency: string;
}) {
    const max = Math.max(1, ...rows.map(row => Math.abs(row.amountMinor)));
    return <View style={{ gap: 16 }}>{rows.map(row => <View key={row.id} style={{ gap: 7 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}><Text style={[ui.text, { flex: 1 }]}>{row.name}</Text><Text style={ui.text}>{displayMoney(row.amountMinor, currency)}</Text></View><View style={{ height: 7, borderRadius: 7, backgroundColor: palette.soft, overflow: 'hidden' }}><View style={{ height: 7, width: `${Math.abs(row.amountMinor) / max * 100}%`, backgroundColor: row.amountMinor < 0 ? palette.danger : palette.primary, borderRadius: 7 }}/></View></View>)}</View>;
}
export default function StatisticsScreen() {
    const range = calendarRange(localToday(), 'month');
    const [profileId, setProfileId] = useState(''), [filter, setFilter] = useState<StatisticsFilter>({ ...range, currency: 'USD' }), [draft, setDraft] = useState<StatisticsFilter>(filter), [data, setData] = useState<InsightsSnapshot>(), [loading, setLoading] = useState(true), [message, setMessage] = useState(''), [form, setForm] = useState<'filters' | 'threshold'>(), [threshold, setThreshold] = useState('5.00'), [busy, setBusy] = useState(false), [smallView, setSmallView] = useState(false);
    const sequence = useRef(0);
    const refresh = useCallback(async () => {
        const request = ++sequence.current;
        setLoading(true); setData(undefined);
        try {
            const profile = await finance.initialProfile();
            const result = await insights.snapshot(profile.id, filter);
            if (request !== sequence.current) return;
            setProfileId(profile.id); setData(result);
            setThreshold(formatAmountMinor(result.smallThresholdMinor, filter.currency).slice(4));
            setMessage('');
        } catch (error) {
            if (request === sequence.current) setMessage(errorText(error));
        } finally {
            if (request === sequence.current) setLoading(false);
        }
    }, [filter]);
    useFocusEffect(useCallback(() => { void refresh(); return () => { ++sequence.current; }; }, [refresh]));
    async function saveThreshold() { if (busy)
        return; setBusy(true); try {
        await insights.saveSettings(profileId, { currency: filter.currency, smallThresholdMinor: parseAmountMinor(threshold) });
        setForm(undefined);
        await refresh();
    }
    catch (error) {
        setMessage(errorText(error));
    }
    finally {
        setBusy(false);
    } }
    function applyFilters() { setFilter({ ...draft }); setForm(undefined); }
    const totalEnd = data?.balances.at(-1), money = (value: number) => displayMoney(value, filter.currency);
    const roots = data?.categories.filter(row => row.parentId === null && row.rolledUpMinor !== 0).map(row => ({ id: row.categoryId, name: row.name, amountMinor: row.rolledUpMinor })) ?? [];
    const direct = data?.categories.filter(row => row.directMinor !== 0).map(row => ({ id: row.categoryId, name: row.parentId ? `↳ ${row.name}` : row.name, amountMinor: row.directMinor })) ?? [];
    return <><Screen title="Estadísticas" subtitle="Datos calculados a partir de tus movimientos, sin duplicar gastos." action={<AppButton title="Filtros" variant="secondary" onPress={() => { setDraft({ ...filter }); setForm('filters'); }}/>}>
  {!form && <Notice message={message} tone="error"/>}<View style={ui.row}><Badge label={filter.currency}/><Text style={ui.muted}>{displayDate(filter.start)} — {displayDate(filter.end)}</Text>{filter.accountId && <Badge label="Cuenta filtrada"/>}{filter.cardId && <Badge label="Tarjeta filtrada"/>}{filter.categoryId && <Badge label="Categoría filtrada"/>}</View>
  {loading && !data ? <Loading /> : data ? <><Card><View style={ui.row}><Metric label="Ingresos" value={money(data.incomeMinor)} tone="green"/><Metric label="Gastos netos" value={money(data.expenseMinor)}/></View><View style={ui.row}><Metric label="Excedente del período" value={money(data.operatingSurplusMinor)} tone={data.operatingSurplusMinor < 0 ? 'red' : 'green'} hint="Ingresos menos gastos; no representa aportes a metas."/><Metric label="Flujo de efectivo" value={money(data.cashFlowMinor)} hint="Cambio neto por movimientos en cuentas; excluye apertura y ajustes."/></View></Card>
   <Card><SectionHeading title="Frente al período anterior" subtitle={`${displayDate(data.prior.start)} — ${displayDate(data.prior.end)}`}/><View style={ui.row}><Metric label="Ingresos anteriores" value={money(data.prior.incomeMinor)}/><Metric label="Gastos anteriores" value={money(data.prior.expenseMinor)}/></View><Text style={ui.text}>Variación de gastos: {money(data.expenseMinor - data.prior.expenseMinor)}{data.prior.expenseMinor > 0 ? ` (${((data.expenseMinor - data.prior.expenseMinor) / data.prior.expenseMinor * 100).toFixed(1)}%)` : ''}</Text></Card>
   {totalEnd && <Card><SectionHeading title="Situación al final del período" subtitle="Estas cifras abarcan todas las cuentas en la moneda elegida."/><View style={ui.row}><Metric label="TC pendiente" value={money(totalEnd.cardDebtMinor)}/><Metric label="Yo debo" value={money(totalEnd.payableMinor)}/><Metric label="Me deben" value={money(totalEnd.receivableMinor)}/></View></Card>}
   {roots.length ? <Card><SectionHeading title="Gastos por categoría" subtitle="Las categorías principales incluyen sus subcategorías una sola vez."/><Bars rows={roots} currency={filter.currency}/>{direct.some(row => data.categories.find(value => value.categoryId === row.id)?.parentId) && <><View style={ui.divider}/><Text style={ui.muted}>Clasificación directa</Text><Bars rows={direct} currency={filter.currency}/></>}</Card> : <EmptyState title="Sin gastos en este período" description="Registra un gasto o cambia los filtros para consultar tu actividad."/>}
   {!!data.methods.length && <Card><SectionHeading title="Métodos de pago"/><Bars rows={data.methods.map(row => ({ id: row.method.id, name: row.method.name, amountMinor: row.amountMinor }))} currency={filter.currency}/></Card>}
   <SectionHeading title="Evolución de tus saldos" subtitle="Incluye saldos iniciales y todos los movimientos anteriores. Los filtros de cuenta/categoría no recortan el patrimonio total."/>
   <TinyChart points={data.balances} field="availableMinor" label="Disponible real" currency={filter.currency}/><TinyChart points={data.balances} field="netWorthMinor" label="Patrimonio incluyendo cuentas por cobrar" currency={filter.currency}/><TinyChart points={data.balances} field="cardDebtMinor" label="Deuda de tarjetas" currency={filter.currency}/>
   {data.budgets.length > 0 && <><SectionHeading title="Presupuesto y gasto real"/>{data.budgets.filter(row => row.budget.currency === filter.currency).map(row => <Card key={row.period.id}><Text style={ui.heading}>{row.budget.name}</Text><Text style={ui.muted}>{displayDate(row.period.startsOn)} — {displayDate(row.period.endsOn)}</Text><View style={ui.row}><Metric label="Asignado" value={money(row.assignedMinor)}/><Metric label="Gastado" value={money(row.spentMinor)}/></View><Badge label={row.exceeded ? 'Excedido' : `${row.percentUsed.toFixed(0)}% usado`} tone={row.exceeded ? 'red' : 'green'}/></Card>)}</>}
   {!!data.goalContributions.length && <Card><SectionHeading title="Aportes a metas" subtitle="Los aportes reservan dinero; no son gastos."/><Bars rows={data.goalContributions.filter(row => row.currency === filter.currency && row.amountMinor > 0).map(row => ({ id: row.goalId, name: row.name, amountMinor: row.amountMinor }))} currency={filter.currency}/></Card>}
   <Card><SectionHeading title="Gastos hormiga" subtitle={`Compras originales menores de ${money(data.smallThresholdMinor)}; sus reversos compensan la misma clasificación.`} action={<AppButton title="Configurar" variant="ghost" onPress={() => setForm('threshold')}/>}/><View style={ui.row}><Metric label="Gasto pequeño neto" value={money(data.smallExpenseMinor)}/><Metric label="Movimientos" value={String(data.smallExpenses.length)}/></View><AppButton title={smallView ? 'Ocultar detalle' : 'Ver gastos pequeños'} variant="secondary" onPress={() => setSmallView(!smallView)}/>{smallView && (data.smallExpenses.length === 0 ? <Text style={ui.muted}>Sin gastos pequeños con estos filtros.</Text> : data.smallExpenses.map(row => <View key={row.transaction.id} style={{ gap: 4, paddingVertical: 8, borderTopWidth: 1, borderTopColor: palette.border }}><View style={ui.row}><Text style={[ui.text, { flex: 1 }]}>{row.transaction.description || 'Gasto'}</Text><Text style={ui.text}>{money(row.amountMinor)}</Text></View><Text style={ui.muted}>{displayDate(row.transaction.effectiveDate)} · {row.method.name}{row.transaction.type === 'REVERSAL' ? ' · Reverso' : ''}</Text></View>))}</Card>
  </> : <EmptyState title="Sin información disponible" description="Vuelve a intentar cargar tus estadísticas." action={<AppButton title="Actualizar" onPress={() => { void refresh(); }}/>}/>} 
 </Screen><FormSheet visible={!!form} title={form === 'filters' ? 'Filtrar estadísticas' : 'Qué es un gasto pequeño'} onClose={() => { if (!busy)
        setForm(undefined); }} busy={busy}><Notice message={message} tone="error"/>
 {form === 'filters' && <><View style={ui.row}>{['USD', 'EUR'].map(value => <Chip key={value} label={value} selected={draft.currency === value} onPress={() => setDraft({ ...draft, currency: value, accountId: undefined, cardId: undefined })}/>)}</View><View style={ui.row}><AppButton title="Este mes" variant="secondary" onPress={() => setDraft({ ...draft, ...calendarRange(localToday(), 'month') })}/><AppButton title="Esta semana" variant="secondary" onPress={() => setDraft({ ...draft, ...calendarRange(localToday(), 'week') })}/></View><Field label="Desde" value={draft.start} onChange={value => setDraft({ ...draft, start: value })}/><Field label="Hasta" value={draft.end} onChange={value => setDraft({ ...draft, end: value })}/><Text style={ui.muted}>Hasta un año por consulta.</Text><Text style={ui.heading}>Cuenta</Text><View style={ui.row}><Chip label="Todas" selected={!draft.accountId} onPress={() => setDraft({ ...draft, accountId: undefined })}/>{data?.accounts.filter(row => row.currency === draft.currency).map(row => <Chip key={row.id} label={row.name} selected={draft.accountId === row.id} onPress={() => setDraft({ ...draft, accountId: row.id, cardId: undefined })}/>)}</View><Text style={ui.heading}>Tarjeta</Text><View style={ui.row}><Chip label="Todas" selected={!draft.cardId} onPress={() => setDraft({ ...draft, cardId: undefined })}/>{data?.cards.filter(row => row.currency === draft.currency).map(row => <Chip key={row.id} label={row.name} selected={draft.cardId === row.id} onPress={() => setDraft({ ...draft, cardId: row.id, accountId: undefined })}/>)}</View><Text style={ui.heading}>Categoría</Text><View style={ui.row}><Chip label="Todas" selected={!draft.categoryId} onPress={() => setDraft({ ...draft, categoryId: undefined })}/>{data?.categoryOptions.map(row => <Chip key={row.id} label={row.name} selected={draft.categoryId === row.id} onPress={() => setDraft({ ...draft, categoryId: row.id })}/>)}</View><AppButton title="Aplicar filtros" onPress={applyFilters}/></>}
 {form === 'threshold' && <><Field label={`Monto máximo exclusivo · ${filter.currency}`} value={threshold} onChange={setThreshold} numeric placeholder="5.00"/><Notice message="Una compra exactamente igual al umbral no se considera pequeña. Este cambio solo modifica la vista, sin crear gastos."/><AppButton title={busy ? 'Guardando…' : 'Guardar umbral'} disabled={busy} onPress={() => { void saveThreshold(); }}/></>}
 </FormSheet></>;
}
