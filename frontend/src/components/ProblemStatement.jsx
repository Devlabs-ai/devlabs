import React from 'react';

function renderMarkdown(text) {
  if (!text) return null;
  // Minimal inline markdown: **bold**, `code`, headings, bullet lists
  const lines = text.split('\n');
  const elements = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^(#+)/)[1].length;
      const content = line.replace(/^#+\s*/, '');
      const Tag = `h${Math.min(level + 2, 6)}`;
      elements.push(<Tag key={key++} className="ps-heading">{inlineMarkdown(content)}</Tag>);
    } else if (/^[-*]\s/.test(line)) {
      // Collect consecutive bullet lines
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(<li key={key++}>{inlineMarkdown(lines[i].replace(/^[-*]\s*/, ''))}</li>);
        i++;
      }
      i--;
      elements.push(<ul key={key++} className="ps-list">{items}</ul>);
    } else if (line.trim() === '') {
      elements.push(<div key={key++} className="ps-spacer" />);
    } else {
      elements.push(<p key={key++}>{inlineMarkdown(line)}</p>);
    }
  }
  return elements;
}

function inlineMarkdown(text) {
  // Split by **bold** and `code`
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
        <div className="ps-description">
          {renderMarkdown(challenge.description)}
        </div>
      ) : (
        <p className="dim" style={{ fontSize: 13 }}>No problem statement available.</p>
      )}
    </div>
  );
}
