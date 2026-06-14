import React from 'react';
import MarkdownProse from './MarkdownProse';
import type { ChallengePublic, ChallengeFull } from '../types/domain';

interface ProblemStatementProps {
  challenge: ChallengePublic | ChallengeFull | null | undefined;
}

interface ProblemStatementData {
  incident?: string;
  situation?: string;
  dbAccess?: string[];
  [key: string]: unknown;
}

export default function ProblemStatement({ challenge }: ProblemStatementProps): JSX.Element | null {
  if (!challenge) return null;

  const full = challenge as ChallengeFull;
  const ps = (typeof full.problemStatement === 'object' && full.problemStatement !== null
    ? full.problemStatement
    : {}) as ProblemStatementData;
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
