let revision = 0;

export function bumpFinanceRevision(): void {
  revision += 1;
}

export function getFinanceRevision(): number {
  return revision;
}

export function resetFinanceRevisionForTests(): void {
  revision = 0;
}
