import { Platform } from 'react-native';

export function getPasswordResetRedirectUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/reset-password`;
  }
  return 'spendwise://reset-password';
}

export function getAuthSiteUrl(): string | null {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return null;
}
