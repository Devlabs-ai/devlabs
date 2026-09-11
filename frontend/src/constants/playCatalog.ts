/** Play catalog taxonomy (sidebar filters + ordered challenge ids). */

import { SPARK_PLAYGROUND_CHALLENGE_ID } from './playgroundDatasets';
import { whiteboardSectionForTags, whiteboardSectionPath } from './whiteboard';

export type PlayDomainId =
  | 'data-engineer'
  | 'software-engineer'
  | 'devops-engineer'
  | 'platforms-engineer'
  | 'distributed-systems-engineer';

export type PlayPanelId = string;

export interface PlayPanel {
  id: PlayPanelId;
  label: string;
  blurb: string;
  /** Challenge ids shown under this panel (order preserved). */
  challengeIds: string[];
}

export interface PlayDomain {
  id: PlayDomainId;
  label: string;
  blurb: string;
  panels: PlayPanel[];
}

export const PLAY_DOMAINS: PlayDomain[] = [
  {
    id: 'data-engineer',
    label: 'Data Engineer',
    blurb: 'Batch and streaming pipelines, warehouses, and orchestration.',
    panels: [
      {
        id: 'spark',
        label: 'Spark',
        blurb: 'Distributed batch processing on a shared Spark platform.',
        challengeIds: [
          'l1-filter-valid-sales-rows',
          'l1-derive-revenue-column',
          'l1-sample-qa-slice',
          'l1-distinct-store-list',
          'l1-store-contribution-hours',
          'l1-store-rollup-totals',
          'l1-store-payment-profile',
          'l1-store-customer-segments',
          'l1-enrich-auth-mcc',
          'l3-interchange-fee-settlement',
          'l3-click-attribution-stream-join',
        ],
      },
      {
        id: 'airflow',
        label: 'Airflow',
        blurb: 'DAG orchestration and dependency-aware scheduling.',
        challengeIds: [],
      },
      {
        id: 'flink',
        label: 'Flink',
        blurb: 'Stateful stream processing and event-time windows.',
        challengeIds: [],
      },
    ],
  },
  {
    id: 'software-engineer',
    label: 'Software Engineer',
    blurb: 'Services, APIs, and application reliability.',
    panels: [],
  },
  {
    id: 'devops-engineer',
    label: 'DevOps Engineer',
    blurb: 'Ship and operate apps — CI/CD, containers, and Kubernetes application delivery (CKAD).',
    panels: [
      {
        id: 'kubernetes',
        label: 'Kubernetes',
        blurb: 'CKAD-style labs: deploy, configure, and troubleshoot application workloads on a shared cluster.',
        // Beginner-first order: create → expose → speed → debug → config →
        // multi → probes → rollouts → net → storage → RBAC/schedule → capstones.
        challengeIds: [
          'l1-namespace-and-pod',
          'l1-deployment-basics',
          'l1-clusterip-service',
          'l1-imperative-kubectl',
          'l1-replicaset-scale',
          'l1-debug-crashloop-pod',
          'l1-command-and-args',
          'l1-configmap-inject',
          'l1-secret-inject',
          'l1-security-context-resources',
          'l1-labels-and-selectors',
          'l1-sidecar-shared-volume',
          'l1-init-container-gate',
          'l1-readiness-liveness-probes',
          'l1-rolling-update-rollback',
          'l1-job-and-cronjob',
          'l1-troubleshoot-from-signals',
          'l1-network-policy-lockdown',
          'l1-ingress-host-path',
          'l1-pvc-mount',
          'l1-storageclass-dynamic',
          'l1-statefulset-identity',
          'l1-service-account-rbac',
          'l1-schedule-affinity',
          'l2-canary-cutover',
          'l2-app-slice-platform',
        ],
      },
    ],
  },
  {
    id: 'platforms-engineer',
    label: 'Platforms Engineer',
    blurb: 'Cluster operations and shared platform primitives — CKA-oriented Kubernetes ahead.',
    panels: [
      {
        id: 'kubernetes',
        label: 'Kubernetes',
        blurb: 'CKA-style labs: cluster install, control plane, networking, and node operations.',
        challengeIds: [],
      },
    ],
  },
  {
    id: 'distributed-systems-engineer',
    label: 'Distributed Systems Engineer',
    blurb: 'Consistency, partitioning, and failure modes at scale.',
    panels: [],
  },
];

const DOMAIN_IDS = new Set<string>(PLAY_DOMAINS.map((d) => d.id));

export function isPlayDomainId(id: string | null | undefined): id is PlayDomainId {
  return Boolean(id && DOMAIN_IDS.has(id));
}

/** True for /play/:sessionId ids (UUID or legacy spark-*), not catalog domain slugs. */
export function looksLikePlaySessionId(id: string | null | undefined): boolean {
  if (!id) return false;
  if (id.startsWith('spark-')) return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export function playCatalogPath(
  domainId?: string | null,
  panelId?: string | null,
): string {
  if (!domainId || !isPlayDomainId(domainId)) return '/play';
  if (!panelId) return `/play/${domainId}`;
  return `/play/${domainId}/${panelId}`;
}

/** Catalog membership for flat Play list (domain + panel metadata). */
export interface PlayCatalogEntry {
  challengeId: string;
  domainId: PlayDomainId;
  domainLabel: string;
  panelId: PlayPanelId;
  panelLabel: string;
}

/** Ordered catalog rows across all tracks (preserves playCatalog order). */
export function listPlayCatalogEntries(): PlayCatalogEntry[] {
  const rows: PlayCatalogEntry[] = [];
  for (const domain of PLAY_DOMAINS) {
    for (const panel of domain.panels) {
      for (const challengeId of panel.challengeIds) {
        rows.push({
          challengeId,
          domainId: domain.id,
          domainLabel: domain.label,
          panelId: panel.id,
          panelLabel: panel.label,
        });
      }
    }
  }
  return rows;
}

/** Topic chips = technology panels that have at least one lab. */
export function listPlayTopics(): Array<{ id: string; label: string; domainId: PlayDomainId; count: number }> {
  const topics: Array<{ id: string; label: string; domainId: PlayDomainId; count: number }> = [];
  for (const domain of PLAY_DOMAINS) {
    for (const panel of domain.panels) {
      if (panel.challengeIds.length === 0) continue;
      topics.push({
        id: panel.id,
        label: panel.label,
        domainId: domain.id,
        count: panel.challengeIds.length,
      });
    }
  }
  return topics;
}

/** Back to the right shelf after a session ends or fails to start. */
export function catalogPathForChallenge(
  challengeId?: string | null,
  sandboxType?: string | null,
  tags?: string[] | null,
): string {
  if (challengeId === SPARK_PLAYGROUND_CHALLENGE_ID) return '/play/spark-playground';
  if ((sandboxType || '') === 'board') {
    return whiteboardSectionPath(whiteboardSectionForTags(tags).id);
  }
  for (const domain of PLAY_DOMAINS) {
    for (const panel of domain.panels) {
      if (panel.challengeIds.includes(challengeId || '')) {
        return playCatalogPath(domain.id, panel.id);
      }
    }
  }
  return '/play';
}

export function getPlayDomain(id: PlayDomainId | null | undefined): PlayDomain | null {
  if (!id) return null;
  return PLAY_DOMAINS.find((d) => d.id === id) || null;
}

export function getPlayPanel(
  domain: PlayDomain | null | undefined,
  panelId: PlayPanelId | null | undefined,
): PlayPanel | null {
  if (!domain || !panelId) return null;
  return domain.panels.find((p) => p.id === panelId) || null;
}
// Force HMR reload - Tue Sep  1 19:19:50 IST 2026
