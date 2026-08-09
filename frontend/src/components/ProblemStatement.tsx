import React from 'react';
import MarkdownProse from './MarkdownProse';
import ReadOnlyCodePane from './ReadOnlyCodePane';
import type { ChallengePublic, ChallengeFull } from '../types/domain';

export type ProblemStatementTab =
  | 'description'
  | 'hints'
  | 'spec'
  | 'solution'
  | 'theory'
  | 'submissions';

interface ProblemStatementProps {
  challenge: ChallengePublic | ChallengeFull | null | undefined;
  /** When set, render only that tab's content (TensorTonic-style brief). */
  tab?: ProblemStatementTab;
  /** Extra Spec-tab content (paths, grade checks) rendered after schema. */
  specExtra?: React.ReactNode;
  /** Submissions tab body (owned by workspace). */
  submissionsSlot?: React.ReactNode;
  /** MinIO solution/ files (path → content). Prefer over problemStatement.solution write-up. */
  solutionFiles?: Record<string, string> | null;
  solutionEntrypoint?: string | null;
  solutionLoading?: boolean;
  solutionError?: string | null;
}

interface ProblemStatementData {
  incident?: string;
  situation?: string;
  overview?: string;
  yourTask?: string;
  yourTaskSteps?: string[];
  symptoms?: string[];
  hints?: string[];
  /** Optional official write-up / approach (markdown or plain text). */
  solution?: string;
  solutionWriteup?: string;
  /** Concept / API theory for this lab (markdown). */
  theory?: string;
  dbAccess?: string[];
  inputSchema?: Array<{ column: string; type: string }>;
  expectedOutput?: Array<{ column: string; description: string }>;
  [key: string]: unknown;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPs(challenge: ChallengePublic | ChallengeFull): ProblemStatementData {
  const full = challenge as ChallengeFull;
  return (typeof full.problemStatement === 'object' && full.problemStatement !== null
    ? full.problemStatement
    : {}) as ProblemStatementData;
}

function sortSolutionPaths(paths: string[], entrypoint?: string | null): string[] {
  const entry = (entrypoint || 'src/main.py').replace(/^\/+/, '');
  return [...paths].sort((a, b) => {
    if (a === entry) return -1;
    if (b === entry) return 1;
    if (a.startsWith('src/') && !b.startsWith('src/')) return -1;
    if (b.startsWith('src/') && !a.startsWith('src/')) return 1;
    return a.localeCompare(b);
  });
}

export default function ProblemStatement({
  challenge,
  tab,
  specExtra,
  submissionsSlot,
  solutionFiles,
  solutionEntrypoint,
  solutionLoading,
  solutionError,
}: ProblemStatementProps): JSX.Element | null {
  if (!challenge) return null;

  const ps = getPs(challenge);
  const hasLegacyStructured = Boolean(ps.incident || ps.situation);
  const hasBatchStructured = Boolean(
    ps.overview || ps.yourTask || ps.yourTaskSteps?.length || (ps.symptoms && ps.symptoms.length),
  );
  const rawDescription = challenge.description?.trim() || '';
  const descriptionText = rawDescription.replace(
    new RegExp(`^#{1,2}\\s+${escapeRegExp(challenge.title)}\\s*\\n+`, 'i'),
    '',
  );
  const hasDescription = !!descriptionText;
  const hints = Array.isArray(ps.hints) ? ps.hints : [];
  const inputSchema = Array.isArray(ps.inputSchema) ? ps.inputSchema : [];
  const expectedOutput = Array.isArray(ps.expectedOutput) ? ps.expectedOutput : [];
  const solutionText = (
    (typeof ps.solution === 'string' && ps.solution.trim())
    || (typeof ps.solutionWriteup === 'string' && ps.solutionWriteup.trim())
    || ''
  );
  const theoryText = typeof ps.theory === 'string' ? ps.theory.trim() : '';

  if (tab === 'solution') {
    const filePaths = solutionFiles
      ? sortSolutionPaths(Object.keys(solutionFiles), solutionEntrypoint)
      : [];
    return (
      <div className="statement statement--tab">
        <h2>Solution</h2>
        <hr className="statement-rule" aria-hidden="true" />
        {solutionLoading ? (
          <p className="dim" style={{ fontSize: 13 }}>Loading reference solution from MinIO…</p>
        ) : solutionError ? (
          <div className="statement-empty">
            <p>{solutionError}</p>
          </div>
        ) : filePaths.length > 0 ? (
          <div className="statement-solution-files">
            {filePaths.map((path) => {
              const body = solutionFiles![path];
              const isMd = /\.md$/i.test(path);
              return (
                <section key={path} className="statement-section statement-solution-file">
                  <h4>
                    <code>{path}</code>
                  </h4>
                  {isMd ? (
                    <MarkdownProse text={body} className="markdown-prose statement-solution" />
                  ) : (
                    <ReadOnlyCodePane
                      path={path}
                      content={body}
                      className="statement-solution-code-pane"
                    />
                  )}
                </section>
              );
            })}
          </div>
        ) : solutionText ? (
          <MarkdownProse text={solutionText} className="markdown-prose statement-solution" />
        ) : (
          <div className="statement-empty">
            <p>Official solution is not published for this lab yet.</p>
            <p className="dim">
              Keep iterating in the editor — Submit grades against the golden expected set.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (tab === 'theory') {
    return (
      <div className="statement statement--tab">
        <h2>Theory</h2>
        <hr className="statement-rule" aria-hidden="true" />
        {theoryText ? (
          <MarkdownProse text={theoryText} className="markdown-prose statement-theory" />
        ) : (
          <p className="dim" style={{ fontSize: 13 }}>
            Theory for this lab is not published yet.
          </p>
        )}
      </div>
    );
  }

  if (tab === 'submissions') {
    return (
      <div className="statement statement--tab">
        <h2>Submissions</h2>
        <hr className="statement-rule" aria-hidden="true" />
        {submissionsSlot || (
          <p className="dim" style={{ fontSize: 13 }}>No submissions yet.</p>
        )}
      </div>
    );
  }

  if (tab === 'hints') {
    return (
      <div className="statement statement--tab">
        <h2>Hints</h2>
        <hr className="statement-rule" aria-hidden="true" />
        {hints.length > 0 ? (
          <ul className="statement-hint-list">
            {hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        ) : (
          <p className="dim" style={{ fontSize: 13 }}>No hints for this challenge.</p>
        )}
      </div>
    );
  }

  if (tab === 'spec') {
    return (
      <div className="statement statement--tab">
        <h2>Spec</h2>
        <hr className="statement-rule" aria-hidden="true" />

        {inputSchema.length > 0 && (
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
                  {inputSchema.map((col) => (
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

        {expectedOutput.length > 0 && (
          <section className="statement-section">
            <h4>Expected output</h4>
            <div className="statement-table-wrap">
              <table className="statement-table">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {expectedOutput.map((col) => (
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

        {specExtra}

        {inputSchema.length === 0 && expectedOutput.length === 0 && !specExtra && (
          <p className="dim" style={{ fontSize: 13 }}>
            No schema details — see README.md in the project workspace.
          </p>
        )}
      </div>
    );
  }

  // Description tab (or legacy full view when tab omitted)
  const showHintsInline = !tab && hints.length > 0;
  const showSchemaInline = !tab;

  return (
    <div className={`statement${tab ? ' statement--tab' : ''}`}>
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

          {showSchemaInline && inputSchema.length > 0 && (
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
                    {inputSchema.map((col) => (
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

          {showSchemaInline && expectedOutput.length > 0 && (
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
                    {expectedOutput.map((col) => (
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

          {showHintsInline && (
            <section className="statement-section statement-hints">
              <h4>Hints</h4>
              <ul className="statement-hint-list">
                {hints.map((h) => (
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
