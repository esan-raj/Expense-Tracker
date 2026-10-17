import { useEffect } from 'react';
import { beginCriticalWork } from '@/store/useCriticalWorkStore';

export function useCriticalWork(label: string): void {
  useEffect(() => {
    const end = beginCriticalWork(label);
    return end;
  }, [label]);
}
