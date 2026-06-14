import React, { useEffect, useState } from 'react';
import type { MetricsSeriesPoint } from '../types/domain';

interface AlertEntry {
  id: number;
  message: string;
}

interface AlertsPanelProps {
  latest: MetricsSeriesPoint | null;
}

export default function AlertsPanel({ latest }: AlertsPanelProps): JSX.Element | null {
  const [alert, setAlert] = useState<AlertEntry | null>(null);

  useEffect(() => {
    if (!latest) return;
    if (latest.latency > 400) {
      setAlert({
        id: latest.ts,
        message: `High latency: ${Math.round(latest.latency)}ms`,
      });
    } else if (latest.latency < 50 && alert) {
      setAlert(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);

  if (!alert) return null;

  return (
    <div className="alert warning" style={{ marginTop: 10 }}>
      <span style={{ fontWeight: 600 }}>⚠</span>
      {alert.message}
    </div>
  );
}
