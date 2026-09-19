import { useCallback } from 'react';
import { appUpdateController, useAppUpdateStore } from '@/services/appUpdate';
import type { ReloadDecision, UpdateCheckSource } from '@/services/appUpdate/types';

export function useAppUpdate() {
  const state = useAppUpdateStore();

  const check = useCallback((source: UpdateCheckSource = 'manual') => appUpdateController.check(source), []);
  const apply = useCallback((): Promise<ReloadDecision> => appUpdateController.apply(), []);
  const dismiss = useCallback(() => appUpdateController.dismissBanner(), []);

  return {
    ...state,
    check,
    apply,
    dismiss,
  };
}
