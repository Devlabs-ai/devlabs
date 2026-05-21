import React, { useCallback, useEffect, useState } from 'react';
import AppPageHeader from '../components/AppPageHeader.jsx';
import {
  fetchLessons,
  fetchMemoryStats,
  fetchSpecialists,
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

function SpecialistCard({ item, expanded, onToggle }) {
  return (
    <article className={`memories-card ${expanded ? 'expanded' : ''}`}>
      <button type="button" className="memories-card-head" onClick={onToggle}>
        <div className="memories-card-title">
          <span className="pill">{item.category}</span>
          {item.stack && <span className="pill dim">{item.stack}</span>}
          <strong>{item.title}</strong>
        </div>
        <span className="dim">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="memories-card-body">
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
          <span className={`pill ${item.phase === 'start' ? 'warn' : 'pass'}`}>{item.phase}</span>
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
  const [tab, setTab] = useState('specialists');
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
      const result = tab === 'specialists'
        ? await fetchSpecialists(opts)
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
    ? `${stats.specialists} specialists · ${stats.lessons} lessons`
    : '';

  return (
    <div className="app-page">
      <AppPageHeader
        eyebrow="Memories"
        title="Specialist Handbook"
        meta={statsMeta}
        lead="Curated stack recipes and lessons captured from successful builds—used by the agent on every pipeline run."
      />

      <div className="memories-toolbar app-surface-card">
        <div className="app-segmented-tabs">
          <button
            type="button"
            className={`app-segmented-tab ${tab === 'specialists' ? 'active' : ''}`}
            onClick={() => setTab('specialists')}
          >
            Specialists
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
            placeholder="e.g. postgres, Database"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value.trim())}
          />
        </label>
        {tab === 'lessons' && (
          <label className="memories-filter">
            Phase
            <select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)}>
              <option value="">All</option>
              <option value="start">start</option>
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
          {tab === 'specialists'
            ? 'No specialist rows yet. Run make seed-memory or restart the backend to seed the handbook.'
            : 'No lessons yet. Lessons are recorded when a build succeeds after failures in START or VALIDATE.'}
        </div>
      ) : (
        <>
          <div className="memories-list">
            {tab === 'specialists'
              ? data.items.map((item) => (
                <SpecialistCard
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
