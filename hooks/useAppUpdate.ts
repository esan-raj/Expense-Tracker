import { useCallback } from 'react';
import { appUpdateController, useAppUpdateStore } from '@/services/appUpdate';
import type { ReloadDecision, UpdateCheckSource } from '@/services/appUpdate/types';

export function useAppUpdate() {
  const state = useAppUpdateStore();

  const check = useCallback((source: UpdateCheckSource = 'manual') => appUpdateController.check(source), []);
  const download = useCallback(() => appUpdateController.download(), []);
  const apply = useCallback((): Promise<ReloadDecision> => appUpdateController.apply(), []);
  const dismiss = useCallback(() => appUpdateController.dismissBanner(), []);
  const dismissPrompt = useCallback(() => appUpdateController.dismissPrompt(), []);

  return {
    ...state,
    check,
    download,
    apply,
    dismiss,
    dismissPrompt,
  };
}
