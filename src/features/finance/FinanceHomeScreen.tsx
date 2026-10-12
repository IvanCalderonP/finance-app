import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Button, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { finance, newOperationKey } from '@/services/finance/runtime';
import type { FinanceSnapshot, MovementInput } from '@/services/finance/application';
import { FinancialError } from '@/financial-engine/model';
import type { Account, Transaction } from '@/financial-engine/model';
import { formatAmountMinor, parseAmountMinor } from '@/financial-engine/money';

type Mode = 'ACCOUNT' | 'REVERSAL' | MovementInput['kind'];
const labels: Record<Mode, string> = {
  ACCOUNT: 'Crear cuenta', INCOME: 'Ingreso', EXPENSE: 'Gasto', DAILY: 'Gastos diarios', TRANSFER: 'Transferir', ADJUSTMENT: 'Ajuste con motivo', REVERSAL: 'Revertir movimiento',
};
function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function Field({ label, value, onChange, numeric = false }: { label: string; value: string; onChange: (text: string) => void; numeric?: boolean }) {
  return <View><Text>{label}</Text><TextInput accessibilityLabel={label} style={styles.input} value={value} onChangeText={onChange} keyboardType={numeric ? 'decimal-pad' : 'default'} /></View>;
}
function Choice({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.choice, selected && styles.selected]}><Text>{label}</Text></Pressable>;
}
export default function FinanceHomeScreen() {
  const [profileId, setProfileId] = useState('');
  const [data, setData] = useState<FinanceSnapshot>();
  const [busy, setBusy] = useState(true);
  const guard = useRef(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode | null>(null);
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [accountId, setAccountId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountType, setAccountType] = useState<Account['type']>('bank');
  const [policy, setPolicy] = useState<Account['availabilityPolicy']>('free');
  const [currency, setCurrency] = useState('USD');
  const [allowProtected, setAllowProtected] = useState(false);
  const [original, setOriginal] = useState<Transaction>();
  const operationKey = useRef<string | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void finance.initialProfile().then(async profile => {
      const result = await finance.snapshot(profile.id);
      if (mounted) { setProfileId(profile.id); setData(result); }
    }).catch(() => { if (mounted) setError('No se pudo abrir la base local. Reinicia la app para reintentar.'); })
      .finally(() => { if (mounted) setBusy(false); });
    return () => { mounted = false; };
  }, []));
  async function perform(action: () => Promise<unknown>) {
    if (guard.current) return;
    guard.current = true; setBusy(true); setError('');
    let saved = false;
    try { await action(); saved = true; setData(await finance.snapshot(profileId)); }
    catch (error) {
      setError(saved ? 'La operación se guardó, pero no se pudo actualizar la vista. Reabre la app para leerla; no la registres otra vez.'
        : error instanceof FinancialError ? error.message : 'No se pudo confirmar la operación local. Reintenta el mismo formulario para conservar su clave de operación.');
    }
    finally { guard.current = false; setBusy(false); }
  }
  function begin(next: Mode, transaction?: Transaction) {
    setError(''); setMode(next); setAmount(next === 'ACCOUNT' ? '0' : ''); setName(''); setDescription(''); setEffectiveDate(today());
    setAccountId(data?.accounts.find(row => row.account.active && row.account.availabilityPolicy === 'free')?.account.id ?? data?.accounts.find(row => row.account.active)?.account.id ?? '');
    setTargetId(''); setCategoryId(data?.categories.find(row => row.kind === (next === 'INCOME' ? 'INCOME' : 'EXPENSE'))?.id ?? '');
    setAccountType('bank'); setPolicy('free'); setCurrency('USD'); setAllowProtected(false); setOriginal(transaction); operationKey.current = null;
  }
  async function save() {
    await perform(async () => {
      if (!mode) return;
      operationKey.current ??= await newOperationKey();
      const common = { profileId, idempotencyKey: operationKey.current, effectiveDate, description };
      if (mode === 'ACCOUNT') {
        await finance.createAccount({ ...common, name, type: accountType, currency, availabilityPolicy: policy, initialBalanceMinor: parseAmountMinor(amount, true) });
      } else if (mode === 'REVERSAL') {
        if (!original) throw new FinancialError('Selecciona el movimiento original');
        await finance.reverse({ ...common, originalId: original.id });
      } else {
        await finance.post({ ...common, kind: mode, accountId, toAccountId: targetId || undefined, categoryId: categoryId || undefined,
          amountMinor: parseAmountMinor(amount, mode === 'ADJUSTMENT'), allowProtected });
      }
      setMode(null); operationKey.current = null;
    });
  }
  const active = data?.accounts.filter(row => row.account.active) ?? [];
  const source = active.find(row => row.account.id === accountId)?.account;
  const reversedIds = new Set(data?.transactions.map(row => row.reversalOf).filter(Boolean));
  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Finance App</Text>
      <Text>Perfil LOCAL · datos en este dispositivo · sin cifrado todavía.</Text>
      <Text>Disponible parcial: excluye saldo positivo protegido. TC, recibos, metas y deudas aún no participan.</Text>
      {busy && <Text accessibilityLiveRegion="polite">Procesando…</Text>}
      {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
      {!data?.totals.length && <Text>Sin cuentas. Crea una o carga datos sintéticos para probar.</Text>}
      {data?.totals.map(total => <View key={total.currency} style={styles.card}>
        <Text style={styles.heading}>Disponible real: {formatAmountMinor(total.availableMinor, total.currency)}</Text>
        <Text>Saldo físico: {formatAmountMinor(total.physicalMinor, total.currency)}</Text>
        <Text>Tarjetas pendientes: {formatAmountMinor(total.cardDebtMinor, total.currency)}</Text>
        <Text>Patrimonio actual: {formatAmountMinor(total.netWorthMinor, total.currency)}</Text>
      </View>)}
      <View style={styles.row}>
        {(['INCOME','EXPENSE','DAILY','TRANSFER'] satisfies Mode[]).map(value => <Button key={value} title={`${value === 'TRANSFER' ? '' : '+ '}${labels[value]}`} disabled={busy || active.length === 0} onPress={() => begin(value)} />)}
      </View>
      <Button title="Crear cuenta" disabled={busy || !profileId} onPress={() => begin('ACCOUNT')} />
      {!!data && data.accounts.length === 0 && <Button title="Cargar datos sintéticos (1200 + 200 + 100)" disabled={busy} onPress={() => void perform(() => finance.seedDevelopment(profileId))} />}
      {!!mode && <View style={styles.card}>
        <Text style={styles.heading}>{labels[mode]}</Text>
        {mode === 'ACCOUNT' ? <>
          <Field label="Nombre" value={name} onChange={setName} />
          <Text>Tipo (efectivo opcional)</Text><View style={styles.row}>{(['bank','savings','custom','cash'] satisfies Account['type'][]).map(value => <Choice key={value} selected={accountType === value} label={value} onPress={() => setAccountType(value)} />)}</View>
          <Text>Moneda V1</Text><View style={styles.row}>{['USD','EUR'].map(value => <Choice key={value} selected={currency === value} label={value} onPress={() => setCurrency(value)} />)}</View>
          <Text>Disponibilidad</Text><View style={styles.row}>{(['free','protected'] satisfies Account['availabilityPolicy'][]).map(value => <Choice key={value} selected={policy === value} label={value} onPress={() => setPolicy(value)} />)}</View>
          <Field label="Saldo de apertura (genera asientos; no es ingreso)" value={amount} onChange={setAmount} />
        </> : mode !== 'REVERSAL' ? <>
          <Text>{mode === 'INCOME' ? 'Cuenta destino' : 'Desde'} ({source?.currency ?? 'selecciona'})</Text><View style={styles.row}>{active.map(({ account }) => <Choice key={account.id} selected={accountId === account.id} label={account.name} onPress={() => { setAccountId(account.id); setAllowProtected(false); }} />)}</View>
          <Field label="Monto" value={amount} onChange={setAmount} numeric={mode !== 'ADJUSTMENT'} />
          {mode === 'TRANSFER' && <><Text>Cuenta destino</Text><View style={styles.row}>{active.filter(row => row.account.id !== accountId && row.account.currency === source?.currency).map(({ account }) => <Choice key={account.id} selected={targetId === account.id} label={account.name} onPress={() => setTargetId(account.id)} />)}</View><Text>Es transferencia: no genera gasto ni ingreso.</Text></>}
          {mode === 'DAILY' && <Text>Categoría: Gastos cotidianos. Gasto agregado al retirar; no se crea saldo de efectivo ni se pide cuánto queda.</Text>}
          {(mode === 'INCOME' || mode === 'EXPENSE') && <><Text>Categoría</Text><View style={styles.row}>{data?.categories.filter(category => category.kind === (mode === 'INCOME' ? 'INCOME' : 'EXPENSE')).map(category => <Choice key={category.id} selected={categoryId === category.id} label={category.name} onPress={() => setCategoryId(category.id)} />)}</View></>}
          {source?.availabilityPolicy === 'protected' && (mode === 'EXPENSE' || mode === 'DAILY' || mode === 'TRANSFER') && <View style={styles.row}><Switch value={allowProtected} onValueChange={setAllowProtected} accessibilityLabel="Confirmar uso de fondos protegidos" /><Text>Confirmo utilizar fondos protegidos</Text></View>}
        </> : <Text>El original se conserva y se escriben asientos opuestos.</Text>}
        <Field label="Fecha efectiva (YYYY-MM-DD)" value={effectiveDate} onChange={setEffectiveDate} />
        {mode !== 'ACCOUNT' && <Field label={mode === 'REVERSAL' || mode === 'ADJUSTMENT' ? 'Motivo obligatorio' : 'Descripción opcional'} value={description} onChange={setDescription} />}
        <Button title="Guardar" disabled={busy} onPress={() => void save()} />
        <Button title="Cancelar" disabled={busy} onPress={() => setMode(null)} />
      </View>}
      <Text style={styles.heading}>Cuentas</Text>
      {data?.accounts.map(({ account, balanceMinor }) => <View style={styles.card} key={account.id}>
        <Text>{account.name} · {account.type} · {account.availabilityPolicy} · {account.active ? 'activa' : 'inactiva'}</Text>
        <Text>{formatAmountMinor(balanceMinor, account.currency)}</Text>
        <View style={styles.row}>
          <Button title={account.active ? 'Desactivar' : 'Activar'} disabled={busy} onPress={() => void perform(() => finance.configureAccount(profileId, account.id, !account.active, account.availabilityPolicy))} />
          <Button title={account.availabilityPolicy === 'free' ? 'Proteger saldo' : 'Marcar saldo libre'} disabled={busy} onPress={() => void perform(() => finance.configureAccount(profileId, account.id, account.active, account.availabilityPolicy === 'free' ? 'protected' : 'free'))} />
          {account.active && <Button title="Ajuste" disabled={busy} onPress={() => { begin('ADJUSTMENT'); setAccountId(account.id); }} />}
        </View>
      </View>)}
      <Text style={styles.heading}>Movimientos</Text>
      {data?.transactions.slice(0, 30).map(transaction => <View style={styles.card} key={transaction.id}>
        <Text>{transaction.effectiveDate} · {transaction.subtype === 'daily' && transaction.type === 'EXPENSE' ? 'Gastos diarios' : transaction.type}</Text>
        <Text>{formatAmountMinor(transaction.entries.reduce((sum, entry) => sum + entry.debitMinor, 0), transaction.currency)}{transaction.description ? ` · ${transaction.description}` : ''}</Text>
        {transaction.splits.map(split => <Text key={split.categoryId}>{data.categories.find(row => row.id === split.categoryId)?.name}: {formatAmountMinor(split.amountMinor, transaction.currency)}</Text>)}
        {transaction.type !== 'REVERSAL' && !transaction.entries.some(entry => data?.cards.some(row => row.card.nodeId === entry.nodeId)) && <Button title={reversedIds.has(transaction.id) ? 'Revertido' : 'Revertir'} disabled={busy || reversedIds.has(transaction.id)} onPress={() => begin('REVERSAL', transaction)} />}
      </View>)}
      <Link href="/cards">Tarjetas</Link>
      <Link href="/storage-lab">Laboratorio sintético de almacenamiento</Link>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  page: { padding: 20, paddingTop: 56, gap: 16, backgroundColor: '#fff' }, heading: { fontSize: 20, fontWeight: '600' },
  card: { borderWidth: 1, borderColor: '#ddd', padding: 14, gap: 10 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  input: { borderWidth: 1, borderColor: '#aaa', padding: 10, marginTop: 4 }, choice: { padding: 10, borderWidth: 1, borderColor: '#bbb' },
  selected: { backgroundColor: '#dbeafe', borderColor: '#2563eb' }, error: { color: '#b91c1c' },
});
