import React, { useLayoutEffect, useMemo, useRef } from 'react';

export type ActivityDay = { day: string; count: number };

const WEEKS = 53;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function level(count: number): number {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

type Cell = { key: string; date: Date; count: number; future: boolean };

/** GitHub-style calendar of the last year; `activity` days are local YYYY-MM-DD keys. */
export default function ActivityHeatmap({ activity }: { activity: ActivityDay[] }): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { weeks, monthLabels, total, activeDays, currentStreak, longestStreak } = useMemo(() => {
    const counts = new Map(activity.map((a) => [a.day, a.count]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - start.getDay() - (WEEKS - 1) * 7);

    const cols: Cell[][] = [];
    const labels: Array<{ col: number; label: string }> = [];
    let lastMonth = -1;
    let sum = 0;
    let active = 0;
    let run = 0;
    let longest = 0;
    for (let w = 0; w < WEEKS; w += 1) {
      const col: Cell[] = [];
      for (let d = 0; d < 7; d += 1) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        const key = dayKey(date);
        const future = date > today;
        const count = future ? 0 : counts.get(key) ?? 0;
        if (!future) {
          sum += count;
          if (count > 0) {
            active += 1;
            run += 1;
            longest = Math.max(longest, run);
          } else if (date < today) {
            run = 0;
          }
        }
        col.push({ key, date, count, future });
      }
      const month = col[0].date.getMonth();
      if (month !== lastMonth) {
        if (w < WEEKS - 2) labels.push({ col: w, label: MONTHS[month] });
        lastMonth = month;
      }
      cols.push(col);
    }
    return { weeks: cols, monthLabels: labels, total: sum, activeDays: active, currentStreak: run, longestStreak: longest };
  }, [activity]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks]);

  return (
    <div className="heatmap">
      <dl className="heatmap-summary">
        <div>
          <dt>{total === 1 ? 'Activity' : 'Activities'} · last year</dt>
          <dd>{total}</dd>
        </div>
        <div>
          <dt>Active days</dt>
          <dd>{activeDays}</dd>
        </div>
        <div>
          <dt>Current streak</dt>
          <dd>{currentStreak} {currentStreak === 1 ? 'day' : 'days'}</dd>
        </div>
        <div>
          <dt>Best streak</dt>
          <dd>{longestStreak} {longestStreak === 1 ? 'day' : 'days'}</dd>
        </div>
      </dl>

      <div className="heatmap-scroll" ref={scrollRef}>
        <div className="heatmap-body" style={{ '--heatmap-weeks': WEEKS } as React.CSSProperties}>
          <div className="heatmap-months" aria-hidden="true">
            {monthLabels.map((m) => (
              <span key={`${m.col}-${m.label}`} style={{ gridColumn: m.col + 1 }}>{m.label}</span>
            ))}
          </div>
          <div className="heatmap-days" aria-hidden="true">
            <span />
            <span>Mon</span>
            <span />
            <span>Wed</span>
            <span />
            <span>Fri</span>
            <span />
          </div>
          <div className="heatmap-grid" role="img" aria-label={`${total} activities across ${activeDays} days in the last year`}>
            {weeks.flat().map((cell) => (
              <span
                key={cell.key}
                className={`heatmap-cell heatmap-cell--${level(cell.count)}${cell.future ? ' is-future' : ''}`}
                title={
                  cell.future
                    ? undefined
                    : `${cell.count} ${cell.count === 1 ? 'activity' : 'activities'} on ${cell.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
                }
              />
            ))}
          </div>
        </div>
      </div>

      <div className="heatmap-legend" aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`heatmap-cell heatmap-cell--${l}`} />)}
        <span>More</span>
      </div>
    </div>
  );
}
