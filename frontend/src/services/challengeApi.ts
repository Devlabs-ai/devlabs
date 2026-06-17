import axios from 'axios';
import type { ChallengePublic, ChallengeFull } from '../types/domain';
import { getAuthHeader } from './authApi';

export async function fetchChallenges(): Promise<ChallengePublic[]> {
  const { data } = await axios.get('/api/challenges', { headers: getAuthHeader() });
  return (data as { challenges: ChallengePublic[] }).challenges;
}

export async function fetchChallenge(id: string): Promise<ChallengeFull> {
  const { data } = await axios.get(`/api/challenges/${id}`);
  return (data as { challenge: ChallengeFull }).challenge;
}
