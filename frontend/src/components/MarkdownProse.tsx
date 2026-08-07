import React from 'react';

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

function renderMarkdown(text: string): React.ReactNode[] | null {
  if (!text) return null;
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

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

/** Renders challenge-style markdown (headings, lists, tables, bold, inline code). */
export default function MarkdownProse({ text, className = 'markdown-prose' }: MarkdownProseProps): JSX.Element | null {
  if (!text?.trim()) return null;
  return <div className={className}>{renderMarkdown(text)}</div>;
}
