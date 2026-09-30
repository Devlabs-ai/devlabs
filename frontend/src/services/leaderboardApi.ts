import axios from 'axios';
import { getAuthHeader } from './authApi';

export interface LeaderboardEntry {
  rank: number;
  name: string;
  solved: number;
  tokens: number;
  lastSolvedAt: number | null;
  isMe: boolean;
}

export interface Leaderboard {
  totalLabs: number;
  participants: number;
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
}

export async function fetchTrackLeaderboard(challengeIds: string[], limit?: number): Promise<Leaderboard> {
  const { data } = await axios.get('/api/leaderboard', {
    params: { challengeIds: challengeIds.join(','), ...(limit ? { limit } : {}) },
    headers: getAuthHeader(),
  });
  return {
    totalLabs: data?.totalLabs ?? challengeIds.length,
    participants: data?.participants ?? 0,
    entries: Array.isArray(data?.entries) ? data.entries : [],
    me: data?.me ?? null,
  };
}
