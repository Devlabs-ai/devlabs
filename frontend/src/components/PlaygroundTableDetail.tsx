import React from 'react';
import {
  formatPlaygroundBytes,
  formatPlaygroundRows,
  type PlaygroundTable,
} from '../constants/playgroundDatasets';

export default function PlaygroundTableDetail({
  table,
}: {
  table: PlaygroundTable;
}): JSX.Element {
  const columns = table.schema.map((c) => c.column);
  const sampleCols = columns.filter((c) =>
    table.sampleRows.some((row) => row[c] !== undefined),
  );

  return (
    <div className="play-playground-schema-card">
      <strong>{table.label}</strong>
      <p>{table.blurb}</p>

      <dl className="play-playground-meta">
        <div>
          <dt>Kind</dt>
          <dd>{table.kind}</dd>
        </div>
        <div>
          <dt>Rows</dt>
          <dd>{formatPlaygroundRows(table.rowCount)}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatPlaygroundBytes(table.sizeBytes)}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>
            {table.format} · {table.compression}
          </dd>
        </div>
        <div>
          <dt>Files</dt>
          <dd>
            {table.fileCount} part · seed {table.seed}
          </dd>
        </div>
        <div>
          <dt>Columns</dt>
          <dd>{table.schema.length}</dd>
        </div>
        {table.timeRange && (
          <div className="play-playground-meta-wide">
            <dt>Time range</dt>
            <dd>{table.timeRange}</dd>
          </div>
        )}
        {table.joinHint && (
          <div className="play-playground-meta-wide">
            <dt>Join</dt>
            <dd>
              <code>{table.joinHint}</code>
            </dd>
          </div>
        )}
        <div className="play-playground-meta-wide">
          <dt>Path</dt>
          <dd>
            <code className="play-playground-path">{table.path}</code>
          </dd>
        </div>
      </dl>

      <h3 className="play-playground-detail-heading">Schema</h3>
      <ul className="play-playground-schema">
        {table.schema.map((col) => (
          <li key={col.column}>
            <code>{col.column}</code>
            <span>{col.type}</span>
          </li>
        ))}
      </ul>

      {sampleCols.length > 0 && (
        <>
          <h3 className="play-playground-detail-heading">Sample rows</h3>
          <div className="play-playground-sample-wrap">
            <table className="play-playground-sample">
              <thead>
                <tr>
                  {sampleCols.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.sampleRows.map((row, i) => (
                  <tr key={i}>
                    {sampleCols.map((c) => (
                      <td key={c}>
                        {row[c] === null || row[c] === undefined
                          ? '—'
                          : String(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
