import axios from 'axios';
import { getAuthHeader } from './authApi';
import type { ActivityDay } from '../components/ActivityHeatmap';

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
  id: string;
  rank: number;
  name: string;
  avatar: string | null;
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

export interface LearnerProfile extends PlatformLeaderboardEntry {
  participants: number;
  activity: ActivityDay[];
  solvedLabs: { title: string; difficulty: string | null; tokens: number; solvedAt: number | null }[];
  paperQuizzes: { title: string; correct: number; total: number; tokens: number; takenAt: number | null }[];
}

export async function fetchLearnerProfile(id: string): Promise<LearnerProfile> {
  const { data } = await axios.get(`/api/leaderboard/platform/${encodeURIComponent(id)}`, {
    params: { tz: new Date().getTimezoneOffset() },
    headers: getAuthHeader(),
  });
  return {
    ...data,
    activity: Array.isArray(data?.activity) ? data.activity : [],
    solvedLabs: Array.isArray(data?.solvedLabs) ? data.solvedLabs : [],
    paperQuizzes: Array.isArray(data?.paperQuizzes) ? data.paperQuizzes : [],
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
