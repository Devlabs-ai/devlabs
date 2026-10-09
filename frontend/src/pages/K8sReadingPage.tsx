import React, { useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  K8S_BLOG_STAMP_SRC,
  type K8sReadingCodeBlock,
  type K8sReadingFlow,
  type K8sReadingSection,
  type K8sReadingTable,
} from '../constants/k8sReadings';
import { READING_TRACKS, type ReadingTrackId } from '../constants/readingTracks';
import ReadOnlyCodePane from '../components/ReadOnlyCodePane';
import {
  ReadingCurationBlock,
  ReadingCurationProvider,
  ReadingCurationToolbar,
  readingCurationBlockId,
} from '../components/ReadingCuration';
import { useAppState } from '../context/AppStateContext';
import { isAdminUser, getCurrentUser } from '../services/authApi';

function RichTextInline({ text }: { text: string }): JSX.Element {
  // Order matters: **`code`** / *`code`* before **bold** / *italic*, then `code`.
  const parts = text
    .split(/(\*\*`[^`]+`\*\*|\*`[^`]+`\*|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g)
    .filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**`') && part.endsWith('`**') && part.length >= 6) {
          return (
            <strong key={i}>
              <code>{part.slice(3, -3)}</code>
            </strong>
          );
        }
        if (part.startsWith('*`') && part.endsWith('`*') && part.length >= 4) {
          return (
            <em key={i}>
              <code>{part.slice(2, -2)}</code>
            </em>
          );
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i}>
              {part
                .slice(2, -2)
                .split(/(`[^`]+`)/g)
                .filter(Boolean)
                .map((seg, j) =>
                  seg.startsWith('`') && seg.endsWith('`') && seg.length >= 2
                    ? <code key={j}>{seg.slice(1, -1)}</code>
                    : <React.Fragment key={j}>{seg}</React.Fragment>,
                )}
            </strong>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        if (
          part.length >= 3 &&
          part.startsWith('*') &&
          part.endsWith('*') &&
          !part.startsWith('**')
        ) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}

/** Light inline **bold**, *italic*, `code`, and [label](url) links for reading copy. */
export function RichText({ text }: { text: string }): JSX.Element {
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let linkIndex = 0;
  for (const match of text.matchAll(linkRe)) {
    const index = match.index ?? 0;
    if (index > last) {
      nodes.push(
        <RichTextInline key={`t-${last}`} text={text.slice(last, index)} />,
      );
    }
    const href = match[2].trim();
    nodes.push(
      <a
        key={`a-${linkIndex++}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="spark-primer-inline-link"
      >
        {match[1]}
      </a>,
    );
    last = index + match[0].length;
  }
  if (last < text.length) {
    nodes.push(<RichTextInline key={`t-${last}`} text={text.slice(last)} />);
  }
  if (nodes.length === 0) {
    return <RichTextInline text={text} />;
  }
  return <>{nodes}</>;
}

function readingCodePath(language: string, filename?: string): string {
  if (filename) return filename;
  const lang = (language || 'plaintext').toLowerCase();
  if (lang === 'yaml' || lang === 'yml') return 'snippet.yaml';
  if (lang === 'shell' || lang === 'bash' || lang === 'sh') return 'snippet.sh';
  if (lang === 'json') return 'snippet.json';
  if (lang === 'csv') return 'snippet.csv';
  if (lang === 'text' || lang === 'plaintext') return 'snippet.txt';
  return `snippet.${lang}`;
}

function readingCodeLanguage(language: string): string {
  const lang = (language || 'plaintext').toLowerCase();
  if (lang === 'yml') return 'yaml';
  if (lang === 'text' || lang === 'plaintext') return 'plaintext';
  if (lang === 'sh' || lang === 'bash') return 'shell';
  return lang;
}

/** Column-align short CSV samples for readable IDE-style panes. */
function formatCsvLight(raw: string): string {
  const lines = raw.replace(/\n+$/g, '').split('\n');
  const rows = lines.map((line) => line.split(',').map((cell) => cell.trim()));
  const colCount = Math.max(0, ...rows.map((row) => row.length));
  const widths = Array.from({ length: colCount }, (_, i) =>
    Math.max(0, ...rows.map((row) => (row[i] ?? '').length)),
  );
  return rows
    .map((row) => row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join(',  '))
    .join('\n');
}

/** Monaco-highlighted fence — same look as lab Solution / MarkdownProse. */
function ReadingCodeBlock({ block }: { block: K8sReadingCodeBlock }): JSX.Element {
  const langKey = (block.language || 'plaintext').toLowerCase();
  const language = readingCodeLanguage(block.language);
  const showToolbar = langKey === 'csv' || Boolean(block.filename);
  const toolbarLabel = block.filename ?? (langKey === 'csv' ? 'csv' : '');
  let content = block.code.replace(/\n+$/g, '');
  if (langKey === 'csv') {
    content = formatCsvLight(content);
  }
  return (
    <div
      className={`spark-primer-code-block markdown-code-block${showToolbar ? '' : ' markdown-code-block--no-toolbar'}`}
    >
      {showToolbar ? (
        <div className="markdown-code-toolbar">
          <span className="markdown-code-lang">{toolbarLabel}</span>
        </div>
      ) : null}
      <ReadOnlyCodePane
        path={readingCodePath(block.language, block.filename)}
        content={content}
        language={language}
        className="markdown-code-pane"
        expand
      />
    </div>
  );
}

function ReadingTable({ table }: { table: K8sReadingTable }): JSX.Element {
  return (
    <div className="spark-primer-table-wrap">
      <table className="spark-primer-table">
        <thead>
          <tr>
            {table.headers.map((h, i) => (
              <th key={i}>
                <RichText text={h || '\u00a0'} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>
                  <RichText text={cell || '\u00a0'} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReadingFlow({ flow }: { flow: K8sReadingFlow }): JSX.Element {
  return (
    <div className="spark-primer-flow">
      <p className="spark-primer-flow-title">{flow.title}</p>
      <ol className="spark-primer-flow-steps">
        {flow.steps.map((step, i) => (
          <li key={`${flow.title}-${i}`} className="spark-primer-flow-step">
            <span className="spark-primer-flow-chip">
              <RichText text={step} />
            </span>
            {i < flow.steps.length - 1 ? (
              <span className="spark-primer-flow-arrow" aria-hidden>
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ReadingSection({
  section,
  readingPrefix,
}: {
  section: K8sReadingSection;
  readingPrefix: string;
}): JSX.Element | null {
  if (
    !section.title &&
    section.body.length === 0 &&
    !section.subsections?.length &&
    !section.code &&
    !section.codes?.length &&
    !section.flows?.length
  ) {
    return null;
  }

  const sectionBase = readingCurationBlockId(readingPrefix, 'section', section.id);

  const figureClass = [
    'spark-primer-figure',
    section.figure?.compact ? 'spark-primer-figure--compact' : '',
    section.figure?.flush ? 'spark-primer-figure--flush' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section id={section.id} className="spark-primer-section">
      {section.title ? (
        <ReadingCurationBlock blockId={`${sectionBase}/title`}>
          <h2 className="spark-primer-section-title">{section.title}</h2>
        </ReadingCurationBlock>
      ) : null}
      {section.body.map((paragraph, bi) => (
        <ReadingCurationBlock key={`${section.id}-body-${bi}`} blockId={`${sectionBase}/body/${bi}`}>
          <p className="spark-primer-copy">
            <RichText text={paragraph} />
          </p>
        </ReadingCurationBlock>
      ))}
      {section.subsections?.map((subsection) => {
        const subBase = `${sectionBase}/subsection/${subsection.id}`;
        const subAnchor = `${section.id}--${subsection.id}`;
        return (
          <div key={subsection.id} id={subAnchor} className="spark-primer-subsection">
            <ReadingCurationBlock blockId={`${subBase}/title`}>
              <h3 className="spark-primer-subsection-title">{subsection.title}</h3>
            </ReadingCurationBlock>
            {subsection.body.map((paragraph, bi) => (
              <ReadingCurationBlock key={`${subAnchor}-body-${bi}`} blockId={`${subBase}/body/${bi}`}>
                <p className="spark-primer-copy">
                  <RichText text={paragraph} />
                </p>
              </ReadingCurationBlock>
            ))}
            {subsection.code ? (
              <ReadingCurationBlock blockId={`${subBase}/code`}>
                <ReadingCodeBlock block={subsection.code} />
              </ReadingCurationBlock>
            ) : null}
          </div>
        );
      })}
      {section.table ? (
        <ReadingCurationBlock blockId={`${sectionBase}/table`}>
          <ReadingTable table={section.table} />
        </ReadingCurationBlock>
      ) : null}
      {section.bullets && section.bullets.length > 0 ? (
        <ul className="spark-primer-example-list spark-primer-bullets">
          {section.bullets.map((item, bi) => (
            <ReadingCurationBlock
              key={`${section.id}-bullet-${bi}`}
              as="li"
              blockId={`${sectionBase}/bullet/${bi}`}
            >
              <RichText text={item} />
            </ReadingCurationBlock>
          ))}
        </ul>
      ) : null}
      {section.quote ? (
        <ReadingCurationBlock blockId={`${sectionBase}/quote`}>
          <blockquote className="spark-primer-quote">
            <RichText text={section.quote} />
          </blockquote>
        </ReadingCurationBlock>
      ) : null}
      {section.flows?.map((flow, fi) => (
        <ReadingCurationBlock key={flow.title} blockId={`${sectionBase}/flow/${fi}`}>
          <ReadingFlow flow={flow} />
        </ReadingCurationBlock>
      ))}
      {section.codes?.map((block, ci) => (
        <ReadingCurationBlock key={block.code.slice(0, 40)} blockId={`${sectionBase}/code/${ci}`}>
          <ReadingCodeBlock block={block} />
        </ReadingCurationBlock>
      ))}
      {section.figure ? (
        <ReadingCurationBlock blockId={`${sectionBase}/figure`}>
          <figure className={figureClass}>
            <img src={section.figure.image} alt={section.figure.imageAlt} loading="lazy" />
            <figcaption>{section.figure.caption}</figcaption>
          </figure>
        </ReadingCurationBlock>
      ) : null}
      {section.after?.map((paragraph, ai) => (
        <ReadingCurationBlock key={`${section.id}-after-${ai}`} blockId={`${sectionBase}/after/${ai}`}>
          <p className="spark-primer-copy">
            <RichText text={paragraph} />
          </p>
        </ReadingCurationBlock>
      ))}
      {section.code ? (
        <ReadingCurationBlock blockId={`${sectionBase}/code-single`}>
          <ReadingCodeBlock block={section.code} />
        </ReadingCurationBlock>
      ) : null}
      {section.tableAfter ? (
        <ReadingCurationBlock blockId={`${sectionBase}/table-after`}>
          <ReadingTable table={section.tableAfter} />
        </ReadingCurationBlock>
      ) : null}
      {section.callout ? (
        <ReadingCurationBlock blockId={`${sectionBase}/callout`}>
          <aside
            className={`markdown-callout markdown-callout--${section.callout.kind} spark-primer-callout`}
            aria-label={section.callout.title}
          >
            <p className="markdown-callout-label">{section.callout.title}</p>
            {section.callout.body.map((paragraph) => (
              <p key={paragraph.slice(0, 56)}>
                <RichText text={paragraph} />
              </p>
            ))}
          </aside>
        </ReadingCurationBlock>
      ) : null}
    </section>
  );
}

export default function K8sReadingPage({
  trackId = 'kubernetes',
}: {
  trackId?: ReadingTrackId;
}): JSX.Element {
  const { readingSlug } = useParams<{ readingSlug: string }>();
  const { currentUser } = useAppState();
  const isAdmin =
    isAdminUser(currentUser) || isAdminUser(getCurrentUser());
  const track = READING_TRACKS[trackId];
  const reading = useMemo(() => track.getReading(readingSlug), [track, readingSlug]);

  if (!reading || !readingSlug) {
    return <Navigate to={track.labsPath} replace />;
  }

  const readingPrefix = `${trackId}/${reading.slug}`;
  const tocSections = reading.sections.filter((s) => s.title);

  const article = (
    <article
      className={`spark-primer-notebook${reading.showBlogStamp ? ' spark-primer-notebook--stamped' : ''}${isAdmin ? ' spark-primer-notebook--curation' : ''}`}
    >
      {reading.showBlogStamp ? (
        <img
          className="spark-primer-blog-stamp"
          src={K8S_BLOG_STAMP_SRC}
          alt="The DevSetu Blog"
          width={88}
          height={88}
          decoding="async"
        />
      ) : null}
      <header className="spark-primer-header">
        <p className="spark-primer-crumb">
          <Link to="/track">Tracks</Link>
          <span aria-hidden> / </span>
          <Link to="/track/devops-engineer">DevOps Engineer</Link>
          <span aria-hidden> / </span>
          <Link to={track.labsPath}>{track.label}</Link>
          <span aria-hidden> / </span>
          {reading.trackId}
        </p>
        {reading.eyebrow ? (
          <p className="spark-primer-eyebrow">{reading.eyebrow}</p>
        ) : null}
        <h1 className="spark-primer-title">{reading.title}</h1>
        <ReadingCurationBlock blockId={readingCurationBlockId(readingPrefix, 'lede')}>
          <p className="spark-primer-lede">
            <RichText text={reading.lede} />
          </p>
        </ReadingCurationBlock>
      </header>

      <ReadingCurationToolbar />

      <nav className="spark-primer-toc" aria-label="On this page">
        {tocSections.map((section) => (
          <a key={section.id} href={`#${section.id}`}>
            {section.title}
          </a>
        ))}
        <a href="#takeaways">Takeaways</a>
        <a href="#related">Related labs</a>
      </nav>

      {reading.sections.map((section) => (
        <ReadingSection key={section.id} section={section} readingPrefix={readingPrefix} />
      ))}

      <section id="takeaways" className="spark-primer-section">
        <p className="spark-primer-section-eyebrow">Takeaways</p>
        <h2 className="spark-primer-section-title">What to keep</h2>
        <ul className="spark-primer-example-list spark-primer-bullets">
          {reading.takeaways.map((item, ti) => (
            <ReadingCurationBlock
              key={item}
              as="li"
              blockId={readingCurationBlockId(readingPrefix, 'takeaways', String(ti))}
            >
              <RichText text={item} />
            </ReadingCurationBlock>
          ))}
        </ul>
      </section>

      <section id="related" className="spark-primer-section spark-primer-next">
        <p className="spark-primer-section-eyebrow">On the track</p>
        <h2 className="spark-primer-section-title">Related labs</h2>
        {(() => {
          const relatedIntro =
            reading.relatedLabsIntro !== undefined
              ? reading.relatedLabsIntro
              : track.relatedLabsIntro;
          return relatedIntro.trim() ? (
            <ReadingCurationBlock blockId={readingCurationBlockId(readingPrefix, 'related-intro')}>
              <p className="spark-primer-copy">
                <RichText text={relatedIntro} />
              </p>
            </ReadingCurationBlock>
          ) : null;
        })()}
        <ul className="spark-primer-links">
          {reading.relatedLabs.map((lab) => (
            <li key={lab.challengeId}>
              <Link to={`${track.labsPath}?start=${encodeURIComponent(lab.challengeId)}`}>
                {lab.label}
              </Link>
            </li>
          ))}
          {track.primer ? (
            <li>
              <Link to={track.primer.path}>{track.primer.label}</Link>
            </li>
          ) : null}
        </ul>
      </section>
    </article>
  );

  return (
    <div className="app-page spark-primer-page">
      {isAdmin ? (
        <ReadingCurationProvider trackId={trackId} readingSlug={readingSlug} isAdmin={isAdmin}>
          {article}
        </ReadingCurationProvider>
      ) : (
        article
      )}
    </div>
  );
}
