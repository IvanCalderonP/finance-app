import { ThemePressable as Pressable, ThemeText as Text, ThemeView as View } from '@/components/appearance';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { AppButton, Badge, Card, Chip, EmptyState, Field, FormSheet, Loading, Notice, Screen, SectionHeading, palette, ui } from '../../components/ui';
import { displayDate, displayMoney, localToday } from '../../components/format';
import { calendarDays, shiftCalendarPeriod } from '../../financial-engine/financial-calendar';
import type { CalendarView, FinancialCalendarEvent } from '../../financial-engine/financial-calendar';
import { parseAmountMinor, formatAmountMinor } from '../../financial-engine/money';
import { finance, insights } from '../../services/finance/runtime';
import type { CalendarSnapshot } from '../../services/finance/insights-application';
const failure = (error: unknown) => error instanceof Error ? error.message : 'No pudimos guardar el cambio';
const sourceLabel = { bill: 'Recibo', card_payment: 'Pago de tarjeta', card_cut: 'Corte', debt: 'Deuda', income: 'Ingreso previsto', goal: 'Meta', reserve: 'Liberación de reserva', manual: 'Evento' };
function tone(event: FinancialCalendarEvent) { return event.status === 'overdue' ? 'red' : event.status === 'paid' || event.status === 'completed' || event.status === 'income' ? 'green' : 'amber'; }
function statusLabel(event: FinancialCalendarEvent) { return { paid: 'Pagado', pending: 'Pendiente', overdue: 'Vencido', income: 'Por recibir', completed: 'Completado' }[event.status]; }
export default function CalendarScreen() {
    const router = useRouter();
    const params = useLocalSearchParams<{
        eventId?: string;
    }>();
    const [profileId, setProfileId] = useState(''), [selected, setSelected] = useState(localToday()), [view, setView] = useState<CalendarView>('month'), [data, setData] = useState<CalendarSnapshot>(), [fetching, setFetching] = useState(true), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
    const [form, setForm] = useState<'event' | 'reminder'>(), [focused, setFocused] = useState<FinancialCalendarEvent>(), [editingId, setEditingId] = useState<string>(), [title, setTitle] = useState(''), [eventDate, setEventDate] = useState(localToday()), [kind, setKind] = useState<'event' | 'income'>('event'), [currency, setCurrency] = useState('USD'), [amount, setAmount] = useState(''), [description, setDescription] = useState(''), [completed, setCompleted] = useState(false), [offsets, setOffsets] = useState<number[]>([0]), [reminderEnabled, setReminderEnabled] = useState(false);
    const lock = useRef(false), loadedParam = useRef(''), sequence = useRef(0);
    const refresh = useCallback(async () => {
        const request = ++sequence.current;
        setFetching(true);
        try {
            const profile = await finance.initialProfile();
            const snapshot = await insights.calendar(profile.id, { date: selected, view });
            if (request !== sequence.current) return;
            setProfileId(profile.id); setData(snapshot);
            if (params.eventId && loadedParam.current !== params.eventId) {
                const event = await insights.event(profile.id, params.eventId);
                if (request !== sequence.current) return;
                if (event) {
                    loadedParam.current = params.eventId;
                    setEditingId(event.id); setTitle(event.title); setEventDate(event.date);
                    setKind(event.kind); setCurrency(event.currency);
                    setAmount(event.amountMinor === null ? '' : formatAmountMinor(event.amountMinor, event.currency).slice(4));
                    setDescription(event.description); setCompleted(event.completed); setForm('event');
                }
            }
        } catch (error) {
            if (request === sequence.current) setMessage(failure(error));
        } finally {
            if (request === sequence.current) setFetching(false);
        }
    }, [selected, view, params.eventId]);
    useFocusEffect(useCallback(() => { void refresh(); return () => { ++sequence.current; }; }, [refresh]));
    function newEvent() { setEditingId(undefined); setTitle(''); setEventDate(selected); setKind('event'); setCurrency('USD'); setAmount(''); setDescription(''); setCompleted(false); setMessage(''); setForm('event'); }
    async function editEvent(event: FinancialCalendarEvent) { try {
        const row = await insights.event(profileId, event.sourceId);
        if (!row)
            return;
        setEditingId(row.id);
        setTitle(row.title);
        setEventDate(row.date);
        setKind(row.kind);
        setCurrency(row.currency);
        setAmount(row.amountMinor === null ? '' : formatAmountMinor(row.amountMinor, row.currency).slice(4));
        setDescription(row.description);
        setCompleted(row.completed);
        setMessage('');
        setForm('event');
    }
    catch (error) {
        setMessage(failure(error));
    } }
    function beginReminder(event: FinancialCalendarEvent) { setFocused(event); const preference = data?.reminders.find(row => row.eventKey === event.key) ?? data?.reminders.find(row => row.eventKey === event.reminderGroupKey); setOffsets(preference?.offsets ?? [0]); setReminderEnabled(preference?.enabled ?? false); setMessage(''); setForm('reminder'); }
    async function save() {
        if (lock.current)
            return;
        lock.current = true;
        setBusy(true);
        setMessage('');
        try {
            if (form === 'event')
                await insights.saveEvent({ profileId, id: editingId, title, date: eventDate, kind, currency, amountMinor: amount.trim() ? parseAmountMinor(amount) : null, description, completed });
            if (form === 'reminder' && focused) {
                await insights.saveReminder(profileId, focused.reminderGroupKey ?? focused.key, offsets, reminderEnabled);
                const { syncLocalReminders } = await import('../../services/notifications/local-reminders');
                const result = await syncLocalReminders(profileId, { requestPermission: reminderEnabled });
                setMessage(result.message ?? 'Recordatorio guardado');
            }
            setForm(undefined);
            await refresh();
        }
        catch (error) {
            setMessage(failure(error));
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    }
    async function complete(event: FinancialCalendarEvent) { if (lock.current)
        return; lock.current = true; setBusy(true); try {
        await insights.completeEvent(profileId, event.sourceId, event.status !== 'completed');
        await refresh();
    }
    catch (error) {
        setMessage(failure(error));
    }
    finally {
        lock.current = false;
        setBusy(false);
    } }
    function openModule(event: FinancialCalendarEvent) { router.push(event.route as never); }
    const days = data ? calendarDays(data.start, data.end) : [];
    const monthOffset = data ? (new Date(`${data.start}T12:00:00Z`).getUTCDay() + 6) % 7 : 0;
    const dayEvents = (data?.events ?? []).filter(row => view === 'month' ? row.date === selected : true);
    return <><Screen title="Calendario" subtitle="Organiza fechas y registra cada pago desde su módulo." action={<AppButton title="+ Evento" disabled={!profileId || busy} onPress={newEvent}/>}>
  {!form && <Notice message={message}/>}<View style={ui.row}>{(['day', 'week', 'month'] as const).map(value => <Chip key={value} label={{ day: 'Día', week: 'Semana', month: 'Mes' }[value]} selected={view === value} onPress={() => setView(value)}/>)}</View>
  <Card><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><AppButton title="‹" variant="ghost" onPress={() => setSelected(shiftCalendarPeriod(selected, view, -1))}/><View style={{ flex: 1 }}><Text style={[ui.heading, { textAlign: 'center' }]}>{view === 'month' ? new Date(`${selected}T12:00:00`).toLocaleDateString('es-SV', { month: 'long', year: 'numeric' }) : view === 'week' && data ? `${displayDate(data.start)} — ${displayDate(data.end)}` : displayDate(selected)}</Text></View><AppButton title="›" variant="ghost" onPress={() => setSelected(shiftCalendarPeriod(selected, view, 1))}/></View><AppButton title="Volver a hoy" variant="ghost" onPress={() => setSelected(localToday())}/>
   {view === 'month' && data && <><View style={{ flexDirection: 'row' }}>{['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day, index) => <Text key={index} style={[ui.muted, { width: '14.28%', textAlign: 'center' }]}>{day}</Text>)}</View><View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{Array.from({ length: monthOffset }, (_, index) => <View key={`blank-${index}`} style={{ width: '14.28%', height: 58 }}/>)}{days.map(day => { const events = data.events.filter(row => row.date === day); return <Pressable key={day} accessibilityRole="button" accessibilityLabel={`${displayDate(day)}, ${events.length} eventos`} accessibilityState={{ selected: day === selected }} onPress={() => setSelected(day)} style={{ width: '14.28%', height: 58, padding: 3 }}><View style={{ flex: 1, borderRadius: 12, backgroundColor: day === selected ? palette.primary : day === localToday() ? palette.soft : 'transparent', alignItems: 'center', justifyContent: 'center', gap: 4 }}><Text style={{ color: day === selected ? palette.white : palette.ink, fontWeight: day === localToday() ? '800' : '500' }}>{Number(day.slice(8))}</Text><View style={{ flexDirection: 'row', gap: 3 }}>{events.slice(0, 3).map(row => <View key={row.key} style={{ height: 4, width: 4, borderRadius: 4, backgroundColor: day === selected ? palette.white : row.status === 'overdue' ? palette.danger : row.status === 'income' ? palette.primary : palette.amber }}/>)}</View></View></Pressable>; })}</View></>}
  </Card>
  {fetching && !data ? <Loading /> : <><SectionHeading title={view === 'month' ? displayDate(selected) : 'Agenda'} subtitle={`${dayEvents.length} ${dayEvents.length === 1 ? 'evento' : 'eventos'}`}/>{dayEvents.length === 0 ? <EmptyState title="Sin eventos en este período" description="Los recibos, tarjetas, deudas y metas aparecen con sus fechas. También puedes añadir un ingreso previsto o un evento." action={<AppButton title="Añadir evento" onPress={newEvent}/>}/> : dayEvents.map(event => <Card key={event.key}><View style={ui.row}><View style={{ flex: 1 }}><Text style={ui.heading}>{event.title}</Text><Text style={ui.muted}>{displayDate(event.date)} · {sourceLabel[event.source]}</Text></View><Badge label={statusLabel(event)} tone={tone(event)}/></View>{event.amountMinor !== null && <Text style={[ui.heading, { color: event.status === 'income' ? palette.primary : palette.ink }]}>{displayMoney(event.amountMinor, event.currency)}</Text>}{event.description && <Text style={ui.muted}>{event.description}</Text>}<View style={ui.row}>{event.editable && <AppButton title="Editar fecha y evento" variant="secondary" disabled={busy} onPress={() => { void editEvent(event); }}/>}{event.source === 'manual' ? <AppButton title={event.status === 'completed' ? 'Reabrir evento' : 'Completar evento'} variant="ghost" disabled={busy} onPress={() => { void complete(event); }}/> : <AppButton title={event.source === 'income' ? (event.status === 'completed' ? 'Ver ingreso recibido' : 'Registrar ingreso') : event.source === 'bill' ? 'Ver recibo' : event.source === 'goal' ? 'Ver meta' : event.source === 'reserve' ? 'Ver reserva' : 'Abrir módulo'} variant="secondary" onPress={() => openModule(event)}/>}<AppButton title={data?.reminders.some(row => (row.eventKey === event.key || row.eventKey === event.reminderGroupKey) && row.enabled) ? 'Recordatorio activo' : 'Recordarme'} variant="ghost" disabled={busy} onPress={() => beginReminder(event)}/></View></Card>)}</>}
  <Text style={ui.muted}>Las fechas y los recordatorios no crean gastos ni ingresos. Un evento manual completado solo cambia su estado.</Text>
 </Screen><FormSheet visible={!!form} title={form === 'reminder' ? 'Recordatorio' : editingId ? 'Editar evento' : 'Nuevo evento'} onClose={() => { if (!busy)
        setForm(undefined); }} busy={busy}><Notice message={message}/>
 {form === 'event' && <><Field label="Nombre" value={title} onChange={setTitle} placeholder="Ej. Salario"/><View style={ui.row}><Chip label="Evento" selected={kind === 'event'} onPress={() => setKind('event')}/><Chip label="Ingreso previsto" selected={kind === 'income'} onPress={() => setKind('income')}/></View><Field label="Fecha" value={eventDate} onChange={setEventDate} placeholder="AAAA-MM-DD"/><View style={ui.row}>{['USD', 'EUR'].map(value => <Chip key={value} label={value} selected={currency === value} onPress={() => setCurrency(value)}/>)}</View><Field label="Monto previsto · opcional" value={amount} onChange={setAmount} numeric placeholder="0.00"/><Field label="Nota · opcional" value={description} onChange={setDescription}/><Notice message={kind === 'income' ? 'Un ingreso previsto todavía no aumenta el saldo. Usa Registrar ingreso cuando lo recibas.' : 'Este evento organiza tu agenda sin crear un movimiento.'}/></>}
 {form === 'reminder' && <><Text style={ui.heading}>{focused?.title}</Text><Text style={ui.muted}>{focused && displayDate(focused.date)}</Text>{focused?.reminderGroupKey && <Notice message={focused.source === 'bill' ? 'Este recordatorio se aplica también a los próximos recibos de la misma serie.' : 'Este recordatorio se aplica a los ciclos de esta tarjeta.'} />}<View style={ui.row}><Chip label="Desactivado" selected={!reminderEnabled} onPress={() => setReminderEnabled(false)}/><Chip label="Activado" selected={reminderEnabled} onPress={() => setReminderEnabled(true)}/></View><Text style={ui.text}>Anticipación</Text><View style={ui.row}>{[0, 1, 3, 7].map(value => <Chip key={value} label={value === 0 ? 'El mismo día' : `${value} días antes`} selected={offsets.includes(value)} onPress={() => setOffsets(offsets.includes(value) ? offsets.filter(row => row !== value) : [...offsets, value])}/>)}</View><Notice message="Las notificaciones locales funcionan sin internet. Al activar un recordatorio se solicita permiso si hace falta. Si cambia la fecha, se reprograma al abrir la app."/></>}
 <AppButton title={busy ? 'Guardando…' : 'Guardar'} disabled={busy} onPress={() => { void save(); }}/></FormSheet></>;
}
