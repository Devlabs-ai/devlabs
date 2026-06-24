import React, { useCallback, useEffect, useState } from 'react';
import AppPageHeader from '../components/AppPageHeader';
import {
  fetchCatalogue,
  fetchLessons,
  fetchMemoryStats,
} from '../services/memoriesApi';
import type { PaginatedResult } from '../types/domain';

const PAGE_SIZE = 20;

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}

function Pagination({ page, totalPages, total, onPage }: PaginationProps): JSX.Element | null {
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

interface JsonBlockProps {
  value: unknown;
}

function JsonBlock({ value }: JsonBlockProps): JSX.Element {
  if (!value || (typeof value === 'object' && Object.keys(value as object).length === 0)) {
    return <span className="dim">—</span>;
  }
  return <pre className="memories-json">{JSON.stringify(value, null, 2)}</pre>;
}

interface CatalogueItem {
  id: string;
  category: string;
  image?: string;
  handbookText?: string;
  dos?: string[];
  donts?: string[];
  conf?: unknown;
  observables?: unknown[];
}

interface CatalogueCardProps {
  item: CatalogueItem;
  expanded: boolean;
  onToggle: () => void;
}

function CatalogueCard({ item, expanded, onToggle }: CatalogueCardProps): JSX.Element {
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
          {item.dos && item.dos.length > 0 && (
            <section>
              <h4>Do</h4>
              <ul>{item.dos.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </section>
          )}
          {item.donts && item.donts.length > 0 && (
            <section>
              <h4>Don&apos;t</h4>
              <ul className="donts">{item.donts.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </section>
          )}
          <section>
            <h4>Conf (container startup)</h4>
            <JsonBlock value={item.conf} />
          </section>
          {item.observables && item.observables.length > 0 && (
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

interface LessonItem {
  id: string;
  phase: string;
  category?: string;
  title?: string;
  createdAt: string;
  failureSummary: string;
  fixSummary: string;
}

interface LessonCardProps {
  item: LessonItem;
  expanded: boolean;
  onToggle: () => void;
}

function LessonCard({ item, expanded, onToggle }: LessonCardProps): JSX.Element {
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
            <h4>Failures (before fix)</h4>
            <pre className="memories-prose">{item.failureSummary}</pre>
          </section>
          <section>
            <h4>Fix</h4>
            <p className="memories-prose">{item.fixSummary}</p>
          </section>
        </div>
      )}
    </article>
  );
}

interface MemoryStats {
  catalogue: number;
  lessons: number;
}

export default function MemoriesPage(): JSX.Element {
  const [tab, setTab] = useState<'catalogue' | 'lessons'>('catalogue');
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [phaseFilter, setPhaseFilter] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [data, setData] = useState<PaginatedResult<CatalogueItem | LessonItem>>({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadStats = useCallback(async (): Promise<void> => {
    try {
      const s = await fetchMemoryStats() as MemoryStats;
      setStats(s);
    } catch (_e) { /* noop */ }
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setExpandedId(null);
    try {
      const opts = { page, limit: PAGE_SIZE, category: categoryFilter };
      const result = tab === 'catalogue'
        ? await fetchCatalogue(opts) as PaginatedResult<CatalogueItem>
        : await fetchLessons({ ...opts, phase: phaseFilter }) as PaginatedResult<LessonItem>;
      setData(result);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error || err.message || 'Unknown error');
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
              ? (data.items as CatalogueItem[]).map((item) => (
                <CatalogueCard
                  key={item.id}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                />
              ))
              : (data.items as LessonItem[]).map((item) => (
                <LessonCard
                  key={item.id}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                />
              ))}
          </div>
          <Pagination
            page={page}
            totalPages={data.totalPages}
            total={data.total}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}
