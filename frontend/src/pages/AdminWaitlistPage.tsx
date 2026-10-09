import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { isAdminUser } from '../services/authApi';
import { deleteWaitlistSignup, fetchWaitlist, type WaitlistSignup } from '../services/waitlistApi';
import ConfirmDialog from '../components/ConfirmDialog';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_SHOWN = 30;
const DIRECT = 'direct';

type RangeFilter = 'all' | '1' | '7' | '30';

const ROLE_LABELS: Record<string, string> = {
  student: 'Student',
  developer: 'Developer',
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] || role;
}

function sourceKey(s: WaitlistSignup): string {
  return (s.source || '').trim().toLowerCase() || DIRECT;
}

function sourceLabel(key: string): string {
  return key === DIRECT ? 'Direct / unknown' : key;
}

function orgKey(s: WaitlistSignup): string {
  return (s.organization || '').trim().toLowerCase();
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

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function csvCell(value: string | null): string {
  const s = value ?? '';
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(signups: WaitlistSignup[]): void {
  const lines = [
    'email,role,organization,source,joined_at',
    ...signups.map((s) =>
      [s.email, s.role, s.organization, s.source, new Date(s.createdAt).toISOString()]
        .map(csvCell)
        .join(','),
    ),
  ];
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `devsetu-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminWaitlistPage(): JSX.Element {
  const { currentUser } = useAppState();
  const isAdmin = Boolean(currentUser?.admin) || isAdminUser(currentUser);

  const [items, setItems] = useState<WaitlistSignup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [orgFilter, setOrgFilter] = useState('all');
  const [range, setRange] = useState<RangeFilter>('all');

  const [pendingDelete, setPendingDelete] = useState<WaitlistSignup | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchWaitlist());
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err.response?.data?.error || err.message || 'Could not load the waitlist');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const stats = useMemo(() => {
    const now = Date.now();
    const today = startOfDay(now);
    const last7 = items.filter((i) => i.createdAt >= now - 7 * DAY_MS).length;
    const prev7 = items.filter(
      (i) => i.createdAt < now - 7 * DAY_MS && i.createdAt >= now - 14 * DAY_MS,
    ).length;
    return {
      total: items.length,
      students: items.filter((i) => i.role === 'student').length,
      developers: items.filter((i) => i.role === 'developer').length,
      today: items.filter((i) => i.createdAt >= today).length,
      last7,
      prev7,
    };
  }, [items]);

  const daily = useMemo(() => {
    const today = startOfDay(Date.now());
    const days = Array.from({ length: DAYS_SHOWN }, (_, idx) => ({
      start: today - (DAYS_SHOWN - 1 - idx) * DAY_MS,
      count: 0,
    }));
    for (const item of items) {
      const bucket = days.find((d) => d.start === startOfDay(item.createdAt));
      if (bucket) bucket.count += 1;
    }
    const max = Math.max(1, ...days.map((d) => d.count));
    return { days, max };
  }, [items]);

  const byRole = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) map.set(item.role, (map.get(item.role) || 0) + 1);
    return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  }, [items]);

  const bySource = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) map.set(sourceKey(item), (map.get(sourceKey(item)) || 0) + 1);
    return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  }, [items]);

  const byOrg = useMemo(() => {
    const map = new Map<
      string,
      { key: string; label: string; count: number; students: number; developers: number; last: number }
    >();
    for (const item of items) {
      const key = orgKey(item);
      if (!key) continue;
      const row = map.get(key) || {
        key,
        label: (item.organization || '').trim(),
        count: 0,
        students: 0,
        developers: 0,
        last: 0,
      };
      row.count += 1;
      if (item.role === 'student') row.students += 1;
      if (item.role === 'developer') row.developers += 1;
      row.last = Math.max(row.last, item.createdAt);
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || b.last - a.last);
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const since = range === 'all' ? 0 : Date.now() - Number(range) * DAY_MS;
    return items.filter((item) => {
      if (item.createdAt < since) return false;
      if (roleFilter !== 'all' && item.role !== roleFilter) return false;
      if (sourceFilter !== 'all' && sourceKey(item) !== sourceFilter) return false;
      if (orgFilter !== 'all' && orgKey(item) !== orgFilter) return false;
      if (q) {
        const hay = [item.email, item.organization, item.source].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, roleFilter, sourceFilter, orgFilter, range]);

  const filtersActive =
    search.trim() !== '' || roleFilter !== 'all' || sourceFilter !== 'all' || orgFilter !== 'all' || range !== 'all';

  function clearFilters(): void {
    setSearch('');
    setRoleFilter('all');
    setSourceFilter('all');
    setOrgFilter('all');
    setRange('all');
  }

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteWaitlistSignup(pendingDelete.email);
      setItems((prev) => prev.filter((i) => i.email !== pendingDelete.email));
      setPendingDelete(null);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err.response?.data?.error || err.message || 'Could not delete the sign-up');
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  if (!isAdmin) {
    return <Navigate to="/profile" replace />;
  }

  const trend = stats.last7 - stats.prev7;
  const labelEvery = Math.ceil(DAYS_SHOWN / 6);

  return (
    <div className="app-page feedback-dash">
      <header className="feedback-dash-header">
        <p className="spark-primer-crumb">
          <Link to="/admin">Admin</Link>
          <span aria-hidden> / </span>
          Waitlist
        </p>
        <div className="feedback-dash-title-row">
          <div>
            <h1 className="feedback-dash-title">Waitlist</h1>
            <p className="feedback-dash-lead">
              Everyone who signed up from the landing page, and where they came from.
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
          <span className="feedback-kpi-label">Total sign-ups</span>
          <strong className="feedback-kpi-value">{stats.total}</strong>
          <span className="feedback-kpi-trend">{stats.today} today</span>
        </div>
        <div className="feedback-kpi">
          <span className="feedback-kpi-label">Students</span>
          <strong className="feedback-kpi-value">{stats.students}</strong>
        </div>
        <div className="feedback-kpi">
          <span className="feedback-kpi-label">Developers</span>
          <strong className="feedback-kpi-value">{stats.developers}</strong>
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
        <section className="feedback-card feedback-card--wide" aria-labelledby="wl-daily">
          <h2 id="wl-daily" className="feedback-card-title">
            Sign-ups per day
          </h2>
          <div className="feedback-bars waitlist-bars" role="img" aria-label={`Sign-ups for each of the last ${DAYS_SHOWN} days`}>
            {daily.days.map((d, idx) => (
              <div key={d.start} className="feedback-bar-col" title={`${formatDate(d.start)}: ${d.count}`}>
                <span className="feedback-bar-count">{d.count || ''}</span>
                <div className="feedback-bar-track">
                  <div className="feedback-bar" style={{ height: `${(d.count / daily.max) * 100}%` }} />
                </div>
                <span className="feedback-bar-label">
                  {idx % labelEvery === 0 || idx === DAYS_SHOWN - 1
                    ? new Date(d.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
                    : ''}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="feedback-card" aria-labelledby="wl-roles">
          <h2 id="wl-roles" className="feedback-card-title">
            By group
          </h2>
          {byRole.length === 0 ? (
            <p className="feedback-empty">No sign-ups yet.</p>
          ) : (
            <ul className="feedback-meter-list">
              {byRole.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    className={`feedback-meter${roleFilter === r.key ? ' is-active' : ''}`}
                    onClick={() => setRoleFilter(roleFilter === r.key ? 'all' : r.key)}
                  >
                    <span className="feedback-meter-row">
                      <span>{roleLabel(r.key)}s</span>
                      <span className="feedback-meter-count">{r.count}</span>
                    </span>
                    <span className="feedback-meter-track">
                      <span className="feedback-meter-fill" style={{ width: `${(r.count / stats.total) * 100}%` }} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="feedback-card feedback-card--wide" aria-labelledby="wl-orgs">
          <h2 id="wl-orgs" className="feedback-card-title">
            Top colleges and companies
          </h2>
          {byOrg.length === 0 ? (
            <p className="feedback-empty">No one has added a college or company yet.</p>
          ) : (
            <div className="feedback-table-wrap">
              <table className="feedback-table">
                <thead>
                  <tr>
                    <th>College / company</th>
                    <th className="num">Sign-ups</th>
                    <th className="num">Students</th>
                    <th className="num">Developers</th>
                    <th className="num">Latest</th>
                  </tr>
                </thead>
                <tbody>
                  {byOrg.slice(0, 10).map((row) => (
                    <tr
                      key={row.key}
                      className={orgFilter === row.key ? 'is-active' : undefined}
                      onClick={() => setOrgFilter(orgFilter === row.key ? 'all' : row.key)}
                    >
                      <td>{row.label}</td>
                      <td className="num">{row.count}</td>
                      <td className="num">{row.students}</td>
                      <td className="num">{row.developers}</td>
                      <td className="num muted">{formatDate(row.last)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="feedback-card" aria-labelledby="wl-sources">
          <h2 id="wl-sources" className="feedback-card-title">
            By source
          </h2>
          {bySource.length === 0 ? (
            <p className="feedback-empty">No sign-ups yet.</p>
          ) : (
            <ul className="feedback-meter-list">
              {bySource.map((s) => (
                <li key={s.key}>
                  <button
                    type="button"
                    className={`feedback-meter${sourceFilter === s.key ? ' is-active' : ''}`}
                    onClick={() => setSourceFilter(sourceFilter === s.key ? 'all' : s.key)}
                  >
                    <span className="feedback-meter-row">
                      <span>{sourceLabel(s.key)}</span>
                      <span className="feedback-meter-count">{s.count}</span>
                    </span>
                    <span className="feedback-meter-track">
                      <span className="feedback-meter-fill" style={{ width: `${(s.count / stats.total) * 100}%` }} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="feedback-card feedback-feed" aria-labelledby="wl-all">
        <div className="feedback-feed-head">
          <h2 id="wl-all" className="feedback-card-title">
            All sign-ups
          </h2>
          <span className="feedback-feed-count">
            {filtered.length} of {items.length}
          </span>
          <button
            type="button"
            className="admin-btn admin-btn--approve"
            disabled={filtered.length === 0}
            onClick={() => downloadCsv(filtered)}
          >
            Download CSV
          </button>
        </div>

        <div className="feedback-filters">
          <input
            type="search"
            className="play-search feedback-search"
            placeholder="Search email, college, company or source…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="feedback-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="all">Everyone</option>
            {Object.entries(ROLE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}s
              </option>
            ))}
          </select>
          <select className="feedback-select" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="all">All sources</option>
            {bySource.map((s) => (
              <option key={s.key} value={s.key}>
                {sourceLabel(s.key)}
              </option>
            ))}
          </select>
          <select className="feedback-select" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
            <option value="all">All colleges and companies</option>
            {byOrg.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className="feedback-select"
            value={range}
            onChange={(e) => setRange(e.target.value as RangeFilter)}
          >
            <option value="all">All time</option>
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
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
            {items.length === 0 ? 'No one has joined the waitlist yet.' : 'Nothing matches these filters.'}
          </p>
        ) : null}

        {filtered.length > 0 ? (
          <div className="feedback-table-wrap">
            <table className="feedback-table waitlist-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Group</th>
                  <th>College / company</th>
                  <th>Source</th>
                  <th className="num">Joined</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.email}>
                    <td>{s.email}</td>
                    <td className="muted">{roleLabel(s.role)}</td>
                    <td className="muted">{s.organization || '—'}</td>
                    <td className="muted">{sourceLabel(sourceKey(s))}</td>
                    <td className="num muted">{formatDateTime(s.createdAt)}</td>
                    <td className="num">
                      <button
                        type="button"
                        className="feedback-entry-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDelete(s);
                        }}
                        aria-label={`Remove ${s.email}`}
                        title="Remove from waitlist"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={pendingDelete != null}
        title="Remove this sign-up?"
        confirmLabel="Remove"
        cancelLabel="Cancel"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      >
        <p>
          This removes <strong>{pendingDelete?.email}</strong> from the waitlist. It can&apos;t be undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}
