import axios from 'axios';
import { getAuthHeader } from './authApi.js';

export async function fetchMemoryStats() {
  const { data } = await axios.get('/api/memories/stats', { headers: getAuthHeader() });
  return data;
}

export async function fetchSpecialists({ page = 1, limit = 20, category = '' } = {}) {
  const params = { page, limit };
  if (category) params.category = category;
  const { data } = await axios.get('/api/memories/specialists', {
    headers: getAuthHeader(),
    params,
  });
  return data;
}

export async function fetchLessons({ page = 1, limit = 20, phase = '', category = '' } = {}) {
  const params = { page, limit };
  if (phase) params.phase = phase;
  if (category) params.category = category;
  const { data } = await axios.get('/api/memories/lessons', {
    headers: getAuthHeader(),
    params,
  });
  return data;
}
