type CriticalListener = () => void;

let count = 0;
const listeners = new Set<CriticalListener>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function beginCriticalWork(_label: string): () => void {
  count += 1;
  notify();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    count = Math.max(0, count - 1);
    notify();
  };
}

export function isCriticalWorkActive(): boolean {
  return count > 0;
}

export function getCriticalWorkCount(): number {
  return count;
}

export function subscribeCriticalWork(listener: CriticalListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetCriticalWork(): void {
  count = 0;
  notify();
}
