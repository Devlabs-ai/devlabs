import axios from 'axios';
import { getAuthHeader } from './authApi';

export interface AdminSettings {
  sparkJobWatcherEnabled: boolean;
  clusterSynced: boolean;
}

export async function fetchAdminSettings(): Promise<AdminSettings> {
  const { data } = await axios.get('/api/admin/settings', { headers: getAuthHeader() });
  return data as AdminSettings;
}

export async function saveAdminSettings(
  sparkJobWatcherEnabled: boolean,
): Promise<AdminSettings> {
  const { data } = await axios.put(
    '/api/admin/settings',
    { sparkJobWatcherEnabled },
    { headers: getAuthHeader() },
  );
  return data as AdminSettings;
}
