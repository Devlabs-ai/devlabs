/** Play homepage taxonomy: domain → technology panel → challenge ids. */

export type PlayDomainId =
  | 'data-engineer'
  | 'software-engineer'
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
        challengeIds: ['daily-product-sales-pipeline-l1'],
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
    id: 'platforms-engineer',
    label: 'Platforms Engineer',
    blurb: 'Kubernetes, CI/CD, and shared platform primitives.',
    panels: [],
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

/** Deep-link back to the panel that lists this challenge (or /play). */
export function catalogPathForChallenge(challengeId: string | null | undefined): string {
  if (!challengeId) return '/play';
  for (const domain of PLAY_DOMAINS) {
    for (const panel of domain.panels) {
      if (panel.challengeIds.includes(challengeId)) {
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
