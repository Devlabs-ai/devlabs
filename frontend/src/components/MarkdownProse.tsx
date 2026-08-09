import React from 'react';
import ReadOnlyCodePane from './ReadOnlyCodePane';

function inlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s:|-]+\|[\s:|-]*\|?$/.test(line.trim()) && line.includes('-');
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.includes('|', 1);
}

function splitCells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

function parseTable(
  lines: string[],
  start: number,
): { element: React.ReactNode; nextIndex: number } | null {
  if (!isTableRow(lines[start])) return null;
  const header = splitCells(lines[start]);
  if (header.length < 2) return null;
  if (start + 1 >= lines.length || !isTableSeparator(lines[start + 1])) return null;

  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length && isTableRow(lines[i]) && !isTableSeparator(lines[i])) {
    const cells = splitCells(lines[i]);
    while (cells.length < header.length) cells.push('');
    rows.push(cells.slice(0, header.length));
    i++;
  }

  const element = (
    <div key={`table-${start}`} className="markdown-table-wrap">
      <table className="markdown-table">
        <thead>
          <tr>
            {header.map((cell, ci) => (
              <th key={ci}>{inlineMarkdown(cell || '\u00a0')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>{inlineMarkdown(cell || '\u00a0')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return { element, nextIndex: i - 1 };
}

/** Normalize fence language tags to Monaco ids. */
function normalizeFenceLang(raw: string): string {
  const lang = (raw || '').trim().toLowerCase().split(/\s+/)[0] || '';
  if (!lang) return 'plaintext';
  if (lang === 'py' || lang === 'python3') return 'python';
  if (lang === 'js') return 'javascript';
  if (lang === 'ts') return 'typescript';
  if (lang === 'sh' || lang === 'bash' || lang === 'shell') return 'shell';
  if (lang === 'yml') return 'yaml';
  if (lang === 'text' || lang === 'plain' || lang === 'txt') return 'plaintext';
  return lang;
}

function pathForFenceLang(lang: string): string {
  switch (lang) {
    case 'python':
      return 'snippet.py';
    case 'sql':
      return 'snippet.sql';
    case 'javascript':
      return 'snippet.js';
    case 'typescript':
      return 'snippet.ts';
    case 'json':
      return 'snippet.json';
    case 'yaml':
      return 'snippet.yaml';
    case 'shell':
      return 'snippet.sh';
    case 'markdown':
      return 'snippet.md';
    default:
      return 'snippet.txt';
  }
}

/** Trim / dedent fence bodies so Theory snippets render cleanly. */
function formatFenceContent(raw: string, lang: string): string {
  let text = raw.replace(/\r\n/g, '\n').replace(/\t/g, '    ');
  const lines = text.split('\n').map((l) => l.replace(/[ \t]+$/g, ''));

  // Drop leading / trailing blank lines
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();

  const nonEmpty = lines.filter((l) => l.trim() !== '');
  if (nonEmpty.length) {
    const indent = Math.min(
      ...nonEmpty.map((l) => {
        const m = l.match(/^[ ]*/);
        return m ? m[0].length : 0;
      }),
    );
    if (indent > 0) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(' '.repeat(indent))) {
          lines[i] = lines[i].slice(indent);
        }
      }
    }
  }

  // Collapse runs of blank lines
  const collapsed: string[] = [];
  for (const line of lines) {
    if (line.trim() === '' && collapsed.length && collapsed[collapsed.length - 1] === '') {
      continue;
    }
    collapsed.push(line);
  }

  let out = collapsed.join('\n');
  if (lang === 'sql') {
    out = formatSqlLight(out);
  } else if (lang === 'python') {
    out = formatPythonLight(out);
  }
  // No trailing newline — Monaco would render an empty last line.
  return out.replace(/\n+$/g, '');
}

/** Light SQL pretty-print for short Theory examples (keeps string literals intact). */
function formatSqlLight(sql: string): string {
  const trimmed = sql.trim();
  // Multi-line already authored — only normalize spaces inside single-line snippets.
  if (trimmed.includes('\n')) {
    return trimmed
      .split('\n')
      .map((l) => l.replace(/[ \t]+$/g, ''))
      .join('\n');
  }
  return trimmed
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*=\s*/g, ' = ')
    .trim();
}

/** Light Python cleanup — preserve structure, fix trailing whitespace / blank runs. */
function formatPythonLight(code: string): string {
  return code
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function fenceLabel(lang: string): string {
  if (lang === 'plaintext') return 'code';
  return lang;
}

function renderMarkdown(text: string): React.ReactNode[] | null {
  if (!text) return null;
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceOpen = line.trim().match(/^```([\w+-]*)\s*$/);

    if (fenceOpen) {
      const lang = normalizeFenceLang(fenceOpen[1] || '');
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      const content = formatFenceContent(body.join('\n'), lang);
      const path = pathForFenceLang(lang);
      elements.push(
        <div key={key++} className="markdown-code-block">
          <div className="markdown-code-toolbar">
            <span className="markdown-code-lang">{fenceLabel(lang)}</span>
          </div>
          <ReadOnlyCodePane
            path={path}
            content={content}
            language={lang}
            className="markdown-code-pane"
          />
        </div>,
      );
      continue;
    }

    if (/^#{1,4}\s/.test(line)) {
      const level = (line.match(/^(#+)/) as RegExpMatchArray)[1].length;
      const content = line.replace(/^#+\s*/, '');
      const Tag = `h${Math.min(level + 2, 6)}` as keyof JSX.IntrinsicElements;
      elements.push(
        React.createElement(
          Tag,
          { key: key++, className: 'markdown-heading' },
          inlineMarkdown(content),
        ),
      );
    } else if (isTableRow(line)) {
      const table = parseTable(lines, i);
      if (table) {
        elements.push(React.cloneElement(table.element as React.ReactElement, { key: key++ }));
        i = table.nextIndex;
      } else {
        elements.push(<p key={key++}>{inlineMarkdown(line)}</p>);
      }
    } else if (/^[-*]\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(<li key={key++}>{inlineMarkdown(lines[i].replace(/^[-*]\s*/, ''))}</li>);
        i++;
      }
      i--;
      elements.push(<ul key={key++} className="markdown-list">{items}</ul>);
    } else if (/^\d+\.\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(<li key={key++}>{inlineMarkdown(lines[i].replace(/^\d+\.\s*/, ''))}</li>);
        i++;
      }
      i--;
      elements.push(<ol key={key++} className="markdown-list markdown-list--ordered">{items}</ol>);
    } else if (line.trim() === '') {
      elements.push(<div key={key++} className="markdown-spacer" />);
    } else {
      elements.push(<p key={key++}>{inlineMarkdown(line)}</p>);
    }
  }
  return elements;
}

interface MarkdownProseProps {
  text: string | undefined | null;
  className?: string;
}

/** Renders challenge-style markdown (headings, lists, tables, fences, bold, inline code). */
export default function MarkdownProse({ text, className = 'markdown-prose' }: MarkdownProseProps): JSX.Element | null {
  if (!text?.trim()) return null;
  return <div className={className}>{renderMarkdown(text)}</div>;
}
