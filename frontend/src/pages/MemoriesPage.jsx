import React, { useCallback, useEffect, useState } from 'react';
import AppPageHeader from '../components/AppPageHeader.jsx';
import {
  fetchCatalogue,
  fetchLessons,
  fetchMemoryStats,
} from '../services/memoriesApi.js';

const PAGE_SIZE = 20;

function Pagination({ page, totalPages, total, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <div className="memories-pagination">
      <span className="dim">
        Page {page} of {totalPages} ({total} total)
      </span>
      <div className="memories-pagination-btns">
        <button type="button" className="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button
          type="button"
          className="ghost"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function JsonBlock({ value }) {
  if (!value || (typeof value === 'object' && Object.keys(value).length === 0)) {
    return <span className="dim">—</span>;
  }
  return <pre className="memories-json">{JSON.stringify(value, null, 2)}</pre>;
}

function CatalogueCard({ item, expanded, onToggle }) {
  return (
    <article className={`memories-card ${expanded ? 'expanded' : ''}`}>
      <button type="button" className="memories-card-head" onClick={onToggle}>
        <div className="memories-card-title">
          <span className="pill">{item.category}</span>
          {item.image && <span className="pill dim">{item.image}</span>}
          <strong>{item.image || item.category}</strong>
        </div>
        <span className="dim">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="memories-card-body">
          {item.handbookText && (
            <section>
              <h4>Handbook</h4>
              <p className="memories-prose">{item.handbookText}</p>
            </section>
          )}
          {item.dos?.length > 0 && (
            <section>
              <h4>Do</h4>
              <ul>{item.dos.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </section>
          )}
          {item.donts?.length > 0 && (
            <section>
              <h4>Don&apos;t</h4>
              <ul className="donts">{item.donts.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </section>
          )}
          <section>
            <h4>Conf (container startup)</h4>
            <JsonBlock value={item.conf} />
          </section>
          {item.observables?.length > 0 && (
            <section>
              <h4>Observables</h4>
              <JsonBlock value={item.observables} />
            </section>
          )}
        </div>
      )}
    </article>
  );
}

function LessonCard({ item, expanded, onToggle }) {
  return (
    <article className={`memories-card ${expanded ? 'expanded' : ''}`}>
      <button type="button" className="memories-card-head" onClick={onToggle}>
        <div className="memories-card-title">
          <span className={`pill ${item.phase === 'spin' ? 'warn' : 'pass'}`}>{item.phase}</span>
          {item.category && <span className="pill dim">{item.category}</span>}
          <strong>{item.title || 'Untitled build'}</strong>
        </div>
        <span className="dim">{new Date(item.createdAt).toLocaleString()}</span>
      </button>
      {expanded && (
        <div className="memories-card-body">
          <section>
            <h4>Problem context</h4>
            <p className="memories-prose">{item.problemContext}</p>
          </section>
          <section>
            <h4>Failures (before fix)</h4>
            <pre className="memories-prose">{item.failureSummary}</pre>
          </section>
          <section>
            <h4>Fix</h4>
            <p className="memories-prose">{item.fixSummary}</p>
          </section>
          {item.details?.workingCompose && (
            <section>
              <h4>Working compose (excerpt)</h4>
              <pre className="memories-code">{item.details.workingCompose}</pre>
            </section>
          )}
        </div>
      )}
    </article>
  );
}

export default function MemoriesPage() {
  const [tab, setTab] = useState('catalogue');
  const [stats, setStats] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const loadStats = useCallback(async () => {
    try {
      const s = await fetchMemoryStats();
      setStats(s);
    } catch (_e) { /* noop */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExpandedId(null);
    try {
      const opts = { page, limit: PAGE_SIZE, category: categoryFilter };
      const result = tab === 'catalogue'
        ? await fetchCatalogue(opts)
        : await fetchLessons({ ...opts, phase: phaseFilter });
      setData(result);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
      setData({ items: [], total: 0, totalPages: 1 });
    } finally {
      setLoading(false);
    }
  }, [tab, page, categoryFilter, phaseFilter]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [tab, categoryFilter, phaseFilter]);

  const statsMeta = stats
    ? `${stats.catalogue} catalogue · ${stats.lessons} lessons`
    : '';

  return (
    <div className="app-page memories-page">
      <AppPageHeader
        eyebrow="Memories"
        title="Catalogue & Lessons"
        meta={statsMeta}
        lead="Verified stack recipes and lessons captured from successful builds—used by the agent on every pipeline run."
      />

      <div className="memories-toolbar app-surface-card">
        <div className="app-segmented-tabs">
          <button
            type="button"
            className={`app-segmented-tab ${tab === 'catalogue' ? 'active' : ''}`}
            onClick={() => setTab('catalogue')}
          >
            Catalogue
          </button>
          <button
            type="button"
            className={`app-segmented-tab ${tab === 'lessons' ? 'active' : ''}`}
            onClick={() => setTab('lessons')}
          >
            Lessons
          </button>
        </div>
        <label className="memories-filter">
          Category
          <input
            type="text"
            placeholder="e.g. postgres, redis"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value.trim())}
          />
        </label>
        {tab === 'lessons' && (
          <label className="memories-filter">
            Phase
            <select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)}>
              <option value="">All</option>
              <option value="spin">spin</option>
              <option value="validate">validate</option>
            </select>
          </label>
        )}
      </div>

      {error && <div className="alert">{error}</div>}

      {loading ? (
        <div className="loading-card">
          <span className="spinner" />
          Loading…
        </div>
      ) : data.items.length === 0 ? (
        <div className="review-empty">
          {tab === 'catalogue'
            ? 'No catalogue rows yet. Restart the backend to seed from pipeline/catalogue/seeds when the table is empty.'
            : 'No lessons yet. Lessons are recorded when a build succeeds after failures in SPIN or VALIDATE.'}
        </div>
      ) : (
        <>
          <div className="memories-list">
            {tab === 'catalogue'
              ? data.items.map((item) => (
                <CatalogueCard
                  key={item.id}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                />
              ))
              : data.items.map((item) => (
                <LessonCard
                  key={item.id}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                />
              ))}
          </div>
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}
