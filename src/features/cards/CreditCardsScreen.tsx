import { ThemePressable as Pressable, ThemeText as Text, ThemeView as View } from '@/components/appearance';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Switch } from 'react-native';
import { AppButton, Badge, Card, Chip, EmptyState, Field, FormSheet, Loading, Metric, Notice, Screen, SectionHeading, palette, ui } from '@/components/ui';
import { displayDate, displayMoney, localToday } from '@/components/format';
import { cycleForDate } from '../../financial-engine/cards';
import type { CardSummary } from '../../financial-engine/cards';
import type { FinanceSnapshot } from '../../services/finance/application';
import { creditCards, finance, newOperationKey } from '../../services/finance/runtime';
import { parseAmountMinor } from '../../financial-engine/money';

type Mode = 'CREATE' | 'PURCHASE' | 'PAY' | 'REVERSE' | 'CYCLE';
type DetailTab = 'ACTIVITY' | 'CYCLES' | 'PAYMENTS';
const formTitles: Record<Mode, string> = { CREATE: 'Nueva tarjeta', PURCHASE: 'Registrar compra', PAY: 'Pagar tarjeta', REVERSE: 'Revertir compra', CYCLE: 'Corregir ciclo' };
const failureText = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación. Inténtalo de nuevo.';

function CreditCardVisual({ summary, onPress, disabled = false }: { summary: CardSummary; onPress?: () => void; disabled?: boolean }) {
  const { card } = summary;
  const used = card.limitMinor > 0 ? Math.min(100, Math.max(0, summary.debtMinor / card.limitMinor * 100)) : 0;
  const content = <>
    <View style={styles.visualHeader}><View style={{ flex: 1, gap: 5 }}><Text style={styles.visualEyebrow}>TARJETA DE CRÉDITO</Text><Text style={styles.visualName}>{card.name}</Text></View><View style={styles.currencyTag}><Text style={styles.currencyTagText}>{card.currency}</Text></View></View>
    <View style={styles.visualAmount}><Text style={styles.visualLabel}>Deuda actual</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.visualDebt}>{displayMoney(summary.debtMinor, card.currency)}</Text></View>
    <View style={styles.creditTrack}><View style={[styles.creditProgress, { width: `${used}%` }]} /></View>
    <View style={styles.visualFooter}><View style={{ flex: 1, gap: 4 }}><Text style={styles.visualLabel}>Crédito disponible</Text><Text style={styles.visualCredit}>{displayMoney(summary.availableCreditMinor, card.currency)}</Text></View><View style={{ alignItems: 'flex-end', gap: 4 }}><Text style={styles.visualLabel}>Límite</Text><Text style={styles.visualLimit}>{displayMoney(card.limitMinor, card.currency)}</Text></View></View>
    {card.status === 'inactive' && <Text style={styles.visualLabel}>Tarjeta inactiva · puedes liquidar su deuda</Text>}
    {onPress && <Text style={styles.visualOpen}>Ver movimientos y pagos →</Text>}
  </>;
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`Ver tarjeta ${card.name}`} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.visualCard, { opacity: pressed ? .88 : 1 }]}>{content}</Pressable> : <View style={styles.visualCard}>{content}</View>;
}

export default function CreditCardsScreen() {
  const params=useLocalSearchParams<{cardId?:string;action?:string}>();const incoming=useRef('');
  const [profileId, setProfileId] = useState('');
  const [data, setData] = useState<FinanceSnapshot>();
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState<DetailTab>('ACTIVITY');
  const [mode, setMode] = useState<Mode>();
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'error' | 'success'>('info');
  const lock = useRef(false), operationKey = useRef<string | undefined>(undefined);
  const [name, setName] = useState(''), [currency, setCurrency] = useState('USD');
  const [amount, setAmount] = useState(''), [opening, setOpening] = useState('0');
  const [closingDay, setClosingDay] = useState('15'), [dueDay, setDueDay] = useState('12');
  const [effectiveDate, setEffectiveDate] = useState(localToday), [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState(''), [accountId, setAccountId] = useState('');
  const [full, setFull] = useState(false), [protectedConfirmed, setProtectedConfirmed] = useState(false);
  const [originalId, setOriginalId] = useState('');
  const refresh = useCallback(async () => {
    const profile = await finance.initialProfile(); setProfileId(profile.id);
    const snapshot=await finance.snapshot(profile.id);setData(snapshot);
    const token=JSON.stringify([params.cardId,params.action]);if(incoming.current!==token){incoming.current=token;const chosen=snapshot.cards.find(row=>row.card.id===params.cardId)??(params.action==='PURCHASE'?snapshot.cards.find(row=>row.card.status==='active'):undefined);
     if(chosen)setSelected(chosen.card.id);
     if(chosen&&params.action==='PURCHASE'){setMode('PURCHASE');setAmount('');setEffectiveDate(localToday());setDescription('');setCategoryId(snapshot.categories.find(row=>row.kind==='EXPENSE')?.id??'');operationKey.current=undefined;}
    }
  }, [params.cardId,params.action]);
  const reload = useCallback(async () => {
    setFetching(true);
    try { await refresh(); }
    catch (error) { setMessage(failureText(error)); setMessageTone('error'); }
    finally { setFetching(false); }
  }, [refresh]);
  useFocusEffect(useCallback(() => { if (!lock.current) void reload(); }, [reload]));
  const detail: CardSummary | undefined = data?.cards.find(row => row.card.id === selected);
  const disabled = busy || fetching;
  const money = (value: number) => displayMoney(value, detail?.card.currency ?? currency);
  const compatibleAccounts = data?.accounts.filter(row => row.account.active && row.account.currency === (mode === 'CREATE' ? currency : detail?.card.currency)) ?? [];
  const paymentAccount = compatibleAccounts.find(row => row.account.id === accountId);
  const original = data?.transactions.find(row => row.id === originalId);
  const originalCharge = detail?.data.charges.find(row => row.transactionId === originalId);
  const reversed = new Set(data?.transactions.filter(row => row.type === 'REVERSAL').map(row => row.reversalOf));
  let targetCycle: ReturnType<typeof cycleForDate> | undefined;
  if (mode === 'CYCLE' && detail) {
    try { targetCycle = cycleForDate(effectiveDate, detail.card.closingDay, detail.card.dueDay); }
    catch { /* A partially entered date has no cycle preview yet. The service validates on submit. */ }
  }

  function begin(next: Mode, id = '') {
    if (lock.current || fetching) return;
    operationKey.current = undefined; setMode(next); setOriginalId(id); setAmount(''); setEffectiveDate(localToday()); setDescription('');
    setFull(false); setProtectedConfirmed(false); setMessage(''); setMessageTone('info');
    setCategoryId(data?.categories.find(row => row.kind === 'EXPENSE')?.id ?? '');
    if (next === 'CREATE') {
      setName(''); setCurrency('USD'); setOpening('0'); setClosingDay('15'); setDueDay('12'); setAccountId('');
    } else {
      const eligible = data?.accounts.filter(row => row.account.active && row.account.currency === detail?.card.currency) ?? [];
      const fallback = eligible.find(row => row.account.id === detail?.card.defaultAccountId) ?? eligible.find(row => row.account.availabilityPolicy === 'free') ?? eligible[0];
      setAccountId(fallback?.account.id ?? '');
      if (next === 'CYCLE') {
        const charge = detail?.data.charges.find(row => row.transactionId === id);
        const cycle = detail?.cycles.find(row => row.id === charge?.cycleId);
        setEffectiveDate(cycle?.closesOn ?? localToday());
      }
    }
  }
  function closeForm() {
    if (lock.current) return;
    setMode(undefined); operationKey.current = undefined; setMessage('');
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
        setSelected(card.id); setTab('ACTIVITY');
      } else {
        if (!detail) throw new Error('Selecciona una tarjeta');
        const input = { ...base, cardId: detail.card.id };
        if (mode === 'PURCHASE') await creditCards.purchase({ ...input, amountMinor: parseAmountMinor(amount), categoryId });
        if (mode === 'PAY') await creditCards.pay({ ...input, accountId, full, amountMinor: full ? undefined : parseAmountMinor(amount), allowProtected: protectedConfirmed });
        if (mode === 'REVERSE') await creditCards.reversePurchase({ ...input, originalId });
        if (mode === 'CYCLE') await creditCards.reassignCycle({ profileId, cardId: detail.card.id, originalId, cycleDate: effectiveDate, reason: description });
      }
      saved = true; operationKey.current = undefined; setMode(undefined); await refresh(); setMessage('Guardado correctamente'); setMessageTone('success');
    } catch (error) { setMessage(`${saved ? 'La operación se guardó, pero falta actualizar la pantalla. Pulsa Actualizar. ' : ''}${failureText(error)}`); setMessageTone('error'); }
    finally { lock.current = false; setBusy(false); }
  }

  return <>
    <Screen title={detail ? detail.card.name : 'Tarjetas'} eyebrow="FINANCE · CRÉDITO" subtitle={detail ? 'Cada compra, pago y ciclo en un solo lugar.' : 'Controla tu deuda y cuánto crédito queda disponible.'}
      action={<AppButton title="Actualizar" variant="ghost" disabled={disabled} onPress={() => { void reload(); }} />}>
      {!mode && <Notice message={message} tone={messageTone} />}
      {!data && fetching && <Loading />}
      {!data && !fetching && <EmptyState title="No pudimos cargar tus tarjetas" description="Vuelve a intentarlo para consultar tu información." action={<AppButton title="Volver a intentar" onPress={() => { void reload(); }} />} />}
      {data && !detail && <>
        <SectionHeading title="Mis tarjetas" subtitle={`${data.cards.length} ${data.cards.length === 1 ? 'tarjeta registrada' : 'tarjetas registradas'}`} action={<AppButton title="Nueva tarjeta" icon="+" disabled={disabled || !profileId} onPress={() => begin('CREATE')} />} />
        {data.cards.length === 0 ? <EmptyState title="Tu primera tarjeta" description="Agrega su límite, fechas y deuda inicial para registrar compras y pagos con claridad." action={<AppButton title="Agregar tarjeta" disabled={disabled || !profileId} onPress={() => begin('CREATE')} />} /> : <View style={styles.cardGrid}>
          {data.cards.map(row => <View key={row.card.id} style={styles.cardColumn}><CreditCardVisual summary={row} disabled={disabled} onPress={() => { setSelected(row.card.id); setTab('ACTIVITY'); setMessage(''); }} />
            <View style={styles.cardDates}><Text style={ui.muted}>Corte {displayDate(row.nextClosingOn)}</Text><Text style={ui.muted}>Pago {displayDate(row.nextDueOn)}</Text></View>
          </View>)}
        </View>}
        <Text style={ui.muted}>El crédito disponible pertenece a la tarjeta. Tu Disponible real descuenta la deuda de tus fondos.</Text>
      </>}
      {detail && <>
        <AppButton title="← Todas las tarjetas" variant="ghost" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} disabled={disabled} onPress={() => { setSelected(''); setMessage(''); }} />
        <CreditCardVisual summary={detail} />
        <View style={ui.row}>
          <AppButton title="Registrar compra" icon="+" style={{ flex: 1 }} disabled={disabled || detail.card.status !== 'active'} onPress={() => begin('PURCHASE')} />
          <AppButton title="Pagar tarjeta" variant="secondary" style={{ flex: 1 }} disabled={disabled || detail.debtMinor <= 0} onPress={() => begin('PAY')} />
        </View>
        <Card><View style={ui.row}><Metric label="Próximo corte" value={displayDate(detail.nextClosingOn)} /><Metric label="Fecha límite de pago" value={displayDate(detail.nextDueOn)} tone={detail.debtMinor > 0 && detail.nextDueOn < localToday() ? 'red' : 'default'} /></View>
          {detail.debtMinor === 0 ? <Badge label="Sin deuda pendiente" tone="green" /> : detail.nextDueOn < localToday() ? <Badge label="Hay un ciclo vencido" tone="red" /> : <Badge label="Con saldo pendiente" tone="amber" />}
          <View style={ui.divider} />
          <View style={ui.row}><Metric label={`Saldo al corte · ${displayDate(detail.lastClosingOn)}`} value={money(detail.lastClosingBalanceMinor)} /><Metric label="Compras después del corte" value={money(detail.purchasesAfterClosingMinor)} /></View>
          <Text style={ui.muted}>El saldo al corte es histórico. La deuda actual refleja también las compras, pagos y reversos posteriores.</Text>
        </Card>
        <View style={ui.row}>{([{ id: 'ACTIVITY', label: 'Movimientos' }, { id: 'CYCLES', label: 'Ciclos' }, { id: 'PAYMENTS', label: 'Pagos' }] as const).map(item => <Chip key={item.id} label={item.label} selected={tab === item.id} onPress={() => setTab(item.id)} />)}</View>
        {tab === 'ACTIVITY' && <>
          <SectionHeading title="Compras y movimientos" subtitle="El historial se conserva también cuando corriges una compra." />
          {detail.data.charges.length === 0 ? <EmptyState title="Todavía no hay compras" description="Registra una compra para ver a qué ciclo corresponde y cómo cambia tu deuda." action={<AppButton title="Registrar compra" disabled={disabled || detail.card.status !== 'active'} onPress={() => begin('PURCHASE')} />} /> : [...detail.data.charges].reverse().map(charge => {
            const transaction = data?.transactions.find(row => row.id === charge.transactionId);
            const cycle = detail.cycles.find(row => row.id === charge.cycleId);
            const isReversed = reversed.has(charge.transactionId);
            const label = charge.type === 'OPENING' ? 'Deuda inicial' : charge.type === 'REVERSAL' ? 'Reverso de compra' : 'Compra';
            return <Card key={charge.entryId}>
              <View style={styles.activityRow}><View style={{ flex: 1, gap: 5 }}><Text style={ui.heading}>{transaction?.description || label}</Text><Text style={ui.muted}>{displayDate(charge.effectiveDate)} · {label}</Text></View><Text style={[styles.activityAmount, charge.amountMinor < 0 && { color: palette.primary }]}>{charge.amountMinor < 0 ? '−' : ''}{money(Math.abs(charge.amountMinor))}</Text></View>
              <View style={ui.row}><Badge label={isReversed ? 'Compra revertida' : label} tone={isReversed ? 'neutral' : charge.type === 'REVERSAL' ? 'green' : 'neutral'} />{cycle && <Text style={ui.muted}>Corte {displayDate(cycle.closesOn)}</Text>}</View>
              {charge.type === 'EXPENSE' && <AppButton title="Desglosar gasto" variant="secondary" disabled={disabled} onPress={()=>router.push({pathname:'/transactions',params:{transactionId:charge.transactionId,action:'SPLIT'}})}/> }
              {charge.type === 'EXPENSE' && !isReversed && <View style={ui.row}><AppButton title="Corregir ciclo" variant="ghost" disabled={disabled} onPress={() => begin('CYCLE', charge.transactionId)} /><AppButton title="Revertir compra" variant="ghost" disabled={disabled} onPress={() => begin('REVERSE', charge.transactionId)} /></View>}
            </Card>;
          })}
        </>}
        {tab === 'CYCLES' && <>
          <SectionHeading title="Tus ciclos" subtitle="Los pagos se aplican primero al ciclo pendiente más antiguo." />
          {[...detail.cycles].reverse().map(cycle => <Card key={cycle.id}>
            <View style={styles.activityRow}><View style={{ flex: 1, gap: 4 }}><Text style={ui.heading}>Corte {displayDate(cycle.closesOn)}</Text><Text style={ui.muted}>{displayDate(cycle.startsOn)} — {displayDate(cycle.closesOn)}</Text></View><Badge label={cycle.pendingMinor === 0 ? 'Liquidado' : cycle.dueOn < localToday() ? 'Vencido' : 'Pendiente'} tone={cycle.pendingMinor === 0 ? 'green' : cycle.dueOn < localToday() ? 'red' : 'amber'} /></View>
            <View style={ui.row}><Metric label="Pendiente" value={money(cycle.pendingMinor)} /><Metric label="Pagado" value={money(cycle.paidMinor)} tone="green" /></View>
            <Text style={ui.muted}>Cargos netos {money(cycle.chargesMinor)} · fecha límite {displayDate(cycle.dueOn)}</Text>
          </Card>)}
        </>}
        {tab === 'PAYMENTS' && <>
          <SectionHeading title="Pagos realizados" subtitle={`Total pagado: ${money(detail.paymentsMinor)}`} />
          {detail.data.payments.length === 0 ? <EmptyState title="Aún no hay pagos" description="Cuando pagues, verás aquí la cuenta utilizada y los ciclos que se liquidaron." action={detail.debtMinor > 0 ? <AppButton title="Pagar tarjeta" disabled={disabled} onPress={() => begin('PAY')} /> : undefined} /> : [...detail.data.payments].reverse().map(payment => <Card key={payment.id}>
            <View style={styles.activityRow}><View style={{ flex: 1, gap: 4 }}><Text style={ui.heading}>Pago de tarjeta</Text><Text style={ui.muted}>{displayDate(payment.effectiveDate)} · {data?.accounts.find(row => row.account.id === payment.accountId)?.account.name ?? 'Cuenta de pago'}</Text></View><Text style={[styles.activityAmount, { color: palette.primary }]}>{money(payment.amountMinor)}</Text></View>
            {detail.data.applications.filter(row => row.paymentId === payment.id).map(row => <View key={row.cycleId} style={styles.applicationRow}><Text style={ui.muted}>Corte {displayDate(detail.cycles.find(cycle => cycle.id === row.cycleId)?.closesOn ?? payment.effectiveDate)}</Text><Text style={ui.text}>{money(row.amountMinor)}</Text></View>)}
          </Card>)}
        </>}
      </>}
    </Screen>
    <FormSheet visible={mode !== undefined} title={mode ? formTitles[mode] : ''} subtitle={mode === 'CREATE' ? 'Configura los datos básicos de tu tarjeta.' : detail?.card.name} busy={busy} onClose={closeForm}>
      <Notice message={message} tone={messageTone} />
      {mode === 'CREATE' && <>
        <Field label="Nombre de la tarjeta" value={name} onChange={setName} placeholder="Ej. Tarjeta principal" />
        <View style={{ gap: 10 }}><Text style={styles.label}>Moneda</Text><View style={ui.row}>{['USD', 'EUR'].map(value => <Chip key={value} label={value === 'USD' ? 'USD · Dólares' : 'EUR · Euros'} selected={currency === value} disabled={busy} onPress={() => { setCurrency(value); setAccountId(''); }} />)}</View></View>
        <Field label="Límite de crédito" value={amount} onChange={setAmount} numeric placeholder="0.00" />
        <Field label="Deuda inicial" value={opening} onChange={setOpening} numeric placeholder="0.00" hint="Si ya debes dinero, regístralo aquí. Se incorpora como deuda existente sin crear un gasto." />
        <View style={styles.twoFields}><View style={{ flex: 1 }}><Field label="Día de corte" value={closingDay} onChange={setClosingDay} numeric placeholder="1–31" /></View><View style={{ flex: 1 }}><Field label="Día límite de pago" value={dueDay} onChange={setDueDay} numeric placeholder="1–31" /></View></View>
        <Text style={ui.muted}>La fecha límite se calcula después del corte. Si un mes no tiene el día indicado, se usa su último día.</Text>
      </>}
      {mode === 'PURCHASE' && <>
        <Notice message={`Crédito disponible: ${money(detail?.availableCreditMinor ?? 0)}. La compra aumenta tu deuda y reduce tu Disponible real.`} />
        <Field label={`Monto de la compra · ${detail?.card.currency ?? ''}`} value={amount} onChange={setAmount} numeric placeholder="0.00" />
        <View style={{ gap: 10 }}><Text style={styles.label}>Categoría</Text><View style={ui.row}>{data?.categories.filter(row => row.kind === 'EXPENSE').map(row => <Chip key={row.id} label={row.name} selected={categoryId === row.id} disabled={busy} onPress={() => setCategoryId(row.id)} />)}</View></View>
      </>}
      {mode === 'PAY' && <>
        <Card style={{ backgroundColor: palette.bg }}><Metric label="Deuda actual" value={money(detail?.debtMinor ?? 0)} /><View style={styles.switchRow}><View style={{ flex: 1 }}><Text style={styles.label}>Pagar saldo completo</Text><Text style={ui.muted}>Liquida toda la deuda actual.</Text></View><Switch accessibilityLabel="Pagar saldo completo" value={full} disabled={busy} onValueChange={setFull} trackColor={{ true: palette.primary }} /></View></Card>
        {!full && <Field label={`Monto a pagar · ${detail?.card.currency ?? ''}`} value={amount} onChange={setAmount} numeric placeholder="0.00" />}
      </>}
      {(mode === 'PAY' || mode === 'CREATE') && <View style={{ gap: 10 }}>
        <Text style={styles.label}>{mode === 'CREATE' ? 'Cuenta de pago predeterminada · opcional' : 'Pagar desde'}</Text>
        {mode === 'CREATE' && <Chip label="Elegir al pagar" selected={!accountId} disabled={busy} onPress={() => setAccountId('')} />}
        {compatibleAccounts.map(row => <Pressable key={row.account.id} accessibilityRole="button" accessibilityState={{ selected: accountId === row.account.id, disabled: busy }} disabled={busy} onPress={() => { setAccountId(row.account.id); setProtectedConfirmed(false); }} style={[styles.accountChoice, accountId === row.account.id && styles.accountSelected]}>
          <View style={{ flex: 1, gap: 4 }}><Text style={styles.label}>{row.account.name}</Text><Text style={ui.muted}>Saldo {displayMoney(row.balanceMinor, row.account.currency)}</Text></View><Badge label={row.account.availabilityPolicy === 'protected' ? 'Protegida' : 'Libre'} tone={row.account.availabilityPolicy === 'protected' ? 'amber' : 'green'} /><Text style={{ color: palette.primary, fontSize: 20 }}>{accountId === row.account.id ? '●' : '○'}</Text>
        </Pressable>)}
        {compatibleAccounts.length === 0 && <Notice message={mode === 'PAY' ? 'Necesitas una cuenta activa en la misma moneda para pagar. Puedes crearla desde Cuentas.' : 'No hay cuentas activas en esta moneda. Podrás elegir una después al pagar.'} />}
        {mode === 'PAY' && paymentAccount?.account.availabilityPolicy === 'protected' && <View style={styles.switchRow}><View style={{ flex: 1 }}><Text style={styles.label}>Usar fondos protegidos</Text><Text style={ui.muted}>Confirma que quieres pagar con esta cuenta.</Text></View><Switch accessibilityLabel="Confirmar uso de fondos protegidos" value={protectedConfirmed} disabled={busy} onValueChange={setProtectedConfirmed} trackColor={{ true: palette.primary }} /></View>}
        {mode === 'PAY' && <Text style={ui.muted}>El pago reduce el saldo de la cuenta y liquida deuda. Los ciclos más antiguos se pagan primero.</Text>}
      </View>}
      {(mode === 'REVERSE' || mode === 'CYCLE') && originalCharge && <Card style={{ backgroundColor: palette.bg }}><Text style={ui.heading}>{original?.description || 'Compra seleccionada'}</Text><Text style={ui.muted}>{displayDate(originalCharge.effectiveDate)}</Text><Text style={styles.activityAmount}>{money(originalCharge.amountMinor)}</Text></Card>}
      {mode === 'REVERSE' && <Notice message="Confirma el reverso completo de esta compra. Se conserva su historial y se reduce la deuda. El reverso se rechaza si produciría saldo a favor." />}
      <Field label={mode === 'CYCLE' ? 'Fecha dentro del ciclo de destino' : 'Fecha de la operación'} value={effectiveDate} onChange={setEffectiveDate} placeholder="AAAA-MM-DD" hint={mode === 'CYCLE' ? 'Escribe una fecha que pertenezca al ciclo correcto.' : 'Formato AAAA-MM-DD. El día de corte está incluido en su ciclo.'} />
      {mode === 'CYCLE' && <Notice message={targetCycle ? `Nuevo corte: ${displayDate(targetCycle.closesOn)} · fecha límite: ${displayDate(targetCycle.dueOn)}. Esta corrección solo cambia la asignación del ciclo.` : 'Introduce una fecha válida para ver el ciclo de destino.'} />}
      <Field label={mode === 'CYCLE' || mode === 'REVERSE' ? 'Motivo de la corrección' : 'Descripción · opcional'} value={description} onChange={setDescription} placeholder={mode === 'CYCLE' || mode === 'REVERSE' ? 'Explica por qué realizas esta corrección' : 'Ej. Compra de supermercado'} />
      <AppButton title={busy ? 'Guardando…' : mode === 'CREATE' ? 'Crear tarjeta' : mode === 'PURCHASE' ? 'Guardar compra' : mode === 'PAY' ? 'Confirmar pago' : mode === 'REVERSE' ? 'Confirmar reverso completo' : 'Guardar ciclo'} variant={mode === 'REVERSE' ? 'danger' : 'primary'} disabled={busy || (mode === 'PAY' && (!accountId || !compatibleAccounts.length))} onPress={() => { void submit(); }} />
    </FormSheet>
  </>;
}

const styles = StyleSheet.create({
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 }, cardColumn: { flexGrow: 1, flexBasis: 310, gap: 12 }, cardDates: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingHorizontal: 6 },
  visualCard: { padding: 25, borderRadius: 24, backgroundColor: palette.ink, gap: 21 }, visualHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  visualEyebrow: { fontSize: 9, letterSpacing: 2, fontWeight: '700', color: '#A4C5B9' }, visualName: { fontSize: 22, fontWeight: '700', color: palette.white }, currencyTag: { backgroundColor: '#294A44', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }, currencyTagText: { color: '#D7EBDD', fontWeight: '700', fontSize: 12 },
  visualAmount: { gap: 6 }, visualLabel: { fontSize: 12, color: '#A4C5B9' }, visualDebt: { fontSize: 37, fontWeight: '700', color: palette.white, letterSpacing: -1 }, creditTrack: { height: 5, backgroundColor: '#33534A', borderRadius: 5, overflow: 'hidden' }, creditProgress: { height: 5, backgroundColor: '#6AC49D', borderRadius: 5 },
  visualFooter: { flexDirection: 'row', gap: 16 }, visualCredit: { color: '#95DCB5', fontSize: 20, fontWeight: '700' }, visualLimit: { color: palette.white, fontSize: 15, fontWeight: '600' }, visualOpen: { fontSize: 12, color: '#D7EBDD', fontWeight: '600' },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 16 }, activityAmount: { fontSize: 19, color: palette.ink, fontWeight: '700' }, applicationRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: palette.border },
  label: { fontSize: 13, fontWeight: '700', color: palette.ink }, twoFields: { flexDirection: 'row', gap: 16 }, switchRow: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  accountChoice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: palette.border, padding: 14 }, accountSelected: { borderColor: palette.primary, backgroundColor: palette.soft },
});
