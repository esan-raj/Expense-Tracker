import { useCallback, useEffect, useState } from 'react';
import { reportService } from '@/services/reportService';
import { getDateRange, type DateRange, type DateRangePreset } from '@/utils/dates';
import { toUserMessage } from '@/utils/errors';

export function useReports(initial: DateRangePreset = 'this_month') {
  const [preset, setPreset] = useState<DateRangePreset>(initial);
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [accountId, setAccountId] = useState<string | undefined>();
  const [data, setData] = useState<Awaited<ReturnType<typeof reportService.analytics>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const range = getDateRange(preset, custom);
      const result = await reportService.analytics(range, accountId);
      setData(result);
    } catch (err) {
      setError(toUserMessage(err, 'We could not load your reports.'));
    } finally {
      setLoading(false);
    }
  }, [preset, custom, accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { preset, setPreset, custom, setCustom, accountId, setAccountId, data, loading, error, reload: load };
}
