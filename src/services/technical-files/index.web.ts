import * as DocumentPicker from 'expo-document-picker';

export async function exportSyntheticFile(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'FinanceApp_SYNTHETIC_LAB.json';
  document.body.appendChild(link); link.click(); link.remove();
  // Give the browser time to consume the URL without uploading anything.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function importSyntheticFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain'] });
  if (result.canceled) return null;
  const file = result.assets[0].file;
  if (!file) throw new Error('El navegador no entregó el archivo');
  if (file.size > 16000) throw new Error('Archivo técnico demasiado grande');
  return file.text();
}
