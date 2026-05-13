import React from 'react';
import {
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceLine, Area, AreaChart,
} from 'recharts';

const MAX_POINTS = 180;
const RECOVERY_THRESHOLD = 50;

function appendPoint(series, point) {
  const next = [...series, point];
  if (next.length > MAX_POINTS) return next.slice(next.length - MAX_POINTS);
  return next;
}

export function useMetricsState() {
  const [series, setSeries] = React.useState([]);
  const [latest, setLatest] = React.useState(null);
  const [recovered, setRecovered] = React.useState(false);

  const handleMessage = React.useCallback((msg) => {
    if (msg.type === 'metric') {
      const p = {
        ts: msg.timestamp,
        t: new Date(msg.timestamp).toLocaleTimeString(),
        latency: msg.data.latency,
        errors: msg.data.errors,
        dbCpu: msg.data.dbCpu,
      };
      setSeries((s) => appendPoint(s, p));
      setLatest(p);
    } else if (msg.type === 'recovered') {
      setRecovered(true);
    }
  }, []);

  return { series, latest, recovered, handleMessage };
}

function tileClass(latency) {
  if (latency == null) return '';
  if (latency < RECOVERY_THRESHOLD) return 'ok';
  if (latency < 200) return 'warn';
  return 'bad';
}

function fieldToService(field) {
  return field.replace(/^HOST_PORT_/, '').toLowerCase().replace(/_/g, '-');
}

function ServiceEndpoints({ portMap }) {
  const entries = Object.entries(portMap || {});
  if (entries.length === 0) return null;
  const copy = async (url) => {
    try { await navigator.clipboard.writeText(url); } catch (_e) { /* noop */ }
  };
  return (
    <div className="endpoints">
      <h4>Sandbox endpoints</h4>
      <ul>
        {entries.map(([field, port]) => {
          const svc = fieldToService(field);
          const url = `http://localhost:${port}`;
          return (
            <li key={field}>
              <span className="svc">{svc}</span>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                title="open in new tab"
                onClick={(e) => { e.preventDefault(); copy(url); window.open(url, '_blank', 'noreferrer'); }}
              >
                {url}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function MetricsDashboard({ series, latest, recovered, portMap }) {
  const latencyClass = tileClass(latest?.latency);
  const errorsClass = latest && latest.errors > 0 ? 'bad' : '';

  const minLatency = series.length ? Math.min(...series.map((p) => p.latency)) : null;
  const maxLatency = series.length ? Math.max(...series.map((p) => p.latency)) : null;
  const avgLatency = series.length
    ? series.reduce((acc, p) => acc + p.latency, 0) / series.length
    : null;

  return (
    <div className="metrics-root">
      {recovered && (
        <div className="recovered-banner">
          <span className="pulse" />
          System recovered — sustained latency below {RECOVERY_THRESHOLD} ms
        </div>
      )}
      <div className="metric-grid">
        <div className={`metric-tile ${latencyClass}`}>
          <div className="label">Latency</div>
          <div className="value">
            {latest ? Math.round(latest.latency) : '—'}
            {latest && <span className="unit"> ms</span>}
          </div>
        </div>
        <div className={`metric-tile ${errorsClass}`}>
          <div className="label">Errors</div>
          <div className="value">{latest ? Math.round(latest.errors) : '—'}</div>
        </div>
        <div className="metric-tile">
          <div className="label">DB CPU</div>
          <div className="value">
            {latest ? Math.round(latest.dbCpu) : '—'}
            {latest && <span className="unit"> %</span>}
          </div>
        </div>
      </div>

      <div className="metric-chart">
        <div className="chart-head">
          <span>Latency timeline</span>
          <div className="chart-stats">
            {avgLatency != null && (
              <>
                <span>min <b>{Math.round(minLatency)}</b> ms</span>
                <span>avg <b>{Math.round(avgLatency)}</b> ms</span>
                <span>max <b>{Math.round(maxLatency)}</b> ms</span>
              </>
            )}
          </div>
        </div>
        <div className="chart-host">
          <ResponsiveContainer>
            <AreaChart data={series} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="latencyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                tick={{ fontSize: 10, fill: '#6c7595' }}
                interval="preserveEnd"
                axisLine={false}
                tickLine={false}
                minTickGap={32}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#6c7595' }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(10, 14, 26, 0.95)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelStyle={{ color: '#98a2c2' }}
                itemStyle={{ color: '#34d399' }}
              />
              <ReferenceLine
                y={RECOVERY_THRESHOLD}
                stroke="rgba(110, 231, 183, 0.4)"
                strokeDasharray="3 3"
                label={{ value: 'target', fill: '#6ee7b7', fontSize: 10, position: 'insideTopRight' }}
              />
              <Area
                type="monotone"
                dataKey="latency"
                stroke="#34d399"
                strokeWidth={1.8}
                fill="url(#latencyGrad)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <ServiceEndpoints portMap={portMap} />
    </div>
  );
}
