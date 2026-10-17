import type { HomeDashboardSnapshot } from '@/services/dashboardSnapshot';

let seed: HomeDashboardSnapshot | null = null;

export function setDashboardSeed(next: HomeDashboardSnapshot | null): void {
  seed = next;
}

export function peekDashboardSeed(userKey: string, periodKey: string): HomeDashboardSnapshot | null {
  if (!seed) return null;
  if (seed.userKey !== userKey || seed.periodKey !== periodKey) return null;
  return seed;
}

export function clearDashboardSeed(): void {
  seed = null;
}
