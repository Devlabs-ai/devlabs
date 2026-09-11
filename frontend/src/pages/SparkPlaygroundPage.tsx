import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import PlaygroundClusterPanel from '../components/PlaygroundClusterPanel';
import {
  PLAYGROUND_CLUSTERS,
  getPlaygroundTable,
} from '../constants/playgroundDatasets';
import { PLAYGROUNDS_PATH } from '../constants/playgrounds';
import { useAppState } from '../context/AppStateContext';

export const SPARK_PLAYGROUND_OPEN_PATH = '/play/spark-playground/open';

export default function SparkPlaygroundPage(): JSX.Element {
  const { startError } = useAppState();
  const [schemaId, setSchemaId] = useState<string | null>(null);

  const schemaTable = getPlaygroundTable(schemaId);

  return (
    <div className="app-page play-problems-page">
      <header className="play-problems-hero">
        <div className="play-problems-hero-copy">
          <p className="play-papers-crumb">
            <Link to="/play">Play</Link>
            <span aria-hidden> / </span>
            <Link to={PLAYGROUNDS_PATH}>Playgrounds</Link>
            <span aria-hidden> / </span>
            <span>Spark</span>
          </p>
          <h1 className="play-problems-title">Spark Playground</h1>
          <p className="play-problems-lead">
            Experiment bench for challenge design. Try thoughts against data clusters, dial trail
            resources on each Run, and promote the sweet spot into a candidate lab. Clusters are
            logical only — cross-cluster joins are fine.
          </p>
        </div>
        <Link
          to={SPARK_PLAYGROUND_OPEN_PATH}
          className="spark-ide-btn spark-ide-btn--run play-playground-open-btn"
        >
          Open playground
        </Link>
      </header>

      {startError && <div className="alert error">{startError}</div>}

      <section className="play-playground-section">
        <h2 className="play-playground-section-title">
          Data clusters
          <span className="play-playground-section-note">
            Logical groupings for ideation — join across clusters anytime
          </span>
        </h2>

        {PLAYGROUND_CLUSTERS.map((cluster, i) => (
          <PlaygroundClusterPanel
            key={cluster.id}
            cluster={cluster}
            defaultOpen={i === 0}
            selectedTableId={schemaId}
            onSelectTable={setSchemaId}
            selectedTable={schemaTable}
          />
        ))}
      </section>
    </div>
  );
}
