import { ThemePressable as Pressable, ThemeText as Text, ThemeView as View } from '@/components/appearance';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Switch } from 'react-native';
import { AppButton, Badge, Card, Chip, EmptyState, Field, FormSheet, Loading, Metric, Notice, Screen, SectionHeading, palette, ui } from '@/components/ui';
import { displayDate, displayMoney, localToday } from '@/components/format';
import type { DebtEvent, DebtOrigin, DebtSummary, Person } from '../../financial-engine/debts';
import type { FinanceSnapshot } from '../../services/finance/application';
import { debts, finance, newOperationKey } from '../../services/finance/runtime';
import { parseAmountMinor } from '../../financial-engine/money';

type Mode = 'PERSON' | 'CREATE' | 'SETTLE' | 'REVERSE';
type Direction = 'receivable' | 'payable';
const originLabels: Record<DebtOrigin, string> = {
  loan_given: 'Préstamo entregado', existing_payable: 'Deuda existente',
  loan_received: 'Préstamo recibido', financed_expense: 'Compra financiada',
};
const originHints: Record<DebtOrigin, string> = {
  loan_given: 'El dinero sale de tu cuenta y queda pendiente de cobro.',
  existing_payable: 'Registra una obligación que ya tenías, sin mover dinero de tus cuentas.',
  loan_received: 'El dinero entra en tu cuenta y queda pendiente de pago.',
  financed_expense: 'Registra el gasto y la deuda. Pagarla después liquida el principal.',
};
function statusTone(status: DebtSummary['status']) {
  return status === 'vencida' ? 'red' : status === 'pagada' ? 'green' : status === 'pendiente' ? 'amber' : 'neutral';
}
function eventLabel(event: DebtEvent, row: DebtSummary) {
  if (event.kind === 'ORIGIN') return originLabels[row.debt.originKind];
  if (event.kind === 'PAYMENT') return row.debt.direction === 'receivable' ? 'Cobro recibido' : 'Pago realizado';
  return 'Reverso del movimiento';
}
function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase(); }

export default function DebtsScreen() {
  const params=useLocalSearchParams<{debtId?:string}>();const incoming=useRef('');
  const [profileId, setProfileId] = useState('');
  const [snapshot, setSnapshot] = useState<FinanceSnapshot>();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Direction>('receivable');
  const [selected, setSelected] = useState('');
  const [mode, setMode] = useState<Mode>();
  const [afterPerson, setAfterPerson] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'error' | 'success' | 'info'>('info');
  const [personId, setPersonId] = useState('');
  const [name, setName] = useState('');
  const [personNote, setPersonNote] = useState('');
  const [originKind, setOriginKind] = useState<DebtOrigin>('loan_given');
  const [concept, setConcept] = useState('');
  const [notes, setNotes] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [dueOn, setDueOn] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(localToday);
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [full, setFull] = useState(false);
  const [protectedConfirmed, setProtectedConfirmed] = useState(false);
  const [originalId, setOriginalId] = useState('');
  const lock = useRef(false);
  const operationKey = useRef<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    const profile = await finance.initialProfile();
    setProfileId(profile.id);
    const [data, persons] = await Promise.all([finance.snapshot(profile.id), debts.people(profile.id)]);
    setSnapshot(data); setPeople(persons);
    if(params.debtId&&incoming.current!==params.debtId){incoming.current=params.debtId;const row=data.debts.find(value=>value.debt.id===params.debtId);if(row){setSelected(row.debt.id);setTab(row.debt.direction);}}
  }, [params.debtId]);
  useFocusEffect(useCallback(() => {
    void refresh().catch(error => {
      setMessage(error instanceof Error ? error.message : 'No se pudo abrir tu lista de deudas.');
      setMessageTone('error');
    }).finally(() => setLoading(false));
  }, [refresh]));
  const rows = snapshot?.debts.filter(row => row.debt.direction === tab) ?? [];
  const detail = snapshot?.debts.find(row => row.debt.id === selected);
  const activeCount = rows.filter(row => row.pendingMinor > 0).length;
  const reversed = new Set(snapshot?.transactions.filter(row => row.type === 'REVERSAL').map(row => row.reversalOf));
  const currencies = [...new Set(['USD', 'EUR', ...(snapshot?.accounts.map(row => row.account.currency) ?? [])])];
  const currentCurrency = mode === 'CREATE' ? currency : detail?.debt.currency ?? currency;
  const eligibleAccounts = snapshot?.accounts.filter(row => row.account.active && row.account.currency === currentCurrency) ?? [];
  const chosenAccount = eligibleAccounts.find(row => row.account.id === accountId);
  const needsAccount = mode === 'SETTLE' || mode === 'CREATE' && (originKind === 'loan_given' || originKind === 'loan_received');
  const spendsFunds = mode === 'CREATE' && originKind === 'loan_given' || mode === 'SETTLE' && detail?.debt.direction === 'payable';
  const needsProtectedConfirmation = needsAccount && spendsFunds && chosenAccount?.account.availabilityPolicy === 'protected';
  const money = (value: number, row: DebtSummary) => displayMoney(value, row.debt.currency);

  function resetOperation() {
    operationKey.current = undefined; setMessage(''); setAmount(''); setEffectiveDate(localToday());
    setDescription(''); setFull(false); setProtectedConfirmed(false); setOriginalId('');
  }
  function beginCreate() {
    if (lock.current) return;
    resetOperation(); setConcept(''); setNotes(''); setDueOn(''); setSelected('');
    const nextCurrency = snapshot?.accounts.find(row => row.account.active)?.account.currency ?? 'USD';
    setCurrency(nextCurrency); setOriginKind(tab === 'receivable' ? 'loan_given' : 'existing_payable');
    setAccountId(snapshot?.accounts.find(row => row.account.active && row.account.currency === nextCurrency)?.account.id ?? '');
    setCategoryId(snapshot?.categories.find(row => row.kind === 'EXPENSE')?.id ?? '');
    setPersonId(people[0]?.id ?? '');
    if (!people.length) { setName(''); setPersonNote(''); setAfterPerson(true); setMode('PERSON'); }
    else { setAfterPerson(false); setMode('CREATE'); }
  }
  function beginPerson(continueCreate = false) {
    if (lock.current) return;
    operationKey.current = undefined; setMessage(''); setName(''); setPersonNote('');
    setAfterPerson(continueCreate); setMode('PERSON');
  }
  function beginSettlement() {
    if (lock.current || !detail) return;
    resetOperation(); setAccountId(snapshot?.accounts.find(row => row.account.active && row.account.currency === detail.debt.currency)?.account.id ?? '');
    setMode('SETTLE');
  }
  function beginReverse(transactionId: string) {
    if (lock.current) return;
    resetOperation(); setOriginalId(transactionId); setMode('REVERSE');
  }
  function closeForm() {
    if (lock.current) return;
    operationKey.current = undefined; setMessage('');
    if (mode === 'PERSON' && afterPerson && people.length) { setAfterPerson(false); setMode('CREATE'); }
    else { setAfterPerson(false); setMode(undefined); }
  }
  function changeCurrency(value: string) {
    setCurrency(value); setProtectedConfirmed(false);
    setAccountId(snapshot?.accounts.find(row => row.account.active && row.account.currency === value)?.account.id ?? '');
  }
  async function reload() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    try { await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo actualizar.'); setMessageTone('error'); }
    finally { lock.current = false; setBusy(false); setLoading(false); }
  }
  async function save() {
    if (lock.current || !mode) return;
    lock.current = true; setBusy(true); setMessage('');
    let saved = false;
    try {
      operationKey.current ??= await newOperationKey();
      if (mode === 'PERSON') {
        const person = await debts.createPerson({ profileId, idempotencyKey: operationKey.current, name, note: personNote });
        saved = true; setPersonId(person.id);
        setPeople(current => current.some(row => row.id === person.id) ? current : [...current, person]);
        setMode(afterPerson ? 'CREATE' : undefined); setAfterPerson(false);
      } else if (mode === 'CREATE') {
        const debt = await debts.create({ profileId, idempotencyKey: operationKey.current, effectiveDate, description,
          personId, originKind, currency, initialMinor: parseAmountMinor(amount), concept, dueOn: dueOn.trim() || null, notes,
          accountId: needsAccount ? accountId || undefined : undefined,
          categoryId: originKind === 'financed_expense' ? categoryId || undefined : undefined,
          allowProtected: protectedConfirmed });
        saved = true; setSelected(debt.id); setTab(debt.direction); setMode(undefined);
      } else {
        if (!detail) throw new Error('Selecciona una deuda.');
        if (mode === 'SETTLE') await debts.settle({ profileId, idempotencyKey: operationKey.current, effectiveDate,
          description, debtId: detail.debt.id, accountId, full, amountMinor: full ? undefined : parseAmountMinor(amount),
          allowProtected: protectedConfirmed });
        else await debts.reverse({ profileId, idempotencyKey: operationKey.current, effectiveDate, description,
          debtId: detail.debt.id, originalId });
        saved = true; setMode(undefined);
      }
      operationKey.current = undefined;
      await refresh(); setMessage('Guardado correctamente.'); setMessageTone('success');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'No se pudo guardar.';
      setMessage(saved ? `El cambio se guardó. Falta actualizar la pantalla: ${reason}` : reason);
      setMessageTone('error');
    } finally { lock.current = false; setBusy(false); }
  }
  const formTitle = mode === 'PERSON' ? 'Nueva persona' : mode === 'CREATE' ? tab === 'receivable' ? 'Registrar préstamo' : 'Registrar deuda'
    : mode === 'SETTLE' ? detail?.debt.direction === 'receivable' ? 'Registrar cobro' : 'Registrar pago' : 'Revertir movimiento';
  const saveDisabled = busy || !profileId || mode === 'PERSON' && !name.trim()
    || mode === 'CREATE' && (!personId || !concept.trim() || !amount.trim())
    || mode === 'SETTLE' && !full && !amount.trim() || mode === 'REVERSE' && !description.trim()
    || needsAccount && !chosenAccount || !!needsProtectedConfirmation && !protectedConfirmed
    || mode === 'CREATE' && originKind === 'financed_expense' && !categoryId;

  return <Screen title="Deudas" subtitle="Lo que te deben y lo que debes, en un solo lugar."
    action={<AppButton title="Actualizar" variant="ghost" disabled={busy} onPress={() => { void reload(); }} />}>
    {message && !mode && <Notice message={message} tone={messageTone} />}
    {loading ? <Loading /> : !snapshot ? <EmptyState title="No pudimos cargar tus deudas" description="Intenta actualizar para volver a abrir tu información local."
      action={<AppButton title="Reintentar" disabled={busy} onPress={() => { void reload(); }} />} /> : detail ? <>
      <AppButton title="← Volver a la lista" variant="ghost" style={{ alignSelf: 'flex-start' }} disabled={busy} onPress={() => { setSelected(''); setMessage(''); }} />
      <Card>
        <View style={styles.between}><View style={styles.personHeading}><View style={styles.avatar}><Text style={styles.avatarText}>{initials(detail.person.name)}</Text></View>
          <View style={{ flex: 1 }}><Text style={ui.heading}>{detail.person.name}</Text><Text style={ui.muted}>{detail.debt.concept}</Text></View></View>
          <Badge label={detail.status === 'pagada' && detail.debt.direction === 'receivable' ? 'Cobrada' : detail.status[0].toUpperCase() + detail.status.slice(1)} tone={statusTone(detail.status)} />
        </View>
        <View style={ui.row}><Metric label={detail.debt.direction === 'receivable' ? 'Pendiente de cobro' : 'Pendiente de pago'} value={money(detail.pendingMinor, detail)}
          tone={detail.debt.direction === 'receivable' ? 'green' : 'red'} /><Metric label={detail.debt.direction === 'receivable' ? 'Ya cobraste' : 'Ya pagaste'} value={money(detail.settledMinor, detail)} /></View>
        <View style={ui.divider} />
        <View style={ui.row}><View style={styles.detailItem}><Text style={ui.muted}>Monto inicial</Text><Text style={ui.text}>{money(detail.debt.initialMinor, detail)}</Text></View>
          <View style={styles.detailItem}><Text style={ui.muted}>Vencimiento</Text><Text style={ui.text}>{detail.debt.dueOn ? displayDate(detail.debt.dueOn) : 'Sin fecha límite'}</Text></View></View>
        <Text style={ui.muted}>{originLabels[detail.debt.originKind]} · {displayDate(detail.debt.openedOn)} · {detail.debt.currency}</Text>
        {!!detail.debt.notes && <Text style={ui.text}>{detail.debt.notes}</Text>}
        <AppButton title={detail.debt.direction === 'receivable' ? 'Registrar cobro' : 'Registrar pago'} icon="+" disabled={busy || detail.pendingMinor === 0} onPress={beginSettlement} />
      </Card>
      {detail.debt.direction === 'receivable' && <Notice message="Este pendiente cuenta en tu patrimonio total. Aumentará tu disponible cuando recibas el pago en una cuenta libre." />}
      <SectionHeading title="Historial" subtitle="Cada operación conserva su movimiento original." />
      <Card>{[...detail.history].reverse().map((event, index) => <View key={event.id} style={styles.historyEntry}>
        {index > 0 && <View style={ui.divider} />}
        <View style={styles.between}><View style={{ flex: 1, gap: 4 }}><Text style={styles.eventTitle}>{eventLabel(event, detail)}</Text>
          <Text style={ui.muted}>{displayDate(event.effectiveDate)}</Text></View>
          <Text style={[styles.eventAmount, { color: event.kind === 'PAYMENT' ? palette.primary : palette.ink }]}>{money(Math.abs(event.amountMinor), detail)}</Text>
        </View>
        {!!event.description && <Text style={ui.muted}>{event.description}</Text>}
        {event.kind !== 'REVERSAL' && (reversed.has(event.transactionId) ? <Badge label="Revertido" tone="neutral" />
          : <AppButton title="Revertir este movimiento" variant="ghost" disabled={busy} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} onPress={() => beginReverse(event.transactionId)} />)}
      </View>)}</Card>
    </> : <>
      <View style={ui.row}><Chip label="Me deben" selected={tab === 'receivable'} disabled={busy} onPress={() => { setTab('receivable'); setSelected(''); setMessage(''); }} />
        <Chip label="Yo debo" selected={tab === 'payable'} disabled={busy} onPress={() => { setTab('payable'); setSelected(''); setMessage(''); }} /></View>
      <Card>
        <Text style={ui.muted}>{tab === 'receivable' ? 'Pendiente de recuperar' : 'Pendiente de pagar'}</Text>
        {snapshot.totals.filter(row => rows.some(debt => debt.debt.currency === row.currency)).map(row => <Metric key={row.currency}
          label={row.currency} value={displayMoney(tab === 'receivable' ? row.receivableMinor : row.payableMinor, row.currency)} tone={tab === 'receivable' ? 'green' : 'red'} />)}
        {!rows.length && <Text style={styles.totalZero}>$0.00</Text>}
        <View style={styles.between}><Text style={ui.muted}>{activeCount} {activeCount === 1 ? 'deuda pendiente' : 'deudas pendientes'}</Text>
          <AppButton title={tab === 'receivable' ? 'Prestar dinero' : 'Nueva deuda'} icon="+" disabled={busy || !profileId} onPress={beginCreate} /></View>
      </Card>
      {tab === 'receivable' && <Notice message="El dinero que te deben no forma parte de tu disponible hasta que recibas el pago." />}
      <SectionHeading title={tab === 'receivable' ? 'Tus préstamos' : 'Tus compromisos'} subtitle={rows.length ? 'Abre una deuda para cobrar, pagar o revisar su historial.' : 'Empieza con una persona y el monto pendiente.'} />
      {!rows.length ? <EmptyState title={tab === 'receivable' ? 'Todo al día' : 'Sin deudas registradas'}
        description={tab === 'receivable' ? 'Cuando prestes dinero, registra quién lo recibe y lleva aquí tus cobros.' : 'Registra una deuda existente, un préstamo recibido o una compra financiada.'}
        action={<AppButton title={tab === 'receivable' ? 'Registrar préstamo' : 'Registrar deuda'} disabled={busy || !profileId} onPress={beginCreate} />} />
        : rows.map(row => <Pressable key={row.debt.id} accessibilityRole="button" accessibilityLabel={`Ver deuda de ${row.person.name}: ${row.debt.concept}`} disabled={busy}
          onPress={() => { setSelected(row.debt.id); setMessage(''); }} style={({ pressed }) => ({ opacity: busy ? .5 : pressed ? .8 : 1 })}>
          <Card><View style={styles.personHeading}><View style={styles.avatar}><Text style={styles.avatarText}>{initials(row.person.name)}</Text></View>
            <View style={{ flex: 1, gap: 4 }}><Text style={styles.eventTitle}>{row.person.name}</Text><Text style={ui.muted}>{row.debt.concept}</Text></View><Text style={styles.arrow}>›</Text></View>
            <View style={styles.between}><View style={{ gap: 4 }}><Text style={styles.debtAmount}>{money(row.pendingMinor, row)}</Text>
              <Text style={ui.muted}>{row.debt.dueOn ? `Vence ${displayDate(row.debt.dueOn)}` : 'Sin fecha límite'} · {row.debt.currency}</Text></View>
              <Badge label={row.status === 'pagada' && tab === 'receivable' ? 'Cobrada' : row.status[0].toUpperCase() + row.status.slice(1)} tone={statusTone(row.status)} /></View>
          </Card>
        </Pressable>)}
      <SectionHeading title="Personas" subtitle={`${people.length} ${people.length === 1 ? 'persona registrada' : 'personas registradas'}`}
        action={<AppButton title="Agregar" variant="secondary" icon="+" disabled={busy || !profileId} onPress={() => beginPerson()} />} />
      {people.length > 0 && <Card>{people.map((person, index) => <View key={person.id} style={{ gap: 10 }}>{index > 0 && <View style={ui.divider} />}
        <View style={styles.personHeading}><View style={[styles.avatar, { width: 36, height: 36, borderRadius: 12 }]}><Text style={styles.avatarText}>{initials(person.name)}</Text></View>
          <View style={{ flex: 1 }}><Text style={ui.text}>{person.name}</Text>{!!person.note && <Text style={ui.muted}>{person.note}</Text>}</View></View>
      </View>)}</Card>}
    </>}
    <Text style={styles.footnote}>Versión de prueba · Usa datos sintéticos. Intereses y comisiones se registran como gastos separados del principal.</Text>

    <FormSheet visible={!!mode} title={formTitle} busy={busy} onClose={closeForm}
      subtitle={mode === 'PERSON' && afterPerson ? 'Primero agrega la persona. Después registraremos el monto.' : undefined}>
      <View pointerEvents={busy ? 'none' : 'auto'} style={styles.form}>
        {message && <Notice message={message} tone={messageTone} />}
        {mode === 'PERSON' ? <>
          <Field label="Nombre de la persona" value={name} onChange={setName} placeholder="Ej. Ana Martínez" />
          <Field label="Nota opcional" value={personNote} onChange={setPersonNote} placeholder="Algo que quieras recordar" multiline />
        </> : <>
          {mode === 'CREATE' && <>
            <SectionHeading title="¿Con quién?" action={<AppButton title="Nueva persona" variant="ghost" disabled={busy} onPress={() => beginPerson(true)} />} />
            <View style={ui.row}>{people.map(person => <Chip key={person.id} label={person.name} selected={personId === person.id} disabled={busy} onPress={() => setPersonId(person.id)} />)}</View>
            {tab === 'payable' && <><Text style={styles.label}>Tipo de deuda</Text><View style={ui.row}>
              {(['existing_payable', 'loan_received', 'financed_expense'] as DebtOrigin[]).map(origin => <Chip key={origin} label={originLabels[origin]} selected={originKind === origin} disabled={busy}
                onPress={() => { setOriginKind(origin); setProtectedConfirmed(false); }} />)}
            </View></>}
            <Notice message={originHints[originKind]} />
            <Field label="Concepto" value={concept} onChange={setConcept} placeholder={tab === 'receivable' ? 'Ej. Préstamo para estudios' : 'Ej. Reparación del auto'} />
            <Text style={styles.label}>Moneda</Text><View style={ui.row}>{currencies.map(value => <Chip key={value} label={value} selected={currency === value} disabled={busy} onPress={() => changeCurrency(value)} />)}</View>
          </>}
          {mode === 'SETTLE' && detail && <>
            <Card style={{ backgroundColor: palette.soft }}><Text style={ui.text}>{detail.person.name} · {detail.debt.concept}</Text>
              <Metric label={detail.debt.direction === 'receivable' ? 'Pendiente de cobro' : 'Pendiente de pago'} value={money(detail.pendingMinor, detail)} />
            </Card>
            <View style={styles.between}><View style={{ flex: 1 }}><Text style={styles.label}>Liquidar todo el pendiente</Text><Text style={ui.muted}>Usa el saldo actual completo.</Text></View>
              <Switch value={full} onValueChange={setFull} disabled={busy} trackColor={{ false: palette.border, true: palette.primary }} thumbColor={palette.white} />
            </View>
          </>}
          {(mode === 'CREATE' || mode === 'SETTLE' && !full) && <Field label={`Monto de principal (${currentCurrency})`} value={amount} onChange={setAmount} placeholder="0.00" numeric
            hint={mode === 'SETTLE' ? 'Puedes registrar un abono parcial al principal.' : 'Indica el monto sin intereses ni comisiones.'} />}
          {needsAccount && <>
            <Text style={styles.label}>{spendsFunds ? 'Cuenta de origen' : 'Cuenta donde recibirás el dinero'}</Text>
            {eligibleAccounts.length ? <View style={styles.accountList}>{eligibleAccounts.map(row => <Pressable key={row.account.id} accessibilityRole="button"
              accessibilityState={{ selected: accountId === row.account.id, disabled: busy }} disabled={busy}
              onPress={() => { setAccountId(row.account.id); setProtectedConfirmed(false); }}
              style={[styles.accountChoice, accountId === row.account.id && styles.accountSelected]}>
              <View style={{ flex: 1, gap: 4 }}><Text style={styles.eventTitle}>{row.account.name}</Text>
                <Text style={ui.muted}>{displayMoney(row.balanceMinor, row.account.currency)} · {row.account.availabilityPolicy === 'protected' ? 'Fondos protegidos' : 'Disponible'}</Text></View>
              <Text style={{ color: accountId === row.account.id ? palette.primary : palette.muted }}>{accountId === row.account.id ? '●' : '○'}</Text>
            </Pressable>)}</View> : <Notice tone="error" message={`Necesitas una cuenta activa en ${currentCurrency}. Créala desde Cuentas y vuelve a este formulario.`} />}
            {needsProtectedConfirmation && <View style={styles.protectedBox}><View style={{ flex: 1 }}><Text style={styles.label}>Usar fondos protegidos</Text>
              <Text style={ui.muted}>Confirma que quieres sacar este dinero de tu cuenta protegida.</Text></View>
              <Switch value={protectedConfirmed} disabled={busy} onValueChange={setProtectedConfirmed} trackColor={{ false: palette.border, true: palette.primary }} thumbColor={palette.white} />
            </View>}
          </>}
          {mode === 'CREATE' && originKind === 'financed_expense' && <><Text style={styles.label}>Categoría del gasto</Text><View style={ui.row}>
            {snapshot?.categories.filter(category => category.kind === 'EXPENSE').map(category => <Chip key={category.id} label={category.name} selected={categoryId === category.id} disabled={busy} onPress={() => setCategoryId(category.id)} />)}
          </View></>}
          {mode === 'REVERSE' && <Notice message="Se registrará un movimiento contrario para conservar el historial. Se comprobará que las cuentas y el saldo pendiente sigan siendo válidos." />}
          <Field label="Fecha de la operación" value={effectiveDate} onChange={setEffectiveDate} placeholder="AAAA-MM-DD" hint="Formato: año-mes-día, por ejemplo 2026-10-13." />
          {mode === 'CREATE' && <>
            <Field label="Vencimiento opcional" value={dueOn} onChange={setDueOn} placeholder="AAAA-MM-DD" />
            <Field label="Notas opcionales" value={notes} onChange={setNotes} multiline placeholder="Detalles del acuerdo" />
          </>}
          <Field label={mode === 'REVERSE' ? 'Motivo del reverso' : 'Descripción opcional'} value={description} onChange={setDescription}
            placeholder={mode === 'REVERSE' ? 'Explica por qué corriges el movimiento' : 'Un detalle para el historial'} multiline />
        </>}
        <AppButton title={busy ? 'Guardando…' : mode === 'PERSON' && afterPerson ? 'Guardar persona y continuar' : mode === 'REVERSE' ? 'Confirmar reverso' : 'Guardar'}
          variant={mode === 'REVERSE' ? 'danger' : 'primary'} disabled={saveDisabled} onPress={() => { void save(); }} />
      </View>
    </FormSheet>
  </Screen>;
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  personHeading: { flexDirection: 'row', gap: 12, alignItems: 'center', flex: 1 },
  avatar: { width: 46, height: 46, backgroundColor: palette.soft, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: palette.primary, fontSize: 14, fontWeight: '700' },
  arrow: { fontSize: 30, color: palette.muted },
  totalZero: { color: palette.primary, fontSize: 32, letterSpacing: -1, fontWeight: '700' },
  debtAmount: { color: palette.ink, fontSize: 24, letterSpacing: -.5, fontWeight: '700' },
  detailItem: { flex: 1, minWidth: 140, gap: 4 },
  eventTitle: { color: palette.ink, fontWeight: '600', fontSize: 14 },
  eventAmount: { fontWeight: '700', fontSize: 16 },
  historyEntry: { gap: 8 },
  footnote: { color: palette.muted, fontSize: 11, lineHeight: 18 },
  form: { gap: 18 },
  label: { color: palette.ink, fontWeight: '700', fontSize: 12 },
  accountList: { gap: 10 },
  accountChoice: { borderRadius: 14, borderWidth: 1, borderColor: palette.border, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 10 },
  accountSelected: { borderColor: palette.primary, backgroundColor: palette.soft },
  protectedBox: { backgroundColor: '#FFF0D7', borderRadius: 14, padding: 15, gap: 12, flexDirection: 'row', alignItems: 'center' },
});
