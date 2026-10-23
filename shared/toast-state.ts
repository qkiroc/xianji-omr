export interface ToastEntry {
  owner: string;
  text: string;
  expires: number;
}
export function upsertToast<T extends ToastEntry>(
  old: T[],
  incoming: Omit<T, "expires">,
  dismissed: ReadonlySet<string>,
  now: number,
): T[] {
  if (!incoming.text) return old.filter((n) => n.owner !== incoming.owner);
  if (
    dismissed.has(incoming.owner + incoming.text) ||
    old.some((n) => n.text === incoming.text && n.owner !== incoming.owner)
  )
    return old;
  const existing = old.find(
    (n) => n.owner === incoming.owner && n.text === incoming.text,
  );
  return [
    ...old.filter((n) => n.owner !== incoming.owner),
    { ...incoming, expires: existing?.expires ?? now + 10000 } as T,
  ].slice(-4);
}
