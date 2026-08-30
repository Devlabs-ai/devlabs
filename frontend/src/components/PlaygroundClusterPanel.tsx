import React, { useState } from 'react';
import PlaygroundTableDetail from './PlaygroundTableDetail';
import {
  PLAYGROUND_CATEGORY_LABEL,
  formatPlaygroundBytes,
  formatPlaygroundRows,
  type PlaygroundCluster,
  type PlaygroundTable,
} from '../constants/playgroundDatasets';

type PlaygroundClusterPanelProps = {
  cluster: PlaygroundCluster;
  /** Start expanded (default true for the first / only cluster). */
  defaultOpen?: boolean;
  selectedTableId: string | null;
  onSelectTable: (tableId: string | null) => void;
  selectedTable: PlaygroundTable | null;
  /** denser layout for the workspace brief panel */
  compact?: boolean;
};

export default function PlaygroundClusterPanel({
  cluster,
  defaultOpen = true,
  selectedTableId,
  onSelectTable,
  selectedTable,
  compact = false,
}: PlaygroundClusterPanelProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const detailOpen =
    Boolean(selectedTable) && cluster.tables.some((t) => t.id === selectedTable?.id);

  return (
    <details
      className={`play-playground-cluster${compact ? ' play-playground-cluster--compact' : ''}`}
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(next);
        if (!next && detailOpen) onSelectTable(null);
      }}
    >
      <summary className="play-playground-cluster-summary">
        <span className="play-playground-cluster-summary-main">
          <span className="play-playground-cluster-chevron" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
          <span className="play-playground-cluster-titles">
            <span className="play-playground-cluster-name">{cluster.name}</span>
            {!compact && (
              <span className="play-playground-cluster-blurb">{cluster.blurb}</span>
            )}
          </span>
        </span>
        <span className="play-playground-cluster-tags">
          <span className="play-playground-tag play-playground-tag--category">
            {PLAYGROUND_CATEGORY_LABEL[cluster.category]}
          </span>
          {!compact &&
            cluster.tags.map((tag) => (
              <span key={tag} className="play-playground-tag">
                {tag}
              </span>
            ))}
        </span>
      </summary>

      <div className="play-playground-cluster-body">
        {!compact && (
          <p className="play-playground-cluster-prefix">
            MinIO · <code>{cluster.prefix}/</code>
          </p>
        )}

        {compact ? (
          <ul className="play-playground-ref-list">
            {cluster.tables.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={`play-playground-ref-item${selectedTableId === t.id ? ' is-open' : ''}`}
                  onClick={() =>
                    onSelectTable(selectedTableId === t.id ? null : t.id)
                  }
                >
                  <span className="play-playground-ref-label">{t.label}</span>
                  <code className="play-playground-path">{t.path}</code>
                  {t.joinHint && (
                    <span className="play-playground-ref-join">{t.joinHint}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="play-playground-catalog">
            <table>
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Kind</th>
                  <th>Rows</th>
                  <th>Size</th>
                  <th>MinIO path</th>
                  <th>Join</th>
                </tr>
              </thead>
              <tbody>
                {cluster.tables.map((t) => (
                  <tr
                    key={t.id}
                    className={t.id === selectedTableId ? 'is-selected' : undefined}
                  >
                    <td>
                      <button
                        type="button"
                        className="play-playground-catalog-link"
                        onClick={() =>
                          onSelectTable(selectedTableId === t.id ? null : t.id)
                        }
                      >
                        {t.label}
                      </button>
                    </td>
                    <td>{t.kind}</td>
                    <td>{formatPlaygroundRows(t.rowCount)}</td>
                    <td>{formatPlaygroundBytes(t.sizeBytes)}</td>
                    <td>
                      <code className="play-playground-path">{t.path}</code>
                    </td>
                    <td className="play-playground-join">
                      {t.joinHint ? <code>{t.joinHint}</code> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {detailOpen && selectedTable && (
          <PlaygroundTableDetail table={selectedTable} />
        )}
      </div>
    </details>
  );
}
