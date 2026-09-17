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
          'k8s-02-scale-out-with-a-replicaset',
          'k8s-03-roll-forward-with-a-deployment',
          'k8s-04-stable-address-for-payment-handler',
          'k8s-05-expose-order-processor-for-qa',
          'k8s-06-config-without-rebuilding-images',
          'k8s-07-keep-credentials-in-a-secret',
          'k8s-08-audit-trail-with-a-sidecar',
          'k8s-09-migrate-schema-before-the-app-starts',
          'k8s-10-firewall-rules-between-order-and-payment',
          'k8s-11-cap-order-processor-cpu-and-memory',
          'k8s-12-restart-dead-order-processor-pods',
          'k8s-13-keep-broken-pods-out-of-the-service',
          'k8s-14-give-slow-starters-time-to-boot',
          'k8s-15-lock-down-payment-handler-process',
          'k8s-16-identity-for-settlement-export',
          'k8s-17-run-settlement-export-as-a-job',
          'k8s-19-claim-disk-for-order-processor',
          'k8s-20-stateful-orders-database',
          'k8s-21-discover-each-database-pod-by-name',
          'k8s-22-dynamic-disks-via-storageclass',
          'k8s-23-local-disk-for-hot-payment-writes',
          'k8s-24-snapshot-and-restore-order-archives',
          'k8s-25-pin-payment-handler-to-payment-nodes',
          'k8s-26-prefer-notification-nodes-softly',
          'k8s-27-colocate-notifications-near-orders',
          'k8s-28-spread-payment-replicas-across-nodes',
          'k8s-29-only-payments-on-tainted-pci-nodes',
          'k8s-30-canary-the-notification-service',
          'k8s-31-blue-green-cutover-for-payment-handler',
          'k8s-32-package-notification-service-with-helm',
          'k8s-33-one-chart-staging-and-prod-values',
          'k8s-34-nightly-order-reconciliation-job',
          'k8s-35-encrypt-service-to-service-traffic',
          'k8s-36-one-front-door-for-qa-and-partners',
          'k8s-37-scale-notifications-with-load',
          'k8s-38-right-size-payment-handler-resources',
          'k8s-39-keep-enough-payments-during-node-drains',
          'k8s-40-roll-forward-and-undo-order-processor',
          'k8s-41-rescue-crashlooping-notifications',
          'k8s-42-ship-notification-templates-as-files',
          'k8s-43-drain-order-processor-without-dropping-inflight'
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
