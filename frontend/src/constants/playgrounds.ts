/** Playground index — one free-form experiment bench per engine. */

import { PLAYGROUND_CLUSTERS, PLAYGROUND_TABLES } from './playgroundDatasets';

export const PLAYGROUNDS_PATH = '/play/playgrounds';
export const SPARK_PLAYGROUND_PATH = '/play/spark-playground';

export interface PlaygroundEntry {
  id: string;
  label: string;
  blurb: string;
  /** Destination, or null while the bench is still unbuilt. */
  to: string | null;
  /** Short facts rendered as chips on the tile. */
  facts: string[];
}

const clusterCount = PLAYGROUND_CLUSTERS.length;
const tableCount = PLAYGROUND_TABLES.length;

export const PLAYGROUNDS: PlaygroundEntry[] = [
  {
    id: 'spark',
    label: 'Spark',
    blurb:
      'Try a thought against the data clusters, dial trail resources on each Run, then promote the sweet spot into a candidate lab.',
    to: SPARK_PLAYGROUND_PATH,
    facts: [
      'PySpark on Kubernetes',
      `${clusterCount} cluster${clusterCount === 1 ? '' : 's'}`,
      `${tableCount} tables`,
    ],
  },
  {
    id: 'airflow',
    label: 'Airflow',
    blurb: 'DAG orchestration and dependency-aware scheduling.',
    to: null,
    facts: [],
  },
  {
    id: 'flink',
    label: 'Flink',
    blurb: 'Stateful stream processing and event-time windows.',
    to: null,
    facts: [],
  },
];
