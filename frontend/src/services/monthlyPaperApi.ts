import axios from 'axios';
import { getAuthHeader } from './authApi';

export interface MonthlyPaperQuestion {
  prompt: string;
  choices: string[];
}

export interface MonthlyPaperMeta {
  id: string;
  title: string;
  shortTitle: string;
  authors: string;
  venue: string;
  year: number;
  blurb: string;
  href: string;
}

export interface MonthlyPaper extends MonthlyPaperMeta {
  questions: MonthlyPaperQuestion[];
}

export interface MonthlyPaperAttempt {
  correct: number;
  total: number;
  tokens: number;
  at: number;
  review: Array<{ chosen: number | null; answer: number; explanation: string }>;
}

export interface EarlierMonthlyPaper extends MonthlyPaperMeta {
  pickedAt: number;
  score: { correct: number; total: number; tokens: number } | null;
}

export interface MonthlyPaperState {
  paper: MonthlyPaper;
  /** When an admin picked the current paper; null while the default is showing. */
  pickedAt: number | null;
  tokensPerPaper: number;
  attempt: MonthlyPaperAttempt | null;
  earlier: EarlierMonthlyPaper[];
}

export async function fetchMonthlyPaper(): Promise<MonthlyPaperState> {
  const { data } = await axios.get('/api/monthly-paper', { headers: getAuthHeader() });
  return data as MonthlyPaperState;
}

export async function submitMonthlyPaperAttempt(paperId: string, answers: number[]): Promise<MonthlyPaperAttempt> {
  const { data } = await axios.post(
    '/api/monthly-paper/attempt',
    { paperId, answers },
    { headers: getAuthHeader() },
  );
  return (data as { attempt: MonthlyPaperAttempt }).attempt;
}

export async function fetchMonthlyPaperPool(): Promise<{ currentId: string; papers: Array<{ id: string; title: string; shortTitle: string }> }> {
  const { data } = await axios.get('/api/monthly-paper/pool', { headers: getAuthHeader() });
  return data;
}

export async function pickMonthlyPaper(paperId: string): Promise<void> {
  await axios.put('/api/monthly-paper', { paperId }, { headers: getAuthHeader() });
}
