import axios from 'axios';
import { getAuthHeader } from './authApi';

export type NotifyKind = 'major' | 'minor';

export const notifyKey = (kind: NotifyKind, itemId: string): string => `${kind}:${itemId}`;

/** Items the signed-in user asked to be notified about, as "kind:id". */
export async function fetchNotifyItems(): Promise<Set<string>> {
  const { data } = await axios.get('/api/notify', { headers: getAuthHeader() });
  return new Set((data as { items?: string[] }).items || []);
}

export async function setNotify(kind: NotifyKind, itemId: string, on: boolean): Promise<void> {
  const body = { kind, itemId };
  if (on) await axios.post('/api/notify', body, { headers: getAuthHeader() });
  else await axios.delete('/api/notify', { data: body, headers: getAuthHeader() });
}
