import React from 'react';

export default function ProblemStatement({ challenge }) {
  if (!challenge) return null;
  const ps = challenge.problemStatement || {};
  return (
    <div className="statement">
      <h2>{challenge.title}</h2>
      {ps.severity && <span className="severity">Severity {ps.severity}</span>}
      {ps.incident && (
        <p><strong>Incident.</strong> {ps.incident}</p>
      )}
      {ps.situation && <p>{ps.situation}</p>}
      {ps.architecture && (
        <p><strong>Architecture.</strong> {ps.architecture}</p>
      )}
      {Array.isArray(ps.tasks) && ps.tasks.length > 0 && (
        <>
          <h4>Tasks</h4>
          <ol>
            {ps.tasks.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </>
      )}
      {Array.isArray(ps.dbAccess) && ps.dbAccess.length > 0 && (
        <div className="access">
          <h4>Access</h4>
          <ul>
            {ps.dbAccess.map((a, i) => (
              <li key={i}><code>{a}</code></li>
            ))}
          </ul>
        </div>
      )}
      {ps.scoring && (
        <>
          <h4>Scoring</h4>
          <p style={{ marginTop: 0 }}>{ps.scoring}</p>
        </>
      )}
    </div>
  );
}
