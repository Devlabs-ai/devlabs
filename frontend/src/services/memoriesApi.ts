import axios from 'axios';
import { getAuthHeader } from './authApi';

export async function fetchMemoryStats(): Promise<unknown> {
  const { data } = await axios.get('/api/memories/stats', { headers: getAuthHeader() });
  return data;
}

export async function fetchCatalogue({ page = 1, limit = 20, category = '' }: {
  page?: number;
  limit?: number;
  category?: string;
} = {}): Promise<unknown> {
  const params: Record<string, string | number> = { page, limit };
  if (category) params.category = category;
  const { data } = await axios.get('/api/memories/catalogue', {
    headers: getAuthHeader(),
    params,
  });
  return data;
}

export async function fetchLessons({ page = 1, limit = 20, phase = '', category = '' }: {
  page?: number;
  limit?: number;
  phase?: string;
  category?: string;
} = {}): Promise<unknown> {
  const params: Record<string, string | number> = { page, limit };
  if (phase) params.phase = phase;
  if (category) params.category = category;
  const { data } = await axios.get('/api/memories/lessons', {
    headers: getAuthHeader(),
    params,
  });
  return data;
}
