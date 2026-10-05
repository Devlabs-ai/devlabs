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

export interface PlatformLeaderboardEntry {
  rank: number;
  name: string;
  solved: number;
  papers: number;
  tokens: number;
  isMe: boolean;
}

export interface PlatformLeaderboard {
  participants: number;
  entries: PlatformLeaderboardEntry[];
  me: PlatformLeaderboardEntry | null;
}

/** Lifetime tokens across every lab and Paper of the Week quiz. */
export async function fetchPlatformLeaderboard(limit = 10): Promise<PlatformLeaderboard> {
  const { data } = await axios.get('/api/leaderboard/platform', {
    params: { limit },
    headers: getAuthHeader(),
  });
  return {
    participants: data?.participants ?? 0,
    entries: Array.isArray(data?.entries) ? data.entries : [],
    me: data?.me ?? null,
  };
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
