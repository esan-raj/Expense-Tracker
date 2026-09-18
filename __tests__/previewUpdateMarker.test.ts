/// <reference types="jest" />
import { PREVIEW_UPDATE_VERIFICATION, previewUpdateVerificationLabel } from '@/utils/previewUpdateMarker';

describe('preview OTA verification marker', () => {
  it('shows the marker only on the preview channel', () => {
    expect(previewUpdateVerificationLabel('preview')).toBe(PREVIEW_UPDATE_VERIFICATION);
    expect(previewUpdateVerificationLabel('production')).toBeNull();
    expect(previewUpdateVerificationLabel('development')).toBeNull();
    expect(previewUpdateVerificationLabel(null)).toBeNull();
    expect(previewUpdateVerificationLabel(undefined)).toBeNull();
  });
});
