import React, { useEffect, useMemo, useState } from 'react';
import type { ChallengeFull, ChallengePublic, SparkPlatformSpec } from '../types/domain';
import {
  saveChallengeContent,
  type ChallengeContentTab,
} from '../services/challengeApi';

const EDITABLE_TABS: ChallengeContentTab[] = [
  'description',
  'data',
  'spec',
  'knobs',
  'solution',
  'moat',
];

export function isEditableBriefTab(tab: string): tab is ChallengeContentTab {
  return (EDITABLE_TABS as string[]).includes(tab);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function specPayload(challenge: ChallengePublic | ChallengeFull, platform: SparkPlatformSpec) {
  const ps = asRecord(challenge.problemStatement);
  return {
    expectedOutput: ps.expectedOutput ?? [],
    gradeChecks: platform.gradeChecks ?? [],
    limits: platform.limits ?? {},
    sparkConf: platform.sparkConf ?? {},
    gradeKeys: platform.gradeKeys ?? [],
    outputFormat: platform.outputFormat ?? 'json',
    txnInputPath: platform.txnInputPath ?? '',
    rateInputPath: platform.rateInputPath ?? '',
    eventsInputPath: platform.eventsInputPath ?? '',
    catalogInputPath: platform.catalogInputPath ?? '',
    evalSolutionPath: platform.evalSolutionPath ?? '',
    gradeScript: platform.gradeScript ?? '',
    scoring: platform.scoring ?? {},
  };
}

function draftForTab(
  tab: ChallengeContentTab,
  challenge: ChallengePublic | ChallengeFull,
  platform: SparkPlatformSpec | null,
  solutionFiles: Record<string, string> | null,
): string {
  const ps = asRecord(challenge.problemStatement);
  if (tab === 'description') return challenge.description || '';
  if (tab === 'moat') return typeof ps.moat === 'string' ? ps.moat : '';
  if (tab === 'data') return JSON.stringify(ps.data ?? { overview: '', datasets: [] }, null, 2);
  if (tab === 'spec') {
    return JSON.stringify(specPayload(challenge, platform || ({} as SparkPlatformSpec)), null, 2);
  }
  if (tab === 'knobs') return JSON.stringify(platform?.knobs ?? [], null, 2);
  return JSON.stringify(solutionFiles ?? {}, null, 2);
}

export default function BriefAdminEditor({
  tab,
  challenge,
  platform,
  solutionFiles,
  onSaved,
  onEditingChange,
  forceEdit = false,
}: {
  tab: ChallengeContentTab;
  challenge: ChallengePublic | ChallengeFull;
  platform: SparkPlatformSpec | null;
  solutionFiles: Record<string, string> | null;
  onSaved: (next: {
    challenge: ChallengeFull;
    solutionFiles?: Record<string, string>;
  }) => void;
  onEditingChange?: (editing: boolean) => void;
  forceEdit?: boolean;
}): JSX.Element | null {
  const source = useMemo(
    () => draftForTab(tab, challenge, platform, solutionFiles),
    [tab, challenge, platform, solutionFiles],
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(source);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setError(null);
    onEditingChange?.(false);
  }, [tab, challenge.id]);

  useEffect(() => {
    if (!editing) setDraft(source);
  }, [source, editing]);

  useEffect(() => {
    if (!forceEdit) return;
    setDraft(source);
    setError(null);
    setEditing(true);
    onEditingChange?.(true);
  }, [forceEdit]);

  const formatLabel = tab === 'description' || tab === 'moat' ? 'Markdown' : 'JSON';

  const cancel = (): void => {
    setDraft(source);
    setError(null);
    setEditing(false);
    onEditingChange?.(false);
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      let body: Parameters<typeof saveChallengeContent>[1];
      if (tab === 'description' || tab === 'moat') {
        body = { tab, markdown: draft };
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(draft);
        } catch {
          setError('Invalid JSON');
          setSaving(false);
          return;
        }
        if (tab === 'data') body = { tab, data: parsed };
        else if (tab === 'spec') body = { tab, spec: parsed };
        else if (tab === 'knobs') body = { tab, knobs: parsed };
        else body = { tab, solutionFiles: parsed as Record<string, string> };
      }
      const saved = await saveChallengeContent(challenge.id, body);
      onSaved(saved);
      setEditing(false);
      onEditingChange?.(false);
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) return null;

  return (
    <div className="spark-brief-admin spark-brief-admin--open">
      <div className="spark-brief-admin-bar">
        <span className="spark-brief-admin-format">{formatLabel}</span>
        <button
          type="button"
          className="spark-ide-btn spark-ide-btn--run"
          disabled={saving || draft === source}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="ghost sm" disabled={saving} onClick={cancel}>
          Cancel
        </button>
        {error && <span className="spark-brief-admin-error">{error}</span>}
      </div>
      <textarea
        className="spark-brief-admin-editor"
        spellCheck={tab === 'description'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
    </div>
  );
}
