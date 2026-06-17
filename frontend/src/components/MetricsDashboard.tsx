import React from 'react';
import {
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceLine, Area, AreaChart,
} from 'recharts';
import type { MetricsSeriesPoint } from '../types/domain';

const MAX_POINTS = 180;
const RECOVERY_THRESHOLD = 50;

function appendPoint(series: MetricsSeriesPoint[], point: MetricsSeriesPoint): MetricsSeriesPoint[] {
  const next = [...series, point];
  if (next.length > MAX_POINTS) return next.slice(next.length - MAX_POINTS);
  return next;
}

interface MetricsMessage {
  type: string;
  timestamp?: number;
  data?: { latency?: number; errors?: number; dbCpu?: number };
}

export function useMetricsState(): {
  series: MetricsSeriesPoint[];
  latest: MetricsSeriesPoint | null;
  recovered: boolean;
  handleMessage: (msg: MetricsMessage) => void;
} {
  const [series, setSeries] = React.useState<MetricsSeriesPoint[]>([]);
  const [latest, setLatest] = React.useState<MetricsSeriesPoint | null>(null);
  const [recovered, setRecovered] = React.useState<boolean>(false);

  const handleMessage = React.useCallback((msg: MetricsMessage): void => {
    if (msg.type === 'metric') {
      const p: MetricsSeriesPoint = {
        ts: msg.timestamp ?? Date.now(),
        t: new Date(msg.timestamp ?? Date.now()).toLocaleTimeString(),
        latency: msg.data?.latency ?? 0,
        errors: msg.data?.errors ?? 0,
        dbCpu: msg.data?.dbCpu ?? 0,
      };
      setSeries((s) => appendPoint(s, p));
      setLatest(p);
    } else if (msg.type === 'recovered') {
      setRecovered(true);
    }
  }, []);

  return { series, latest, recovered, handleMessage };
}

function tileClass(latency: number | undefined): string {
  if (latency == null) return '';
  if (latency < RECOVERY_THRESHOLD) return 'ok';
  if (latency < 200) return 'warn';
  return 'bad';
}

function fieldToService(field: string): string {
  return field.replace(/^HOST_PORT_/, '').toLowerCase().replace(/_/g, '-');
}

interface ServiceEndpointsProps {
  portMap: Record<string, string | number> | null | undefined;
}

function ServiceEndpoints({ portMap }: ServiceEndpointsProps): JSX.Element | null {
  const entries = Object.entries(portMap || {});
  if (entries.length === 0) return null;
  const copy = async (url: string): Promise<void> => {
    try { await navigator.clipboard.writeText(url); } catch (_e) { /* noop */ }
  };
  return (
    <div className="endpoints">
      <h4>Sandbox endpoints</h4>
      <ul>
        {entries.map(([field, port]) => {
          const svc = fieldToService(field);
          const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
          const url = `http://${host}:${port}`;
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

interface MetricsDashboardProps {
  series: MetricsSeriesPoint[];
  latest: MetricsSeriesPoint | null;
  recovered: boolean;
  portMap?: Record<string, string | number> | null;
}

export default function MetricsDashboard({ series, latest, recovered, portMap }: MetricsDashboardProps): JSX.Element {
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
                <span>min <b>{Math.round(minLatency!)}</b> ms</span>
                <span>avg <b>{Math.round(avgLatency)}</b> ms</span>
                <span>max <b>{Math.round(maxLatency!)}</b> ms</span>
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
