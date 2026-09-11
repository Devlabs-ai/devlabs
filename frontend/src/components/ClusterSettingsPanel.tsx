import React, { useEffect, useState } from 'react';
import type { ChallengeFull, SparkPlatformSpec } from '../types/domain';
import { saveChallengeContent } from '../services/challengeApi';
import {
  LAB_AQE_OPTIONS,
  LAB_AUTO_BROADCAST_OPTIONS,
  LAB_DRIVER_CORES,
  LAB_EXECUTOR_CORES,
  LAB_EXECUTOR_COUNTS,
  LAB_MEMORY_OPTIONS,
  LAB_SHUFFLE_PARTITIONS,
  applyShufflePartitions,
  clusterDraftFromPlatform,
  formatClusterSummary,
  shufflePartitionsFromConf,
  type LabClusterDraft,
} from '../constants/sparkCluster';

function paceRows(platform: SparkPlatformSpec) {
  return platform.scoring?.executionTime?.bands || [];
}

export default function ClusterSettingsPanel({
  challengeId,
  platform,
  isAdmin,
  onSaved,
}: {
  challengeId: string;
  platform: SparkPlatformSpec;
  isAdmin: boolean;
  onSaved: (challenge: ChallengeFull) => void;
}): JSX.Element {
  const saved = clusterDraftFromPlatform(platform);
  const [draft, setDraft] = useState<LabClusterDraft>(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveFlash, setSaveFlash] = useState(false);

  useEffect(() => {
    setDraft(clusterDraftFromPlatform(platform));
  }, [platform]);

  useEffect(() => {
    if (!saveFlash) return;
    const t = window.setTimeout(() => setSaveFlash(false), 1600);
    return () => window.clearTimeout(t);
  }, [saveFlash]);

  const dirty = formatClusterSummary(draft) !== formatClusterSummary(saved);
  const shufflePartitions = shufflePartitionsFromConf(draft.sparkConf);

  const patchLimits = (partial: Partial<LabClusterDraft['limits']>) => {
    setDraft((prev) => ({
      ...prev,
      limits: { ...prev.limits, ...partial },
    }));
  };

  const patchSparkConf = (key: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      sparkConf: { ...prev.sparkConf, [key]: value },
    }));
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const { challenge } = await saveChallengeContent(challengeId, {
        tab: 'cluster',
        cluster: {
          limits: draft.limits,
          sparkConf: draft.sparkConf,
        },
      });
      onSaved(challenge);
      setSaveFlash(true);
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const bands = paceRows(platform);

  return (
    <div className="statement statement--tab play-playground-trail-pane">
      <h2>Cluster</h2>
      <hr className="statement-rule" aria-hidden="true" />
      <p className="play-playground-trail-help">
        {isAdmin
          ? 'Fixed cluster size and Spark settings for every Run and Submit. Save here — no redeploy or pack register needed.'
          : 'Cluster size and Spark settings are locked for this lab. Applied to every Run and Submit.'}
      </p>

      {isAdmin ? (
        <>
          <div className="play-playground-trail-form">
            <label className="play-playground-trail-field">
              <span>Executors</span>
              <select
                value={draft.limits.executors}
                onChange={(e) => patchLimits({ executors: Number(e.target.value) })}
              >
                {LAB_EXECUTOR_COUNTS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="play-playground-trail-field">
              <span>Executor cores</span>
              <select
                value={draft.limits.executorCores}
                onChange={(e) => patchLimits({ executorCores: Number(e.target.value) })}
              >
                {LAB_EXECUTOR_CORES.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="play-playground-trail-field">
              <span>Executor memory</span>
              <select
                value={draft.limits.executorMemory}
                onChange={(e) => patchLimits({ executorMemory: e.target.value })}
              >
                {LAB_MEMORY_OPTIONS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="play-playground-trail-field">
              <span>Driver cores</span>
              <select
                value={draft.limits.driver ?? 1}
                onChange={(e) => patchLimits({ driver: Number(e.target.value) })}
              >
                {LAB_DRIVER_CORES.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="play-playground-trail-field">
              <span>Driver memory</span>
              <select
                value={draft.limits.driverMemory || '1g'}
                onChange={(e) => patchLimits({ driverMemory: e.target.value })}
              >
                {LAB_MEMORY_OPTIONS.map((m) => (
                  <option key={`drv-${m}`} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="play-playground-trail-field">
              <span>Hard timeout (s)</span>
              <select
                value={draft.limits.hardTimeoutSeconds ?? 600}
                onChange={(e) => patchLimits({ hardTimeoutSeconds: Number(e.target.value) })}
              >
                {[90, 120, 150, 180, 240, 300, 600, 900].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="play-playground-trail-field">
              <span>AQE</span>
              <select
                value={draft.sparkConf['spark.sql.adaptive.enabled'] ?? 'false'}
                onChange={(e) => patchSparkConf('spark.sql.adaptive.enabled', e.target.value)}
              >
                {LAB_AQE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="play-playground-trail-field">
              <span>Auto broadcast join</span>
              <select
                value={draft.sparkConf['spark.sql.autoBroadcastJoinThreshold'] ?? '-1'}
                onChange={(e) =>
                  patchSparkConf('spark.sql.autoBroadcastJoinThreshold', e.target.value)
                }
              >
                {LAB_AUTO_BROADCAST_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="play-playground-trail-field">
              <span>Shuffle partitions</span>
              <select
                value={shufflePartitions}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    sparkConf: applyShufflePartitions(prev.sparkConf, Number(e.target.value)),
                  }))
                }
              >
                {LAB_SHUFFLE_PARTITIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="play-playground-trail-summary">
            <div>
              <span className="play-playground-trail-summary-label">Saved</span>
              <code>{formatClusterSummary(saved)}</code>
            </div>
            {dirty && (
              <div>
                <span className="play-playground-trail-summary-label">Draft</span>
                <code>{formatClusterSummary(draft)}</code>
              </div>
            )}
          </div>
          <div className="play-playground-trail-actions">
            <button
              type="button"
              className="spark-ide-btn spark-ide-btn--run"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saveFlash ? 'Saved' : 'Save cluster'}
            </button>
            {dirty && (
              <button
                type="button"
                className="ghost sm"
                disabled={saving}
                onClick={() => setDraft(saved)}
              >
                Discard
              </button>
            )}
          </div>
          {error && <p className="spark-brief-admin-error">{error}</p>}
        </>
      ) : (
        <ClusterReadOnly platform={platform} />
      )}

      {bands.length > 0 && (
        <section className="statement-section" style={{ marginTop: 16 }}>
          <h4>Execution pace bands</h4>
          <p className="dim" style={{ fontSize: 12, margin: '4px 0 8px' }}>
            Graded from Spark History jobs wall after a passing Submit.
          </p>
          <div className="statement-table-wrap">
            <table className="statement-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Under</th>
                </tr>
              </thead>
              <tbody>
                {bands.map((b) => (
                  <tr key={b.label}>
                    <td className="statement-table-col">{b.label}</td>
                    <td className="statement-table-type">
                      {b.maxSeconds != null ? `${b.maxSeconds}s` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function ClusterReadOnly({ platform }: { platform: SparkPlatformSpec }): JSX.Element {
  const draft = clusterDraftFromPlatform(platform);
  return (
    <>
      <div className="play-playground-trail-summary" style={{ marginBottom: 12 }}>
        <code>{formatClusterSummary(draft)}</code>
      </div>
      <div className="statement-table-wrap">
        <table className="statement-table">
          <thead>
            <tr>
              <th>Setting</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="statement-table-col">Executors</td>
              <td className="statement-table-type">{draft.limits.executors}</td>
            </tr>
            <tr>
              <td className="statement-table-col">Executor cores</td>
              <td className="statement-table-type">{draft.limits.executorCores}</td>
            </tr>
            <tr>
              <td className="statement-table-col">Executor memory</td>
              <td className="statement-table-type">{draft.limits.executorMemory}</td>
            </tr>
            <tr>
              <td className="statement-table-col">Driver</td>
              <td className="statement-table-type">
                {draft.limits.driver ?? 1} × {draft.limits.driverMemory || '1g'}
              </td>
            </tr>
            <tr>
              <td className="statement-table-col">Hard timeout</td>
              <td className="statement-table-type">{draft.limits.hardTimeoutSeconds ?? 600}s</td>
            </tr>
            {Object.entries(draft.sparkConf).map(([key, value]) => (
              <tr key={key}>
                <td className="statement-table-col"><code>{key}</code></td>
                <td className="statement-table-type"><code>{value}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
