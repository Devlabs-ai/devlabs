import axios from 'axios';
import { getAuthHeader } from './authApi.js';

export async function listReviews() {
  const { data } = await axios.get('/api/reviews', { headers: getAuthHeader() });
  return data.reviews;
}

export async function getReview(sessionId) {
  const { data } = await axios.get(`/api/reviews/${sessionId}`, { headers: getAuthHeader() });
  return data.review;
}

export async function pushReview(sessionId) {
  const { data } = await axios.post(
    `/api/reviews/${sessionId}/push`,
    {},
    { headers: getAuthHeader() },
  );
  return data;
}

export async function dismissReview(sessionId) {
  const { data } = await axios.delete(`/api/reviews/${sessionId}`, { headers: getAuthHeader() });
  return data;
}
