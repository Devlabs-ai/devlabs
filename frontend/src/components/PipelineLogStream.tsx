import React, { useEffect, useRef } from 'react';
import { parseLogLines, type PipelineLogEntry } from '../utils/pipelineLogFormat';

interface PipelineLogStreamProps {
  lines: string[];
  scrollKey?: number | null;
  thinking?: string | null;
}

function entryClass(entry: PipelineLogEntry): string {
  if (entry.kind === 'thinking') return 'log-thinking';
  if (entry.kind === 'codeStep') return 'log-code-step';
  if (entry.kind === 'codeDiff') return 'log-code-diff';
  if (entry.kind === 'separator') return 'log-separator';
  if (entry.kind === 'text') return `log-line log-${entry.level}`;
  return 'log-line';
}

function CodeDiffView({ entry }: { entry: Extract<PipelineLogEntry, { kind: 'codeDiff' }> }): JSX.Element {
  const title = entry.summary
    ? 'Repair summary — all file changes'
    : `${entry.tool} · ${entry.path}`;
  return (
    <details className="log-entry log-code-diff" open={!entry.summary}>
      <summary className="log-code-diff-summary">
        <span className="log-code-diff-badge">{entry.summary ? 'Summary' : 'Diff'}</span>
        <span className="log-code-diff-title">{title}</span>
      </summary>
      <pre className="log-code-diff-body">{entry.body}</pre>
    </details>
  );
}

function LogEntryView({ entry }: { entry: PipelineLogEntry }): JSX.Element {
  if (entry.kind === 'thinking') {
    return (
      <div className="log-entry log-thinking">
        <span className="log-thinking-dot" aria-hidden />
        <span className="log-thinking-label">{entry.label}</span>
        <span className="log-thinking-meta">step {entry.step + 1}</span>
      </div>
    );
  }
  if (entry.kind === 'codeStep') {
    const [toolsMain, hint] = entry.tools.includes(' — ')
      ? entry.tools.split(' — ', 2)
      : [entry.tools, null];
    const showMeta = entry.ms > 0 || (entry.cost !== '—' && entry.tokens !== '—');
    const longPlainStep = !hint && !showMeta && toolsMain.length > 48;
    return (
      <div className="log-entry log-code-step">
        <div className="log-code-step-head">
          <span className="log-code-step-badge">Step {entry.step + 1}</span>
          {!longPlainStep && (
            <span className="log-code-step-tools">{toolsMain}</span>
          )}
          {showMeta && (
            <span className="log-code-step-meta">
              {(entry.ms / 1000).toFixed(1)}s · {entry.cost} · {entry.tokens}
            </span>
          )}
        </div>
        {longPlainStep && (
          <div className="log-code-step-body">{toolsMain}</div>
        )}
        {hint && (
          <div className={`log-code-step-hint${hint.includes('⚠') ? ' log-code-step-hint-warn' : ''}`}>
            {hint}
          </div>
        )}
        {!hint && !longPlainStep && toolsMain.length > 80 && (
          <div className="log-code-step-body">{toolsMain}</div>
        )}
      </div>
    );
  }
  if (entry.kind === 'codeDiff') {
    return <CodeDiffView entry={entry} />;
  }
  if (entry.kind === 'separator') {
    return <div className="log-entry log-separator">{entry.text}</div>;
  }
  return <div className={`log-entry ${entryClass(entry)}`}>{entry.text}</div>;
}

export default function PipelineLogStream({
  lines,
  scrollKey = null,
  thinking = null,
}: PipelineLogStreamProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const entries = parseLogLines(lines);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length, scrollKey, thinking]);

  return (
    <div id="pipeline-logs" className="log-stream pipeline-log-stream" ref={ref}>
      {entries.length === 0 && !thinking && (
        <div className="log-empty">Logs will appear here once the build starts.</div>
      )}
      {entries.map((entry, i) => (
        <LogEntryView key={`${i}-${entry.kind}`} entry={entry} />
      ))}
      {thinking && (
        <div className="log-entry log-thinking log-thinking-live">
          <span className="log-thinking-dot" aria-hidden />
          <span className="log-thinking-label">{thinking}</span>
        </div>
      )}
    </div>
  );
}
