import React, { useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { K8S_LABS_PATH, K8S_PRIMER_PATH } from '../constants/k8sPrimer';
import {
  getK8sReading,
  K8S_BLOG_STAMP_SRC,
  type K8sReadingCodeBlock,
  type K8sReadingSection,
  type K8sReadingTable,
} from '../constants/k8sReadings';
import ReadOnlyCodePane from '../components/ReadOnlyCodePane';

/** Light inline **bold** and `code` for reading copy. */
function RichText({ text }: { text: string }): JSX.Element {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}

function readingCodePath(language: string): string {
  const lang = (language || 'plaintext').toLowerCase();
  if (lang === 'yaml' || lang === 'yml') return 'snippet.yaml';
  if (lang === 'shell' || lang === 'bash' || lang === 'sh') return 'snippet.sh';
  if (lang === 'json') return 'snippet.json';
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

/** Monaco-highlighted fence — same look as lab Solution / MarkdownProse. */
function ReadingCodeBlock({ block }: { block: K8sReadingCodeBlock }): JSX.Element {
  const language = readingCodeLanguage(block.language);
  return (
    <div className="spark-primer-code-block markdown-code-block markdown-code-block--no-toolbar">
      <ReadOnlyCodePane
        path={readingCodePath(block.language)}
        content={block.code.replace(/\n+$/g, '')}
        language={language}
        className="markdown-code-pane"
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

function ReadingSection({ section }: { section: K8sReadingSection }): JSX.Element | null {
  if (!section.title && section.body.length === 0 && !section.code && !section.codes?.length) {
    return null;
  }

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
        <h2 className="spark-primer-section-title">{section.title}</h2>
      ) : null}
      {section.body.map((paragraph) => (
        <p key={paragraph.slice(0, 72)} className="spark-primer-copy">
          <RichText text={paragraph} />
        </p>
      ))}
      {section.table ? <ReadingTable table={section.table} /> : null}
      {section.bullets && section.bullets.length > 0 ? (
        <ul className="spark-primer-example-list spark-primer-bullets">
          {section.bullets.map((item) => (
            <li key={item}>
              <RichText text={item} />
            </li>
          ))}
        </ul>
      ) : null}
      {section.quote ? (
        <blockquote className="spark-primer-quote">
          <RichText text={section.quote} />
        </blockquote>
      ) : null}
      {section.codes?.map((block) => (
        <ReadingCodeBlock key={block.code.slice(0, 40)} block={block} />
      ))}
      {section.figure ? (
        <figure className={figureClass}>
          <img src={section.figure.image} alt={section.figure.imageAlt} loading="lazy" />
          <figcaption>{section.figure.caption}</figcaption>
        </figure>
      ) : null}
      {section.after?.map((paragraph) => (
        <p key={paragraph.slice(0, 72)} className="spark-primer-copy">
          <RichText text={paragraph} />
        </p>
      ))}
      {section.code ? <ReadingCodeBlock block={section.code} /> : null}
      {section.tableAfter ? <ReadingTable table={section.tableAfter} /> : null}
      {section.callout ? (
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
      ) : null}
    </section>
  );
}

export default function K8sReadingPage(): JSX.Element {
  const { readingSlug } = useParams<{ readingSlug: string }>();
  const reading = useMemo(() => getK8sReading(readingSlug), [readingSlug]);

  if (!reading) {
    return <Navigate to={K8S_LABS_PATH} replace />;
  }

  const tocSections = reading.sections.filter((s) => s.title);

  return (
    <div className="app-page spark-primer-page">
      <article
        className={`spark-primer-notebook${reading.showBlogStamp ? ' spark-primer-notebook--stamped' : ''}`}
      >
        {reading.showBlogStamp ? (
          <img
            className="spark-primer-blog-stamp"
            src={K8S_BLOG_STAMP_SRC}
            alt="The Devlabs Blog"
            width={88}
            height={88}
            decoding="async"
          />
        ) : null}
        <header className="spark-primer-header">
          <p className="spark-primer-crumb">
            <Link to="/play">Tracks</Link>
            <span aria-hidden> / </span>
            <Link to="/play/devops-engineer">DevOps Engineer</Link>
            <span aria-hidden> / </span>
            <Link to={K8S_LABS_PATH}>Kubernetes</Link>
            <span aria-hidden> / </span>
            {reading.trackId}
          </p>
          {reading.eyebrow ? (
            <p className="spark-primer-eyebrow">{reading.eyebrow}</p>
          ) : null}
          <h1 className="spark-primer-title">{reading.title}</h1>
          <p className="spark-primer-lede">{reading.lede}</p>
        </header>

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
          <ReadingSection key={section.id} section={section} />
        ))}

        <section id="takeaways" className="spark-primer-section">
          <p className="spark-primer-section-eyebrow">Takeaways</p>
          <h2 className="spark-primer-section-title">What to keep</h2>
          <ul className="spark-primer-example-list spark-primer-bullets">
            {reading.takeaways.map((item) => (
              <li key={item}>
                <RichText text={item} />
              </li>
            ))}
          </ul>
        </section>

        <section id="related" className="spark-primer-section spark-primer-next">
          <p className="spark-primer-section-eyebrow">On the track</p>
          <h2 className="spark-primer-section-title">Related labs</h2>
          <p className="spark-primer-copy">
            These ideas show up when you create a Pod on the cluster. If you are working through
            the Kubernetes track from the start, the lab below is a natural place to practice.
          </p>
          <ul className="spark-primer-links">
            {reading.relatedLabs.map((lab) => (
              <li key={lab.challengeId}>
                <Link to={`${K8S_LABS_PATH}?start=${encodeURIComponent(lab.challengeId)}`}>
                  {lab.label}
                </Link>
              </li>
            ))}
            <li>
              <Link to={K8S_PRIMER_PATH}>Kubernetes primer</Link>
            </li>
          </ul>
        </section>
      </article>
    </div>
  );
}
