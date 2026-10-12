import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { lab } from '@/database/technical/expo-adapter';
import { parseSnapshot } from '@/database/technical/lab';
import { exportSyntheticFile, importSyntheticFile } from '@/services/technical-files';

export default function StorageLabScreen() {
  const [busy, setBusy] = useState(true);
  const guard = useRef(false);
  const [status, setStatus] = useState('Abriendo base técnica…');
  const [rows, setRows] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [checks, setChecks] = useState<string[]>([]);

  async function refresh() {
    const snapshot = await lab.inspect();
    setRows(JSON.stringify(snapshot.samples, null, 2));
  }
  async function run(action: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true; setBusy(true);
    try { await action(); await refresh(); }
    catch (error) { setStatus(`ERROR: ${error instanceof Error ? error.message : 'Fallo técnico'}`); }
    finally { guard.current = false; setBusy(false); }
  }
  useEffect(() => {
    let mounted = true;
    void lab.inspect().then(snapshot => {
      if (mounted) {
        setRows(JSON.stringify(snapshot.samples, null, 2));
        setStatus('Lectura al iniciar. No se insertan datos automáticamente.');
      }
    }).catch(error => {
      if (mounted) setStatus(`ERROR: ${error instanceof Error ? error.message : 'Fallo técnico'}`);
    }).finally(() => { if (mounted) setBusy(false); });
    return () => { mounted = false; };
  }, []);

  function restore() {
    if (!pending) return;
    const action = () => void run(async () => {
      await lab.restoreText(pending); setPending(null);
      setStatus('Importación confirmada: base técnica reemplazada.');
    });
    if (Platform.OS === 'web') {
      if (window.confirm('¿Reemplazar únicamente los datos SINTÉTICOS del laboratorio?')) action();
    } else Alert.alert('Restaurar prueba sintética', 'Reemplaza únicamente la base del laboratorio.', [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Restaurar', onPress: action },
    ]);
  }
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>SQLite · Fase 2</Text>
      <Text>SOLO DATOS SINTÉTICOS. Sin cifrado. No introducir información real.</Text>
      <Text>Plataforma: {Platform.OS}</Text>
      {Platform.OS === 'web' && <Text>Web experimental. Persistencia, pestañas y carga offline requieren evaluación separada.</Text>}
      <Text selectable accessibilityLiveRegion="polite">{status}</Text>
      <View style={styles.actions}>
        <Button disabled={busy} title="Insertar muestra / incrementar marcador" onPress={() => void run(async () => {
          await lab.seed(); setStatus('Muestra sintética guardada. Anota el contador lab-persist.');
        })} />
        <Button disabled={busy} title="Leer sin insertar" onPress={() => void run(async () => { setStatus('Lectura sin modificar datos.'); })} />
        <Button disabled={busy} title="Cerrar conexión y reabrir" onPress={() => void run(async () => {
          await lab.reopen(); setStatus('Persistencia al cerrar/reabrir conexión: OK. Esto no equivale a reiniciar la app.');
        })} />
        <Button disabled={busy} title="Probar commit, rollback y foreign keys" onPress={() => void run(async () => {
          setChecks([]); setChecks(await lab.diagnose()); setStatus('Diagnóstico técnico terminado.');
        })} />
        <Button disabled={busy} title="Exportar archivo sintético" onPress={() => void run(async () => {
          await exportSyntheticFile(await lab.exportText()); setStatus('Exportación solicitada. Comprueba el archivo guardado.');
        })} />
        <Button disabled={busy} title="Seleccionar archivo para importar" onPress={() => void run(async () => {
          const text = await importSyntheticFile();
          if (text === null) { setStatus('Selección cancelada.'); return; }
          parseSnapshot(text); setPending(text); setStatus('Archivo sintético validado. Falta confirmar restauración.');
        })} />
        {pending !== null && <Button disabled={busy} title="Confirmar restauración sintética" onPress={restore} />}
      </View>
      {checks.map(check => <Text key={check}>{check}</Text>)}
      <Text style={styles.title}>Filas persistidas</Text>
      <Text selectable>{rows}</Text>
      <Text>Prueba de reinicio: inserta una muestra, anota lab-persist, cierra completamente la app (o pestaña), vuelve a abrir y entra aquí. El contador debe seguir igual sin pulsar Insertar. En Android repite sin internet una vez cargada la app; Expo Go puede necesitar Metro para recargar el código.</Text>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  page: { padding: 24, paddingTop: 56, gap: 16, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '600' },
  actions: { gap: 12 },
});
