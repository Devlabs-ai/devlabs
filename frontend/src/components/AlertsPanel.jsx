import React, { useEffect, useState } from 'react';

export default function AlertsPanel({ latest }) {
  const [alert, setAlert] = useState(null);

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
