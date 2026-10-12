import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Button, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { CardSummary } from '../../financial-engine/cards';
import type { FinanceSnapshot } from '../../services/finance/application';
import { creditCards, finance, newOperationKey } from '../../services/finance/runtime';
import { formatAmountMinor, parseAmountMinor } from '../../financial-engine/money';

type Mode = 'CREATE' | 'PURCHASE' | 'PAY' | 'REVERSE' | 'CYCLE';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function Field({ label, value, onChange }: { label: string; value: string; onChange: (text: string) => void }) {
  return <View><Text>{label}</Text><TextInput style={styles.input} value={value} onChangeText={onChange} /></View>;
}
export default function CreditCardsScreen() {
  const [profileId, setProfileId] = useState('');
  const [data, setData] = useState<FinanceSnapshot>();
  const [selected, setSelected] = useState('');
  const [mode, setMode] = useState<Mode>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false), operationKey = useRef<string | undefined>(undefined);
  const [name, setName] = useState(''), [currency, setCurrency] = useState('USD');
  const [amount, setAmount] = useState(''), [opening, setOpening] = useState('0');
  const [closingDay, setClosingDay] = useState('15'), [dueDay, setDueDay] = useState('12');
  const [effectiveDate, setEffectiveDate] = useState(today), [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState(''), [accountId, setAccountId] = useState('');
  const [full, setFull] = useState(false), [protectedConfirmed, setProtectedConfirmed] = useState(false);
  const [originalId, setOriginalId] = useState('');
  const refresh = useCallback(async () => {
    const profile = await finance.initialProfile(); setProfileId(profile.id);
    setData(await finance.snapshot(profile.id));
  }, []);
  useFocusEffect(useCallback(() => { void refresh().catch(error => setMessage(error instanceof Error ? error.message : 'No se pudo abrir')); }, [refresh]));
  const detail: CardSummary | undefined = data?.cards.find(row => row.card.id === selected);
  const money = (value: number) => formatAmountMinor(value, detail?.card.currency ?? currency);
  function begin(next: Mode, id = '') {
    if (lock.current) return;
    operationKey.current = undefined; setMode(next); setOriginalId(id); setAmount(''); setEffectiveDate(today()); setDescription('');
    setFull(false); setProtectedConfirmed(false); setMessage('');
    setAccountId(detail?.card.defaultAccountId ?? '');
    setCategoryId(data?.categories.find(row => row.kind === 'EXPENSE')?.id ?? '');
  }
  async function submit() {
    if (lock.current || !mode) return;
    lock.current = true; setBusy(true); setMessage(''); let saved = false;
    try {
      operationKey.current ??= await newOperationKey();
      const base = { profileId, idempotencyKey: operationKey.current, effectiveDate, description };
      if (mode === 'CREATE') {
        const card = await creditCards.create({ ...base, name, currency, limitMinor: parseAmountMinor(amount), initialDebtMinor: parseAmountMinor(opening),
          closingDay: Number(closingDay), dueDay: Number(dueDay), defaultAccountId: accountId || null });
        setSelected(card.id);
      } else {
        if (!detail) throw new Error('Selecciona una tarjeta');
        const input = { ...base, cardId: detail.card.id };
        if (mode === 'PURCHASE') await creditCards.purchase({ ...input, amountMinor: parseAmountMinor(amount), categoryId });
        if (mode === 'PAY') await creditCards.pay({ ...input, accountId, full, amountMinor: full ? undefined : parseAmountMinor(amount), allowProtected: protectedConfirmed });
        if (mode === 'REVERSE') await creditCards.reversePurchase({ ...input, originalId });
        if (mode === 'CYCLE') await creditCards.reassignCycle({ profileId, cardId: detail.card.id, originalId, cycleDate: effectiveDate, reason: description });
      }
      saved = true; operationKey.current = undefined; setMode(undefined); await refresh(); setMessage('Guardado correctamente');
    } catch (error) { setMessage(`${saved ? 'Guardado, pero falta actualizar la pantalla. ' : ''}${error instanceof Error ? error.message : 'No se pudo completar'}`); }
    finally { lock.current = false; setBusy(false); }
  }
  const reversed = new Set(data?.transactions.filter(row => row.type === 'REVERSAL').map(row => row.reversalOf));
  return <ScrollView contentContainerStyle={styles.page}>
    <Link href="/">Volver a Inicio</Link><Text style={styles.title}>Tarjetas</Text>
    <Text>Prueba local sin cifrado: usa únicamente datos sintéticos.</Text>
    <Text accessibilityLiveRegion="polite">{message}</Text>
    <Button title="Actualizar" disabled={busy} onPress={() => { void refresh().catch(error => setMessage(String(error))); }} />
    <Button title="Crear tarjeta" disabled={busy || !profileId} onPress={() => begin('CREATE')} />
    {data?.cards.map(row => <View key={row.card.id} style={styles.box}>
      <Text style={styles.heading}>{row.card.name} · {row.card.status}</Text>
      <Text>Deuda {formatAmountMinor(row.debtMinor, row.card.currency)} · límite {formatAmountMinor(row.card.limitMinor, row.card.currency)}</Text>
      <Text>Crédito disponible {formatAmountMinor(row.availableCreditMinor, row.card.currency)}</Text>
      <Text>Próximo corte {row.nextClosingOn} · fecha límite {row.nextDueOn}</Text>
      <Button title="Ver detalle" disabled={busy} onPress={() => { setSelected(row.card.id); setMode(undefined); }} />
    </View>)}
    {detail && <View style={styles.box}>
      <Text style={styles.heading}>{detail.card.name}</Text>
      <Text>Deuda total: {money(detail.debtMinor)}</Text>
      <Text>Saldo histórico al corte {detail.lastClosingOn}: {money(detail.lastClosingBalanceMinor)}</Text>
      <Text>Compras posteriores netas de reversos: {money(detail.purchasesAfterClosingMinor)}</Text>
      <Text>Crédito disponible: {money(detail.availableCreditMinor)}</Text>
      <Text>Pagos realizados: {money(detail.paymentsMinor)}</Text>
      <Button title="+ Compra" disabled={busy} onPress={() => begin('PURCHASE')} />
      <Button title="Pagar tarjeta" disabled={busy} onPress={() => begin('PAY')} />
      <Text style={styles.heading}>Ciclos</Text>
      {detail.cycles.map(cycle => <View key={cycle.id} style={styles.box}>
        <Text>{cycle.startsOn} → {cycle.closesOn} · vence {cycle.dueOn}</Text>
        <Text>Cargos netos {money(cycle.chargesMinor)} · pagado {money(cycle.paidMinor)} · pendiente {money(cycle.pendingMinor)}</Text>
      </View>)}
      <Text style={styles.heading}>Movimientos y compras</Text>
      {detail.data.charges.map(charge => <View key={charge.entryId} style={styles.box}>
        <Text>{charge.effectiveDate} · {charge.type} · {money(charge.amountMinor)}</Text>
        <Text>{data?.transactions.find(row => row.id === charge.transactionId)?.description}</Text>
        <Text>Corte: {detail.cycles.find(row => row.id === charge.cycleId)?.closesOn}</Text>
        {charge.type === 'EXPENSE' && !reversed.has(charge.transactionId) && <>
          <Button title="Revertir compra completa" disabled={busy} onPress={() => begin('REVERSE', charge.transactionId)} />
          <Button title="Corregir ciclo" disabled={busy} onPress={() => begin('CYCLE', charge.transactionId)} />
        </>}
      </View>)}
      <Text style={styles.heading}>Pagos y aplicaciones</Text>
      {detail.data.payments.map(payment => <View key={payment.id} style={styles.box}>
        <Text>{payment.effectiveDate} · {money(payment.amountMinor)} · {data?.accounts.find(row => row.account.id === payment.accountId)?.account.name}</Text>
        {detail.data.applications.filter(row => row.paymentId === payment.id).map(row => <Text key={row.cycleId}>Corte {detail.cycles.find(c => c.id === row.cycleId)?.closesOn}: {money(row.amountMinor)}</Text>)}
      </View>)}
    </View>}
    {mode && <View style={styles.box}>
      <Text style={styles.heading}>Operación: {mode}</Text>
      {mode === 'CREATE' && <>
        <Field label="Nombre" value={name} onChange={setName} />
        <View style={styles.row}>{['USD', 'EUR'].map(value => <Button key={value} title={`${currency === value ? '✓ ' : ''}${value}`} disabled={busy} onPress={() => setCurrency(value)} />)}</View>
        <Field label="Deuda inicial (no es gasto)" value={opening} onChange={setOpening} />
        <Field label="Día de corte (1–31)" value={closingDay} onChange={setClosingDay} />
        <Field label="Día límite de pago posterior al corte (1–31)" value={dueDay} onChange={setDueDay} />
      </>}
      {(mode === 'CREATE' || mode === 'PURCHASE' || (mode === 'PAY' && !full)) && <Field label={mode === 'CREATE' ? 'Límite' : 'Monto'} value={amount} onChange={setAmount} />}
      {mode === 'PURCHASE' && data?.categories.filter(row => row.kind === 'EXPENSE').map(row => <Button key={row.id} title={`${categoryId === row.id ? '✓ ' : ''}${row.name}`} disabled={busy} onPress={() => setCategoryId(row.id)} />)}
      {(mode === 'PAY' || mode === 'CREATE') && <>
        <Text>{mode === 'CREATE' ? 'Cuenta predeterminada opcional' : 'Cuenta desde la que se paga'}</Text>
        {mode === 'CREATE' && <Button title="Sin cuenta predeterminada" disabled={busy} onPress={() => setAccountId('')} />}
        {data?.accounts.filter(row => row.account.active && row.account.currency === (mode === 'CREATE' ? currency : detail?.card.currency)).map(row => <Button key={row.account.id} title={`${accountId === row.account.id ? '✓ ' : ''}${row.account.name} · ${row.account.availabilityPolicy}`} disabled={busy} onPress={() => setAccountId(row.account.id)} />)}
      </>}
      {mode === 'PAY' && <>
        <Text>Pagar saldo completo {detail ? money(detail.debtMinor) : ''}</Text><Switch value={full} disabled={busy} onValueChange={setFull} />
        {data?.accounts.find(row => row.account.id === accountId)?.account.availabilityPolicy === 'protected' && <><Text>Confirmo usar fondos protegidos</Text><Switch value={protectedConfirmed} disabled={busy} onValueChange={setProtectedConfirmed} /></>}
      </>}
      <Field label={mode === 'CYCLE' ? 'Fecha dentro del ciclo destino (YYYY-MM-DD)' : 'Fecha efectiva (YYYY-MM-DD)'} value={effectiveDate} onChange={setEffectiveDate} />
      <Field label={mode === 'CYCLE' || mode === 'REVERSE' ? 'Motivo' : 'Descripción opcional'} value={description} onChange={setDescription} />
      {mode === 'REVERSE' && <Text>Se registrará un reverso total sin borrar la compra.</Text>}
      <Button title={busy ? 'Guardando…' : 'Confirmar'} disabled={busy} onPress={() => { void submit(); }} />
      <Button title="Cancelar" disabled={busy} onPress={() => { setMode(undefined); operationKey.current = undefined; }} />
    </View>}
  </ScrollView>;
}
const styles = StyleSheet.create({ page: { padding: 20, gap: 12, paddingBottom: 50 }, title: { fontSize: 26, fontWeight: 'bold' }, heading: { fontSize: 18, fontWeight: '600' }, box: { padding: 12, borderWidth: 1, borderColor: '#999', gap: 8 }, input: { borderWidth: 1, borderColor: '#999', padding: 10, marginVertical: 6 }, row: { flexDirection: 'row', gap: 8 } });
