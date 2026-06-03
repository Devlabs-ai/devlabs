import React from 'react';
import MarkdownProse from './MarkdownProse.jsx';

export default function ProblemStatement({ challenge }) {
  if (!challenge) return null;

  const ps = challenge.problemStatement || {};
  const hasStructured = ps.incident || ps.situation;
  const hasDescription = !!challenge.description?.trim();

  return (
    <div className="statement">
      <h2>{challenge.title}</h2>

      {hasStructured ? (
        <>
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
        </>
      ) : hasDescription ? (
        <MarkdownProse text={challenge.description} className="markdown-prose" />
      ) : (
        <p className="dim" style={{ fontSize: 13 }}>No problem statement available.</p>
      )}
    </div>
  );
}
