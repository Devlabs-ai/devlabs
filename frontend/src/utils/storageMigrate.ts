/** One-time rename of browser storage keys without dropping existing values. */

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readMigrating(store: Store, newKey: string, legacyKey: string): string | null {
  const current = store.getItem(newKey);
  if (current != null) {
    store.removeItem(legacyKey);
    return current;
  }
  const legacy = store.getItem(legacyKey);
  if (legacy == null) return null;
  store.setItem(newKey, legacy);
  store.removeItem(legacyKey);
  return legacy;
}

export function writeMigrating(store: Store, newKey: string, legacyKey: string, value: string): void {
  store.setItem(newKey, value);
  store.removeItem(legacyKey);
}

export function removeMigrating(store: Store, newKey: string, legacyKey: string): void {
  store.removeItem(newKey);
  store.removeItem(legacyKey);
}
