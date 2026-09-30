import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { isAdminUser } from '../services/authApi';
import { fetchAdminFeedback, type AdminFeedbackItem } from '../services/adminApi';
import { deleteChallengeReview } from '../services/challengeApi';
import { PLAY_DOMAINS } from '../constants/playCatalog';
import ConfirmDialog from '../components/ConfirmDialog';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS_SHOWN = 12;

type RangeFilter = 'all' | '7' | '30' | '90';

interface TrackInfo {
  key: string;
  label: string;
}

const TRACK_BY_CHALLENGE: Map<string, TrackInfo> = (() => {
  const map = new Map<string, TrackInfo>();
  for (const domain of PLAY_DOMAINS) {
    for (const panel of domain.panels) {
      for (const id of panel.challengeIds) {
        map.set(id, { key: `${domain.id}/${panel.id}`, label: panel.label });
      }
    }
  }
  return map;
})();

function trackFor(item: AdminFeedbackItem): TrackInfo {
  return (
    TRACK_BY_CHALLENGE.get(item.challengeId) || {
      key: `other/${item.category || 'unknown'}`,
      label: item.category ? item.category[0].toUpperCase() + item.category.slice(1) : 'Other',
    }
  );
}

function labLabel(challengeId: string): string | null {
  const k8s = /^k8s-0*(\d+)-/i.exec(challengeId)?.[1];
  if (k8s) return `L${Number(k8s)}`;
  if (/^l1-/i.test(challengeId)) return 'L1';
  return null;
}

function authorLabel(item: AdminFeedbackItem): string {
  return item.authorName || item.authorEmail?.split('@')[0] || 'Unknown';
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function startOfWeek(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export default function AdminFeedbackPage(): JSX.Element {
  const { currentUser } = useAppState();
  const isAdmin = Boolean(currentUser?.admin) || isAdminUser(currentUser);

  const [items, setItems] = useState<AdminFeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [trackFilter, setTrackFilter] = useState('all');
  const [labFilter, setLabFilter] = useState('all');
  const [authorFilter, setAuthorFilter] = useState('all');
  const [range, setRange] = useState<RangeFilter>('all');

  const [pendingDelete, setPendingDelete] = useState<AdminFeedbackItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchAdminFeedback());
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err.response?.data?.error || err.message || 'Could not load feedback');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const stats = useMemo(() => {
    const now = Date.now();
    const labs = new Set(items.map((i) => i.challengeId));
    const authors = new Set(items.map((i) => i.authorId));
    const last7 = items.filter((i) => i.createdAt >= now - 7 * DAY_MS).length;
    const prev7 = items.filter(
      (i) => i.createdAt < now - 7 * DAY_MS && i.createdAt >= now - 14 * DAY_MS,
    ).length;
    return { total: items.length, labs: labs.size, authors: authors.size, last7, prev7 };
  }, [items]);

  const weekly = useMemo(() => {
    const thisWeek = startOfWeek(Date.now());
    const weeks = Array.from({ length: WEEKS_SHOWN }, (_, idx) => {
      const start = thisWeek - (WEEKS_SHOWN - 1 - idx) * 7 * DAY_MS;
      return { start, count: 0 };
    });
    for (const item of items) {
      const ws = startOfWeek(item.createdAt);
      const bucket = weeks.find((w) => w.start === ws);
      if (bucket) bucket.count += 1;
    }
    const max = Math.max(1, ...weeks.map((w) => w.count));
    return { weeks, max };
  }, [items]);

  const byLab = useMemo(() => {
    const map = new Map<
      string,
      { challengeId: string; title: string; track: string; count: number; last: number; authors: Set<string> }
    >();
    for (const item of items) {
      const row = map.get(item.challengeId) || {
        challengeId: item.challengeId,
        title: item.challengeTitle || item.challengeId,
        track: trackFor(item).label,
        count: 0,
        last: 0,
        authors: new Set<string>(),
      };
      row.count += 1;
      row.last = Math.max(row.last, item.createdAt);
      row.authors.add(item.authorId);
      map.set(item.challengeId, row);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || b.last - a.last);
  }, [items]);

  const byTrack = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const item of items) {
      const t = trackFor(item);
      const row = map.get(t.key) || { key: t.key, label: t.label, count: 0 };
      row.count += 1;
      map.set(t.key, row);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [items]);

  const byAuthor = useMemo(() => {
    const map = new Map<string, { id: string; name: string; role: string; count: number; last: number }>();
    for (const item of items) {
      const row = map.get(item.authorId) || {
        id: item.authorId,
        name: authorLabel(item),
        role: item.authorRole,
        count: 0,
        last: 0,
      };
      row.count += 1;
      row.last = Math.max(row.last, item.createdAt);
      map.set(item.authorId, row);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || b.last - a.last);
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const since = range === 'all' ? 0 : Date.now() - Number(range) * DAY_MS;
    return items.filter((item) => {
      if (item.createdAt < since) return false;
      if (trackFilter !== 'all' && trackFor(item).key !== trackFilter) return false;
      if (labFilter !== 'all' && item.challengeId !== labFilter) return false;
      if (authorFilter !== 'all' && item.authorId !== authorFilter) return false;
      if (q) {
        const hay = [item.body, item.challengeTitle, item.challengeId, authorLabel(item), item.authorEmail]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, trackFilter, labFilter, authorFilter, range]);

  const filtersActive =
    search.trim() !== '' || trackFilter !== 'all' || labFilter !== 'all' || authorFilter !== 'all' || range !== 'all';

  function clearFilters(): void {
    setSearch('');
    setTrackFilter('all');
    setLabFilter('all');
    setAuthorFilter('all');
    setRange('all');
  }

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteChallengeReview(pendingDelete.challengeId, pendingDelete.id);
      setItems((prev) => prev.filter((i) => i.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err.response?.data?.error || err.message || 'Could not delete feedback');
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  if (!isAdmin) {
    return <Navigate to="/profile" replace />;
  }

  const trend = stats.last7 - stats.prev7;

  return (
    <div className="app-page feedback-dash">
      <header className="feedback-dash-header">
        <p className="spark-primer-crumb">
          <Link to="/admin">Admin</Link>
          <span aria-hidden> / </span>
          Lab feedback
        </p>
        <div className="feedback-dash-title-row">
          <div>
            <h1 className="feedback-dash-title">Lab feedback</h1>
            <p className="feedback-dash-lead">
              Everything reviewers and admins have written about the labs, in one place.
            </p>
          </div>
          <button type="button" className="admin-btn" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error ? <div className="alert app-page-alert">{error}</div> : null}

      <section className="feedback-kpis" aria-label="Summary">
        <div className="feedback-kpi">
          <span className="feedback-kpi-label">Total feedback</span>
          <strong className="feedback-kpi-value">{stats.total}</strong>
        </div>
        <div className="feedback-kpi">
          <span className="feedback-kpi-label">Labs with feedback</span>
          <strong className="feedback-kpi-value">{stats.labs}</strong>
        </div>
        <div className="feedback-kpi">
          <span className="feedback-kpi-label">Contributors</span>
          <strong className="feedback-kpi-value">{stats.authors}</strong>
        </div>
        <div className="feedback-kpi">
          <span className="feedback-kpi-label">Last 7 days</span>
          <strong className="feedback-kpi-value">{stats.last7}</strong>
          <span
            className={`feedback-kpi-trend${trend > 0 ? ' is-up' : trend < 0 ? ' is-down' : ''}`}
          >
            {trend === 0 ? 'same as the week before' : `${trend > 0 ? '+' : ''}${trend} vs the week before`}
          </span>
        </div>
      </section>

      <div className="feedback-grid">
        <section className="feedback-card feedback-card--wide" aria-labelledby="fb-weekly">
          <h2 id="fb-weekly" className="feedback-card-title">
            Feedback per week
          </h2>
          <div className="feedback-bars" role="img" aria-label="Feedback count for each of the last 12 weeks">
            {weekly.weeks.map((w) => (
              <div key={w.start} className="feedback-bar-col" title={`Week of ${formatDate(w.start)}: ${w.count}`}>
                <span className="feedback-bar-count">{w.count || ''}</span>
                <div className="feedback-bar-track">
                  <div className="feedback-bar" style={{ height: `${(w.count / weekly.max) * 100}%` }} />
                </div>
                <span className="feedback-bar-label">
                  {new Date(w.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="feedback-card" aria-labelledby="fb-tracks">
          <h2 id="fb-tracks" className="feedback-card-title">
            By track
          </h2>
          {byTrack.length === 0 ? (
            <p className="feedback-empty">No feedback yet.</p>
          ) : (
            <ul className="feedback-meter-list">
              {byTrack.map((t) => (
                <li key={t.key}>
                  <button
                    type="button"
                    className={`feedback-meter${trackFilter === t.key ? ' is-active' : ''}`}
                    onClick={() => setTrackFilter(trackFilter === t.key ? 'all' : t.key)}
                  >
                    <span className="feedback-meter-row">
                      <span>{t.label}</span>
                      <span className="feedback-meter-count">{t.count}</span>
                    </span>
                    <span className="feedback-meter-track">
                      <span className="feedback-meter-fill" style={{ width: `${(t.count / stats.total) * 100}%` }} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="feedback-card feedback-card--wide" aria-labelledby="fb-labs">
          <h2 id="fb-labs" className="feedback-card-title">
            Most discussed labs
          </h2>
          {byLab.length === 0 ? (
            <p className="feedback-empty">No feedback yet.</p>
          ) : (
            <div className="feedback-table-wrap">
              <table className="feedback-table">
                <thead>
                  <tr>
                    <th>Lab</th>
                    <th>Track</th>
                    <th className="num">Feedback</th>
                    <th className="num">Reviewers</th>
                    <th className="num">Latest</th>
                  </tr>
                </thead>
                <tbody>
                  {byLab.slice(0, 10).map((row) => (
                    <tr
                      key={row.challengeId}
                      className={labFilter === row.challengeId ? 'is-active' : undefined}
                      onClick={() => setLabFilter(labFilter === row.challengeId ? 'all' : row.challengeId)}
                    >
                      <td>
                        {labLabel(row.challengeId) ? (
                          <span className="feedback-lab-id">{labLabel(row.challengeId)}</span>
                        ) : null}
                        {row.title}
                      </td>
                      <td className="muted">{row.track}</td>
                      <td className="num">{row.count}</td>
                      <td className="num">{row.authors.size}</td>
                      <td className="num muted">{formatDate(row.last)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="feedback-card" aria-labelledby="fb-authors">
          <h2 id="fb-authors" className="feedback-card-title">
            Top contributors
          </h2>
          {byAuthor.length === 0 ? (
            <p className="feedback-empty">No feedback yet.</p>
          ) : (
            <ul className="feedback-author-list">
              {byAuthor.slice(0, 8).map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className={`feedback-author${authorFilter === a.id ? ' is-active' : ''}`}
                    onClick={() => setAuthorFilter(authorFilter === a.id ? 'all' : a.id)}
                  >
                    <span className="feedback-avatar" aria-hidden>
                      {a.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="feedback-author-main">
                      <span className="feedback-author-name">{a.name}</span>
                      <span className="feedback-author-meta">
                        {a.role} · last {formatDate(a.last)}
                      </span>
                    </span>
                    <span className="feedback-meter-count">{a.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="feedback-card feedback-feed" aria-labelledby="fb-feed">
        <div className="feedback-feed-head">
          <h2 id="fb-feed" className="feedback-card-title">
            All feedback
          </h2>
          <span className="feedback-feed-count">
            {filtered.length} of {items.length}
          </span>
        </div>

        <div className="feedback-filters">
          <input
            type="search"
            className="play-search feedback-search"
            placeholder="Search feedback, labs, or people…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="feedback-select" value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)}>
            <option value="all">All tracks</option>
            {byTrack.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <select className="feedback-select" value={labFilter} onChange={(e) => setLabFilter(e.target.value)}>
            <option value="all">All labs</option>
            {byLab.map((l) => (
              <option key={l.challengeId} value={l.challengeId}>
                {labLabel(l.challengeId) ? `${labLabel(l.challengeId)} · ` : ''}
                {l.title}
              </option>
            ))}
          </select>
          <select className="feedback-select" value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)}>
            <option value="all">All people</option>
            {byAuthor.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            className="feedback-select"
            value={range}
            onChange={(e) => setRange(e.target.value as RangeFilter)}
          >
            <option value="all">All time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          {filtersActive ? (
            <button type="button" className="feedback-clear" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>

        {loading && items.length === 0 ? <p className="feedback-empty">Loading…</p> : null}
        {!loading && filtered.length === 0 ? (
          <p className="feedback-empty">
            {items.length === 0 ? 'No feedback has been written yet.' : 'Nothing matches these filters.'}
          </p>
        ) : null}

        <ul className="feedback-entries">
          {filtered.map((item) => (
            <li key={item.id} className="feedback-entry">
              <div className="feedback-entry-head">
                <span className="feedback-avatar" aria-hidden>
                  {authorLabel(item).slice(0, 1).toUpperCase()}
                </span>
                <div className="feedback-entry-meta">
                  <span className="feedback-author-name">{authorLabel(item)}</span>
                  <span className="feedback-author-meta">
                    {item.authorRole} · {formatDateTime(item.createdAt)}
                  </span>
                </div>
                <button
                  type="button"
                  className="feedback-entry-lab"
                  onClick={() => setLabFilter(item.challengeId)}
                  title="Show only this lab"
                >
                  {labLabel(item.challengeId) ? `${labLabel(item.challengeId)} · ` : ''}
                  {item.challengeTitle || item.challengeId}
                  <span className="feedback-entry-track"> · {trackFor(item).label}</span>
                </button>
                <button
                  type="button"
                  className="feedback-entry-delete"
                  onClick={() => setPendingDelete(item)}
                  aria-label="Delete feedback"
                  title="Delete feedback"
                >
                  ×
                </button>
              </div>
              <p className="feedback-entry-body">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete this feedback?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      >
        <p>
          This removes the feedback from{' '}
          <strong>{pendingDelete ? authorLabel(pendingDelete) : ''}</strong> on{' '}
          <strong>{pendingDelete?.challengeTitle || pendingDelete?.challengeId}</strong> for everyone. It
          can't be undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}
