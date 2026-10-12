import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function exportSyntheticFile(text: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Compartir archivos no está disponible');
  const file = new File(Paths.cache, 'FinanceApp_SYNTHETIC_LAB.json');
  file.create({ overwrite: true });
  try {
    file.write(text);
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Backup SINTÉTICO de prueba' });
  } finally { if (file.exists) file.delete(); }
}
export async function importSyntheticFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain'], copyToCacheDirectory: true });
  if (result.canceled) return null;
  const file = new File(result.assets[0].uri);
  try {
    if (file.size > 16000) throw new Error('Archivo técnico demasiado grande');
    return await file.text();
  } finally { if (file.exists) file.delete(); }
}
