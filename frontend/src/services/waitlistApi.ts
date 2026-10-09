import axios from 'axios';
import { getAuthHeader } from './authApi';

export type WaitlistRole = 'student' | 'developer';

export interface WaitlistSignup {
  email: string;
  role: WaitlistRole;
  organization: string | null;
  source: string | null;
  createdAt: number;
}

export async function joinWaitlist(input: {
  email: string;
  role: WaitlistRole;
  organization?: string;
  source?: string;
  website?: string;
}): Promise<void> {
  await axios.post('/api/waitlist', input);
}

export async function deleteWaitlistSignup(email: string): Promise<void> {
  await axios.delete(`/api/waitlist/${encodeURIComponent(email)}`, { headers: getAuthHeader() });
}

export async function fetchWaitlist(): Promise<WaitlistSignup[]> {
  const { data } = await axios.get('/api/waitlist', { headers: getAuthHeader() });
  return ((data as { signups?: WaitlistSignup[] }).signups || []) as WaitlistSignup[];
}
