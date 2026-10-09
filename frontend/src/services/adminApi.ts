import axios from 'axios';
import { getAuthHeader } from './authApi';
import type { UserRecord } from '../types/domain';
import type { UserRole } from '../constants/roles';

export interface AdminSettings {
  sparkJobWatcherEnabled: boolean;
  clusterSynced: boolean;
  registrationOpen: boolean;
}

export type AdminUserStatus = 'pending' | 'active' | 'rejected';

export interface AdminUser extends UserRecord {
  status: AdminUserStatus;
  role: UserRole;
  reviewTracks: string[];
}

export interface ApproveUserInput {
  role?: UserRole;
  reviewTracks?: string[];
}

export async function fetchAdminSettings(): Promise<AdminSettings> {
  const { data } = await axios.get('/api/admin/settings', { headers: getAuthHeader() });
  return data as AdminSettings;
}

export async function saveAdminSettings(patch: {
  sparkJobWatcherEnabled?: boolean;
  registrationOpen?: boolean;
}): Promise<AdminSettings> {
  const { data } = await axios.put('/api/admin/settings', patch, {
    headers: getAuthHeader(),
  });
  return data as AdminSettings;
}

export async function fetchAdminUsers(status?: AdminUserStatus): Promise<AdminUser[]> {
  const { data } = await axios.get('/api/admin/users', {
    headers: getAuthHeader(),
    params: status ? { status } : undefined,
  });
  return ((data as { users?: AdminUser[] }).users || []) as AdminUser[];
}

export async function approveAdminUser(
  userId: string,
  input: ApproveUserInput = {},
): Promise<AdminUser> {
  const { data } = await axios.post(
    `/api/admin/users/${encodeURIComponent(userId)}/approve`,
    {
      role: input.role || 'learner',
      reviewTracks: input.reviewTracks || [],
    },
    { headers: getAuthHeader() },
  );
  return (data as { user: AdminUser }).user;
}

export async function updateAdminUserRole(
  userId: string,
  input: ApproveUserInput,
): Promise<AdminUser> {
  const { data } = await axios.patch(
    `/api/admin/users/${encodeURIComponent(userId)}`,
    {
      role: input.role,
      reviewTracks: input.reviewTracks || [],
    },
    { headers: getAuthHeader() },
  );
  return (data as { user: AdminUser }).user;
}

export async function rejectAdminUser(userId: string): Promise<AdminUser> {
  const { data } = await axios.post(
    `/api/admin/users/${encodeURIComponent(userId)}/reject`,
    {},
    { headers: getAuthHeader() },
  );
  return (data as { user: AdminUser }).user;
}

export interface AdminFeedbackItem {
  id: string;
  challengeId: string;
  challengeTitle: string | null;
  category: string | null;
  sandboxType: string | null;
  visibleTo: string | null;
  body: string;
  createdAt: number;
  updatedAt: number;
  authorId: string;
  authorEmail: string | null;
  authorName: string | null;
  authorRole: string;
}

export async function fetchAdminFeedback(): Promise<AdminFeedbackItem[]> {
  const { data } = await axios.get('/api/admin/feedback', { headers: getAuthHeader() });
  return ((data as { feedback?: AdminFeedbackItem[] }).feedback || []) as AdminFeedbackItem[];
}
