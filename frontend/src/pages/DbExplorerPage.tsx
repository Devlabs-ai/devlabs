import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AppPageHeader from '../components/AppPageHeader';
import {
  fetchDbTableRows,
  fetchDbTables,
  type DbColumnMeta,
  type DbTableMeta,
  type DbTableRowsResult,
} from '../services/devDbApi';

const PAGE_SIZE = 50;

function formatCell(value: unknown, dataType: string): string {
  if (value == null) return '—';
  if (value === '[embedding]') return '⟨vector⟩';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length > 120 ? `${json.slice(0, 117)}…` : json;
  }
  const text = String(value);
  if (dataType.includes('timestamp') || dataType === 'bigint') {
    const n = Number(text);
    if (Number.isFinite(n) && n > 1_000_000_000_000) {
      return new Date(n).toLocaleString();
    }
  }
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

function cellClass(value: unknown, dataType: string): string {
  if (value == null) return 'db-cell db-cell--null';
  if (dataType === 'jsonb' || dataType === 'json') return 'db-cell db-cell--json';
  if (dataType.includes('timestamp') || dataType === 'bigint') return 'db-cell db-cell--time';
  if (typeof value === 'boolean') return 'db-cell db-cell--bool';
  return 'db-cell';
}

interface RowDetailProps {
  row: Record<string, unknown>;
  columns: DbColumnMeta[];
  onClose: () => void;
}

function RowDetail({ row, columns, onClose }: RowDetailProps): JSX.Element {
  return (
    <div className="db-detail-backdrop" onClick={onClose} role="presentation">
      <aside
        className="db-detail-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Row detail"
      >
        <header className="db-detail-head">
          <h2>Row detail</h2>
          <button type="button" className="ghost" onClick={onClose}>Close</button>
        </header>
        <div className="db-detail-body">
          {columns.map((col) => (
            <section key={col.name} className="db-detail-field">
              <div className="db-detail-label">
                <span>{col.name}</span>
                <span className="pill dim">{col.dataType}</span>
              </div>
              {col.dataType === 'jsonb' || typeof row[col.name] === 'object' ? (
                <pre className="db-detail-json">{JSON.stringify(row[col.name], null, 2)}</pre>
              ) : (
                <pre className="db-detail-value">{String(row[col.name] ?? '—')}</pre>
              )}
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}

export default function DbExplorerPage(): JSX.Element {
  const [tables, setTables] = useState<DbTableMeta[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [result, setResult] = useState<DbTableRowsResult | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loadingTables, setLoadingTables] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingTables(true);
      setError(null);
      try {
        const list = await fetchDbTables();
        setTables(list);
        if (list.length && !selectedTable) {
          setSelectedTable(list[0].name);
        }
      } catch (e) {
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        setError(err?.response?.data?.error || err.message || 'Failed to load tables');
      } finally {
        setLoadingTables(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRows = useCallback(async () => {
    if (!selectedTable) return;
    setLoadingRows(true);
    setError(null);
    try {
      const data = await fetchDbTableRows(selectedTable, {
        page,
        limit: PAGE_SIZE,
        sort,
        order,
        q: search,
      });
      setResult(data);
      if (!sort && data.sort) setSort(data.sort);
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error || err.message || 'Failed to load rows');
      setResult(null);
    } finally {
      setLoadingRows(false);
    }
  }, [selectedTable, page, sort, order, search]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const handleSelectTable = (name: string): void => {
    setSelectedTable(name);
    setPage(1);
    setSort('');
    setOrder('desc');
    setSearch('');
    setSearchInput('');
    setSelectedRow(null);
  };

  const handleSort = (column: string): void => {
    if (sort === column) {
      setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(column);
      setOrder('desc');
    }
    setPage(1);
  };

  const handleSearch = (e: React.FormEvent): void => {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  };

  const tableLabel = useMemo(() => {
    if (!selectedTable) return '';
    const meta = tables.find((t) => t.name === selectedTable);
    return meta ? `${selectedTable} (${meta.rowCount} rows)` : selectedTable;
  }, [selectedTable, tables]);

  return (
    <div className="db-explorer-page app-page-fill">
      <AppPageHeader
        eyebrow="Dev tools"
        title="Database explorer"
        lead="Browse Postgres tables and inspect rows. Available only in local dev — not shipped to production."
        meta={<span className="pill db-dev-badge">dev only</span>}
      />

      {error && <div className="alert alert-error">{error}</div>}

      <div className="db-explorer-layout">
        <aside className="db-table-list">
          <div className="db-table-list-head">
            <h3>Tables</h3>
            {loadingTables && <span className="spinner db-spinner" />}
          </div>
          <ul>
            {tables.map((t) => (
              <li key={t.name}>
                <button
                  type="button"
                  className={`db-table-btn${selectedTable === t.name ? ' active' : ''}`}
                  onClick={() => handleSelectTable(t.name)}
                >
                  <span className="db-table-name">{t.name}</span>
                  <span className="db-table-count">{t.rowCount}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="db-table-panel">
          <div className="db-table-toolbar">
            <h3>{tableLabel || 'Select a table'}</h3>
            <form className="db-search" onSubmit={handleSearch}>
              <input
                type="search"
                placeholder="Search text columns…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <button type="submit" className="ghost">Search</button>
              {search && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setSearch('');
                    setSearchInput('');
                    setPage(1);
                  }}
                >
                  Clear
                </button>
              )}
            </form>
          </div>

          {loadingRows && !result && (
            <div className="loading-card">Loading rows…</div>
          )}

          {result && (
            <>
              <div className="db-grid-wrap">
                <table className="db-grid">
                  <thead>
                    <tr>
                      {result.columns.map((col) => (
                        <th key={col.name}>
                          <button
                            type="button"
                            className={`db-sort-btn${sort === col.name ? ' active' : ''}`}
                            onClick={() => handleSort(col.name)}
                          >
                            <span>{col.name}</span>
                            <span className="db-sort-meta">
                              <span className="pill dim">{col.dataType}</span>
                              {sort === col.name && (
                                <span className="db-sort-arrow">{order === 'asc' ? '↑' : '↓'}</span>
                              )}
                            </span>
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.length === 0 && (
                      <tr>
                        <td colSpan={result.columns.length} className="db-empty">
                          No rows match your filters.
                        </td>
                      </tr>
                    )}
                    {result.rows.map((row, idx) => (
                      <tr
                        key={idx}
                        className="db-row"
                        onClick={() => setSelectedRow(row)}
                      >
                        {result.columns.map((col) => (
                          <td key={col.name} className={cellClass(row[col.name], col.dataType)}>
                            {formatCell(row[col.name], col.dataType)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="db-pagination">
                <span className="dim">
                  Page {result.page} of {result.totalPages} ({result.total} total)
                </span>
                <div className="db-pagination-btns">
                  <button
                    type="button"
                    className="ghost"
                    disabled={page <= 1 || loadingRows}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={page >= result.totalPages || loadingRows}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {selectedRow && result && (
        <RowDetail
          row={selectedRow}
          columns={result.columns}
          onClose={() => setSelectedRow(null)}
        />
      )}
    </div>
  );
}
