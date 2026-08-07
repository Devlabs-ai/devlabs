import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteWorkspaceFile,
  putWorkspaceFile,
  renameWorkspaceFile,
} from '../services/workspaceApi';

/** Idle debounce before persisting content edits (ms). */
export const WORKSPACE_SYNC_DEBOUNCE_MS = 2000;

export type WorkspaceSyncStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

interface UseWorkspaceSyncArgs {
  sessionId: string | null | undefined;
  enabled: boolean;
}

export function useWorkspaceSync({
  sessionId,
  enabled,
}: UseWorkspaceSyncArgs): {
  syncStatus: WorkspaceSyncStatus;
  syncError: string | null;
  /** Call after hydrate/seed so baseline matches server. */
  resetBaseline: (files: Record<string, string>) => void;
  /** Debounced content persist (2s idle). */
  trackContentChange: (path: string, content: string) => void;
  flush: () => Promise<void>;
  notifyCreated: (path: string, content: string) => void;
  notifyDeleted: (path: string) => void;
  notifyRenamed: (from: string, to: string) => void;
} {
  const [syncStatus, setSyncStatus] = useState<WorkspaceSyncStatus>(enabled ? 'idle' : 'offline');
  const [syncError, setSyncError] = useState<string | null>(null);

  const lastSavedRef = useRef<Record<string, string>>({});
  const latestContentRef = useRef<Record<string, string>>({});
  const timersRef = useRef<Record<string, number>>({});
  const structuralQueue = useRef<Promise<void>>(Promise.resolve());

  const canSync = Boolean(enabled && sessionId);

  useEffect(() => {
    if (!canSync) setSyncStatus('offline');
  }, [canSync]);

  const resetBaseline = useCallback((files: Record<string, string>) => {
    lastSavedRef.current = { ...files };
    latestContentRef.current = { ...files };
    setSyncStatus(canSync ? 'saved' : 'offline');
    setSyncError(null);
  }, [canSync]);

  const saveContent = useCallback(async (path: string, content: string): Promise<void> => {
    if (!sessionId) return;
    setSyncStatus('saving');
    setSyncError(null);
    try {
      await putWorkspaceFile(sessionId, path, content);
      lastSavedRef.current[path] = content;
      const pending = Object.keys(timersRef.current).length;
      setSyncStatus(pending ? 'saving' : 'saved');
    } catch (e) {
      const err = e as { message?: string };
      setSyncError(err.message || 'Failed to save');
      setSyncStatus('error');
      throw e;
    }
  }, [sessionId]);

  const trackContentChange = useCallback((path: string, content: string) => {
    latestContentRef.current[path] = content;
    if (!canSync || !sessionId) return;
    if (lastSavedRef.current[path] === content) return;

    const existing = timersRef.current[path];
    if (existing) window.clearTimeout(existing);
    setSyncStatus('saving');
    timersRef.current[path] = window.setTimeout(() => {
      delete timersRef.current[path];
      void saveContent(path, content);
    }, WORKSPACE_SYNC_DEBOUNCE_MS);
  }, [canSync, sessionId, saveContent]);

  const flush = useCallback(async () => {
    if (!sessionId || !canSync) return;
    for (const t of Object.values(timersRef.current)) window.clearTimeout(t);
    timersRef.current = {};
    const jobs: Promise<void>[] = [];
    for (const [path, content] of Object.entries(latestContentRef.current)) {
      if (lastSavedRef.current[path] !== content) {
        jobs.push(saveContent(path, content ?? ''));
      }
    }
    await Promise.all(jobs);
  }, [sessionId, canSync, saveContent]);

  const enqueueStructural = useCallback((fn: () => Promise<void>) => {
    structuralQueue.current = structuralQueue.current.then(fn).catch((e) => {
      const err = e as { message?: string };
      setSyncError(err.message || 'Workspace sync failed');
      setSyncStatus('error');
    });
  }, []);

  const notifyCreated = useCallback((path: string, content: string) => {
    latestContentRef.current[path] = content;
    lastSavedRef.current[path] = content;
    if (!canSync || !sessionId) return;
    enqueueStructural(async () => {
      setSyncStatus('saving');
      await putWorkspaceFile(sessionId, path, content);
      setSyncStatus('saved');
    });
  }, [canSync, sessionId, enqueueStructural]);

  const notifyDeleted = useCallback((path: string) => {
    delete latestContentRef.current[path];
    delete lastSavedRef.current[path];
    const t = timersRef.current[path];
    if (t) {
      window.clearTimeout(t);
      delete timersRef.current[path];
    }
    if (!canSync || !sessionId) return;
    enqueueStructural(async () => {
      setSyncStatus('saving');
      await deleteWorkspaceFile(sessionId, path);
      setSyncStatus('saved');
    });
  }, [canSync, sessionId, enqueueStructural]);

  const notifyRenamed = useCallback((from: string, to: string) => {
    if (latestContentRef.current[from] != null) {
      latestContentRef.current[to] = latestContentRef.current[from];
      delete latestContentRef.current[from];
    }
    if (lastSavedRef.current[from] != null) {
      lastSavedRef.current[to] = lastSavedRef.current[from];
      delete lastSavedRef.current[from];
    }
    if (!canSync || !sessionId) return;
    enqueueStructural(async () => {
      setSyncStatus('saving');
      await renameWorkspaceFile(sessionId, from, to);
      setSyncStatus('saved');
    });
  }, [canSync, sessionId, enqueueStructural]);

  useEffect(() => () => {
    for (const t of Object.values(timersRef.current)) window.clearTimeout(t);
  }, []);

  return {
    syncStatus,
    syncError,
    resetBaseline,
    trackContentChange,
    flush,
    notifyCreated,
    notifyDeleted,
    notifyRenamed,
  };
}
