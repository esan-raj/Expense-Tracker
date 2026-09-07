import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { AppError } from '@/utils/errors';

export async function saveAndShare(filename: string, content: string, mimeType: string): Promise<void> {
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new AppError('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(fileUri, {
    mimeType,
    dialogTitle: filename,
    UTI: mimeType === 'application/json' ? 'public.json' : 'public.comma-separated-values-text',
  });
}

export async function pickTextFile(mimeTypes: string[]): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: mimeTypes,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets[0]) {
    return null;
  }
  return FileSystem.readAsStringAsync(result.assets[0].uri);
}
