import axios from 'axios';
import type { ChallengePublic, ChallengeFull } from '../types/domain';
import { getAuthHeader } from './authApi';

export async function fetchChallenges(): Promise<ChallengePublic[]> {
  const { data } = await axios.get('/api/challenges', { headers: getAuthHeader() });
  return (data as { challenges: ChallengePublic[] }).challenges;
}

export async function fetchChallenge(id: string): Promise<ChallengeFull> {
  const { data } = await axios.get(`/api/challenges/${id}`, { headers: getAuthHeader() });
  return (data as { challenge: ChallengeFull }).challenge;
}

export interface ChallengeSolutionPayload {
  challengeId: string;
  entrypoint: string;
  files: Record<string, string>;
}

/** Reference solution from MinIO challenges/<id>/solution/. */
export async function fetchChallengeSolution(id: string): Promise<ChallengeSolutionPayload> {
  const { data } = await axios.get(`/api/challenges/${id}/solution`, {
    headers: getAuthHeader(),
  });
  return data as ChallengeSolutionPayload;
}

export interface SolutionStatus {
  challengeId: string;
  tokens: number;
  penaltyPct: number;
  tokensAfterPenalty: number;
  solved: boolean;
  viewedAt: number | null;
  /** Opening the solution now would (or already did) cut this lab's tokens. */
  penalized: boolean;
  practice: boolean;
}

export async function fetchSolutionStatus(id: string): Promise<SolutionStatus> {
  const { data } = await axios.get(`/api/challenges/${encodeURIComponent(id)}/solution-status`, {
    headers: getAuthHeader(),
  });
  return data as SolutionStatus;
}

/** Records the first solution view (drives the token penalty). */
export async function recordSolutionView(id: string): Promise<SolutionStatus> {
  const { data } = await axios.post(
    `/api/challenges/${encodeURIComponent(id)}/solution-view`,
    {},
    { headers: getAuthHeader() },
  );
  return data as SolutionStatus;
}

export type ChallengeContentTab =
  | 'description'
  | 'theory'
  | 'data'
  | 'spec'
  | 'cluster'
  | 'knobs'
  | 'solution'
  | 'moat';

export async function saveChallengeContent(
  id: string,
  body: {
    tab: ChallengeContentTab;
    markdown?: string;
    data?: unknown;
    spec?: unknown;
    cluster?: {
      limits?: unknown;
      sparkConf?: Record<string, string>;
      scoring?: unknown;
    };
    knobs?: unknown;
    solutionFiles?: Record<string, string>;
  },
): Promise<{ challenge: ChallengeFull; solutionFiles?: Record<string, string> }> {
  const { data } = await axios.put(`/api/challenges/${id}/content`, body, {
    headers: getAuthHeader(),
  });
  return data as { challenge: ChallengeFull; solutionFiles?: Record<string, string> };
}

export type ChallengeVisibleTo = 'admin' | 'users' | 'reviewers';

/** True where visibility + tokens come from the deployed packs (EC2) and can't be edited. */
export async function fetchCatalogSettingsLocked(): Promise<boolean> {
  const { data } = await axios.get('/api/challenges/catalog-settings', {
    headers: getAuthHeader(),
  });
  return Boolean((data as { locked?: boolean }).locked);
}

export async function saveChallengeVisibility(
  id: string,
  visibleTo: ChallengeVisibleTo,
  visibilityNotes?: string,
  tokens?: number,
): Promise<{
  id: string;
  visibleTo: ChallengeVisibleTo;
  visibilityNotes: string;
  tokens: number;
}> {
  const { data } = await axios.put(
    `/api/challenges/${encodeURIComponent(id)}/visibility`,
    { visibleTo, visibilityNotes, tokens },
    { headers: getAuthHeader() },
  );
  return (data as {
    challenge: {
      id: string;
      visibleTo: ChallengeVisibleTo;
      visibilityNotes: string;
      tokens: number;
    };
  }).challenge;
}

export interface ChallengeReview {
  id: string;
  challengeId: string;
  authorId: string;
  authorEmail: string | null;
  authorName: string | null;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export async function fetchChallengeReviews(id: string): Promise<ChallengeReview[]> {
  const { data } = await axios.get(`/api/challenges/${encodeURIComponent(id)}/reviews`, {
    headers: getAuthHeader(),
  });
  return ((data as { reviews?: ChallengeReview[] }).reviews || []) as ChallengeReview[];
}

export async function postChallengeReview(
  id: string,
  body: string,
): Promise<ChallengeReview> {
  const { data } = await axios.post(
    `/api/challenges/${encodeURIComponent(id)}/reviews`,
    { body },
    { headers: getAuthHeader() },
  );
  return (data as { review: ChallengeReview }).review;
}

export async function deleteChallengeReview(
  challengeId: string,
  reviewId: string,
): Promise<void> {
  await axios.delete(
    `/api/challenges/${encodeURIComponent(challengeId)}/reviews/${encodeURIComponent(reviewId)}`,
    { headers: getAuthHeader() },
  );
}
