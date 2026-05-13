import axios from 'axios';
import { getAuthHeader } from './authApi.js';

export async function fetchChallenges() {
  const { data } = await axios.get('/api/challenges', { headers: getAuthHeader() });
  return data.challenges;
}

export async function fetchChallenge(id) {
  const { data } = await axios.get(`/api/challenges/${id}`);
  return data.challenge;
}
