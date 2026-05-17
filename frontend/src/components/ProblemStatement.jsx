import React from 'react';

export default function ProblemStatement({ challenge }) {
  if (!challenge) return null;
  const ps = challenge.problemStatement || {};
  return (
    <div className="statement">
      <h2>{challenge.title}</h2>
      {ps.incident && (
        <p><strong>Incident.</strong> {ps.incident}</p>
      )}
      {ps.situation && <p>{ps.situation}</p>}
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
    </div>
  );
}
