import React from 'react';
import MarkdownProse from './MarkdownProse';
import type { ChallengePublic, ChallengeFull } from '../types/domain';

interface ProblemStatementProps {
  challenge: ChallengePublic | ChallengeFull | null | undefined;
}

interface ProblemStatementData {
  incident?: string;
  situation?: string;
  overview?: string;
  yourTask?: string;
  yourTaskSteps?: string[];
  symptoms?: string[];
  hints?: string[];
  dbAccess?: string[];
  inputSchema?: Array<{ column: string; type: string }>;
  expectedOutput?: Array<{ column: string; description: string }>;
  [key: string]: unknown;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default function ProblemStatement({ challenge }: ProblemStatementProps): JSX.Element | null {
  if (!challenge) return null;

  const full = challenge as ChallengeFull;
  const ps = (typeof full.problemStatement === 'object' && full.problemStatement !== null
    ? full.problemStatement
    : {}) as ProblemStatementData;
  const hasLegacyStructured = Boolean(ps.incident || ps.situation);
  const hasBatchStructured = Boolean(ps.overview || ps.yourTask || ps.yourTaskSteps?.length || (ps.symptoms && ps.symptoms.length));
  const rawDescription = challenge.description?.trim() || '';
  // Drop a leading H1/H2 that duplicates the page title (common in seeded markdown).
  const descriptionText = rawDescription.replace(
    new RegExp(`^#{1,2}\\s+${escapeRegExp(challenge.title)}\\s*\\n+`, 'i'),
    '',
  );
  const hasDescription = !!descriptionText;

  return (
    <div className="statement">
      <h2>{challenge.title}</h2>
      <hr className="statement-rule" aria-hidden="true" />

      {hasDescription && (
        <MarkdownProse text={descriptionText} className="markdown-prose statement-description" />
      )}

      {hasBatchStructured ? (
        <>
          {!hasDescription && ps.overview && (
            <p className="statement-overview">{ps.overview}</p>
          )}

          {!hasDescription && Array.isArray(ps.symptoms) && ps.symptoms.length > 0 && (
            <section className="statement-section">
              <h4>Context</h4>
              <ul className="statement-prose-list">
                {ps.symptoms.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </section>
          )}

          {(ps.yourTaskSteps?.length || ps.yourTask) && (
            <section className="statement-section">
              <h4>Your task</h4>
              {ps.yourTaskSteps && ps.yourTaskSteps.length > 0 ? (
                <ol className="statement-task-list">
                  {ps.yourTaskSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ) : (
                <p>{ps.yourTask}</p>
              )}
            </section>
          )}

          {Array.isArray(ps.inputSchema) && ps.inputSchema.length > 0 && (
            <section className="statement-section">
              <h4>Input schema</h4>
              <div className="statement-table-wrap">
                <table className="statement-table">
                  <thead>
                    <tr>
                      <th>Column</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ps.inputSchema.map((col) => (
                      <tr key={col.column}>
                        <td className="statement-table-col">{col.column}</td>
                        <td className="statement-table-type">{col.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {Array.isArray(ps.expectedOutput) && ps.expectedOutput.length > 0 && (
            <section className="statement-section">
              <h4>Expected output</h4>
              <p className="statement-caption">
                Dataset: <span className="statement-dataset-name">daily_product_summary</span>
              </p>
              <div className="statement-table-wrap">
                <table className="statement-table">
                  <thead>
                    <tr>
                      <th>Column</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ps.expectedOutput.map((col) => (
                      <tr key={col.column}>
                        <td className="statement-table-col">{col.column}</td>
                        <td>{col.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {Array.isArray(ps.hints) && ps.hints.length > 0 && (
            <section className="statement-section statement-hints">
              <h4>Hints</h4>
              <ul className="statement-hint-list">
                {ps.hints.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : hasLegacyStructured ? (
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
      ) : !hasDescription ? (
        <p className="dim" style={{ fontSize: 13 }}>No problem statement available.</p>
      ) : null}
    </div>
  );
}
