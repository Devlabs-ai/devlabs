import axios from 'axios';
import { getAuthHeader } from './authApi';
import type { ActivityDay } from '../components/ActivityHeatmap';

export interface MyProfile {
  avatar: string | null;
  activity: ActivityDay[];
}

export async function fetchMyProfile(): Promise<MyProfile> {
  const { data } = await axios.get('/api/profile/me', {
    params: { tz: new Date().getTimezoneOffset() },
    headers: getAuthHeader(),
  });
  return {
    avatar: data?.avatar ?? null,
    activity: Array.isArray(data?.activity) ? data.activity : [],
  };
}

export async function saveAvatar(avatar: string | null): Promise<string | null> {
  const { data } = await axios.put('/api/profile/avatar', { avatar }, { headers: getAuthHeader() });
  return data?.avatar ?? null;
}
