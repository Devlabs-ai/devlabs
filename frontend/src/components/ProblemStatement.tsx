import React from 'react';
import MarkdownProse from './MarkdownProse';
import ReadOnlyCodePane from './ReadOnlyCodePane';
import type { ChallengePublic, ChallengeFull } from '../types/domain';

export type ProblemStatementTab =
  | 'description'
  | 'data'
  | 'spec'
  | 'cluster'
  | 'knobs'
  | 'solution'
  | 'moat'
  | 'submissions'
  | 'notes'
  | 'resources'
  | 'runs';

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
  /** Setter-only design notes (markdown). Omitted for learners. */
  moat?: string;
  solutionWriteup?: string;
  dbAccess?: string[];
  inputSchema?: Array<{ column: string; type: string }>;
  expectedOutput?: Array<{ column: string; description: string }>;
  /** Data tab — schemas + a glance at distribution. */
  data?: {
    overview?: string;
    datasets?: Array<{
      name: string;
      env?: string;
      kind?: string;
      blurb?: string;
      distribution?: string;
      rowCount?: number;
      sizeBytes?: number;
      format?: string;
      schema?: Array<{ column: string; type: string }>;
    }>;
    testcases?: {
      run?: Array<{ name?: string; rows?: number; detail?: string }>;
      submit?: Array<{ name?: string; rows?: number; detail?: string }>;
    };
  };
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
  const readme = paths.find((p) => /^readme\.md$/i.test(p.replace(/^\/+/, '')));
  return [...paths].sort((a, b) => {
    if (readme && a === readme) return -1;
    if (readme && b === readme) return 1;
    if (a === entry) return -1;
    if (b === entry) return 1;
    if (a.startsWith('src/') && !b.startsWith('src/')) return -1;
    if (b.startsWith('src/') && !a.startsWith('src/')) return 1;
    return a.localeCompare(b);
  });
}

function formatDatasetRows(n: number): string {
  return n.toLocaleString('en-US');
}

function formatTestcaseCount(n: number): string {
  return n === 1 ? '1 testcase' : `${n} testcases`;
}

type TestcaseNote = { name: string; rows: number | null; detail: string };

function parseTestcaseGroup(raw: unknown): TestcaseNote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const rec = item as { name?: unknown; rows?: unknown; detail?: unknown };
      const name = typeof rec.name === 'string' ? rec.name.trim() : '';
      const rows = typeof rec.rows === 'number' && Number.isFinite(rec.rows) ? rec.rows : null;
      const detail = typeof rec.detail === 'string' ? rec.detail.trim() : '';
      if (!name && rows == null && !detail) return null;
      return { name, rows, detail };
    })
    .filter((item): item is TestcaseNote => item != null);
}

function TestcasesBlock({
  run,
  submit,
}: {
  run: TestcaseNote[];
  submit: TestcaseNote[];
}): JSX.Element | null {
  if (run.length === 0 && submit.length === 0) return null;
  return (
    <section className="statement-section">
      <h4>Testcases</h4>
      <div className="statement-testcase-grid">
        {([
          ['Run', run],
          ['Submit', submit],
        ] as Array<[string, TestcaseNote[]]>).map(([label, cases]) => {
          if (cases.length === 0) return null;
          const totalRows = cases.reduce((sum, c) => sum + (c.rows ?? 0), 0);
          const allHaveRows = cases.every((c) => c.rows != null);
          return (
            <div key={label} className="statement-testcase-group">
              <h5>{label}</h5>
              <p className="statement-dataset-stats">
                {[
                  formatTestcaseCount(cases.length),
                  allHaveRows && totalRows > 0
                    ? `${formatDatasetRows(totalRows)} rows`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {cases.map((c, i) => (
                <div key={`${label}-${c.name || i}`} className="statement-testcase-item">
                  {c.name && <p className="statement-testcase-name">{c.name}</p>}
                  {cases.length > 1 && c.rows != null && (
                    <p className="statement-dataset-stats">
                      {formatDatasetRows(c.rows)} rows
                    </p>
                  )}
                  {c.detail && <p className="statement-caption">{c.detail}</p>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ExpectedOutputBlock({
  columns,
}: {
  columns: Array<{ column: string; description: string }>;
}): JSX.Element | null {
  if (columns.length === 0) return null;
  return (
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
            {columns.map((col) => (
              <tr key={col.column}>
                <td className="statement-table-col">{col.column}</td>
                <td>{col.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatDatasetBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
  const inputSchema = Array.isArray(ps.inputSchema) ? ps.inputSchema : [];
  const expectedOutput = Array.isArray(ps.expectedOutput) ? ps.expectedOutput : [];
  const dataOverview = typeof ps.data?.overview === 'string' ? ps.data.overview.trim() : '';
  const datasets = Array.isArray(ps.data?.datasets) ? ps.data.datasets : [];
  const runTestcases = parseTestcaseGroup(ps.data?.testcases?.run);
  const submitTestcases = parseTestcaseGroup(ps.data?.testcases?.submit);
  const hasTestcases = runTestcases.length > 0 || submitTestcases.length > 0;
  const solutionText = (
    (typeof ps.solution === 'string' && ps.solution.trim())
    || (typeof ps.solutionWriteup === 'string' && ps.solutionWriteup.trim())
    || ''
  );

  if (tab === 'moat') {
    const moatText = typeof ps.moat === 'string' ? ps.moat.trim() : '';
    return (
      <div className="statement statement--tab">
        <h2>Moat</h2>
        <p className="dim" style={{ fontSize: 12, margin: '4px 0 12px' }}>
          Problem-setter notes. Learners do not see this tab.
        </p>
        <hr className="statement-rule" aria-hidden="true" />
        {moatText ? (
          <MarkdownProse text={moatText} className="markdown-prose statement-description" />
        ) : (
          <div className="statement-empty">
            <p>No moat notes yet.</p>
            <p className="dim">
              Capture what was in mind before this lab existed, and how you went about creating it.
            </p>
          </div>
        )}
      </div>
    );
  }

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

  if (tab === 'data') {
    const fallbackDatasets = datasets.length > 0
      ? datasets
      : inputSchema.length > 0
        ? [{ name: 'Input', schema: inputSchema }]
        : [];
    return (
      <div className="statement statement--tab">
        <h2>Data</h2>
        <hr className="statement-rule" aria-hidden="true" />
        {dataOverview && (
          <p className="statement-overview" style={{ marginBottom: 16 }}>{dataOverview}</p>
        )}
        <TestcasesBlock run={runTestcases} submit={submitTestcases} />
        {fallbackDatasets.length === 0 ? (
          <p className="dim" style={{ fontSize: 13 }}>
            No dataset notes for this lab — see the description for paths and grain.
          </p>
        ) : (
          fallbackDatasets.map((ds) => {
            const schema = Array.isArray(ds.schema) ? ds.schema : [];
            const dist = typeof ds.distribution === 'string' ? ds.distribution.trim() : '';
            const blurb = typeof ds.blurb === 'string' ? ds.blurb.trim() : '';
            const rowCount = typeof ds.rowCount === 'number' && Number.isFinite(ds.rowCount)
              ? ds.rowCount
              : null;
            const sizeBytes = typeof ds.sizeBytes === 'number' && Number.isFinite(ds.sizeBytes)
              ? ds.sizeBytes
              : null;
            const format = typeof ds.format === 'string' ? ds.format.trim() : '';
            const hasStats = rowCount != null || sizeBytes != null || Boolean(format);
            return (
              <section key={ds.name} className="statement-section">
                <h4>
                  {ds.name}
                  {ds.env && (
                    <>
                      {' '}
                      <code>{ds.env}</code>
                    </>
                  )}
                </h4>
                {hasStats && (
                  <p className="statement-dataset-stats">
                    {[
                      rowCount != null ? `${formatDatasetRows(rowCount)} rows` : null,
                      sizeBytes != null ? formatDatasetBytes(sizeBytes) : null,
                      format || null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                {blurb && <p className="statement-caption">{blurb}</p>}
                {dist && <p className="statement-distribution">{dist}</p>}
                {schema.length > 0 && (
                  <div className="statement-table-wrap">
                    <table className="statement-table">
                      <thead>
                        <tr>
                          <th>Column</th>
                          <th>Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schema.map((col) => (
                          <tr key={col.column}>
                            <td className="statement-table-col">{col.column}</td>
                            <td className="statement-table-type">{col.type}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })
        )}
        <ExpectedOutputBlock columns={expectedOutput} />
      </div>
    );
  }

  if (tab === 'spec') {
    return (
      <div className="statement statement--tab">
        <h2>Spec</h2>
        <hr className="statement-rule" aria-hidden="true" />

        <TestcasesBlock run={runTestcases} submit={submitTestcases} />

        {specExtra}

        {!hasTestcases && !specExtra && (
          <p className="dim" style={{ fontSize: 13 }}>
            No schema details — see README.md in the project workspace.
          </p>
        )}
      </div>
    );
  }

  // Description tab (or legacy full view when tab omitted)
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
