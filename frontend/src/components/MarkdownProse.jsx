import React from 'react';

function inlineMarkdown(text) {
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

function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^#{1,4}\s/.test(line)) {
      const level = line.match(/^(#+)/)[1].length;
      const content = line.replace(/^#+\s*/, '');
      const Tag = `h${Math.min(level + 2, 6)}`;
      elements.push(
        <Tag key={key++} className="markdown-heading">
          {inlineMarkdown(content)}
        </Tag>,
      );
    } else if (/^[-*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(<li key={key++}>{inlineMarkdown(lines[i].replace(/^[-*]\s*/, ''))}</li>);
        i++;
      }
      i--;
      elements.push(<ul key={key++} className="markdown-list">{items}</ul>);
    } else if (/^\d+\.\s/.test(line)) {
      const items = [];
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

/** Renders challenge-style markdown (headings, lists, bold, inline code). */
export default function MarkdownProse({ text, className = 'markdown-prose' }) {
  if (!text?.trim()) return null;
  return <div className={className}>{renderMarkdown(text)}</div>;
}
