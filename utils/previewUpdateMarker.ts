export const PREVIEW_UPDATE_VERIFICATION = 'Preview update verification: 01';

export function previewUpdateVerificationLabel(channel: string | null | undefined): string | null {
  return channel === 'preview' ? PREVIEW_UPDATE_VERIFICATION : null;
}
