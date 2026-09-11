import React from 'react';
import { Link } from 'react-router-dom';
import {
  SPARK_LABS_PATH,
  SPARK_PRIMER_NEXT_LINKS,
  SPARK_PRIMER_SECTIONS,
} from '../constants/sparkPrimer';

export default function SparkPrimerPage(): JSX.Element {
  return (
    <div className="app-page spark-primer-page">
      <article className="spark-primer-notebook">
        <header className="spark-primer-header">
          <p className="spark-primer-crumb">
            <Link to="/play">Tracks</Link>
            <span aria-hidden> / </span>
            <Link to="/play/data-engineer">Data Engineer</Link>
            <span aria-hidden> / </span>
            <Link to={SPARK_LABS_PATH}>Spark</Link>
            <span aria-hidden> / </span>
            Start here
          </p>
          <p className="spark-primer-eyebrow">Orientation · before Lab 1</p>
          <h1 className="spark-primer-title">From one machine to a cluster</h1>
          <p className="spark-primer-lede">
            A short walk from a nightly sales job on a lonely server to the same job shared across
            workers — enough intuition to start Lab 1 without drowning in APIs.
          </p>
        </header>

        <nav className="spark-primer-toc" aria-label="On this page">
          {SPARK_PRIMER_SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.eyebrow}
            </a>
          ))}
        </nav>

        {SPARK_PRIMER_SECTIONS.map((section) => (
          <section key={section.id} id={section.id} className="spark-primer-section">
            <p className="spark-primer-section-eyebrow">{section.eyebrow}</p>
            <h2 className="spark-primer-section-title">{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph.slice(0, 56)} className="spark-primer-copy">
                {paragraph}
              </p>
            ))}
            {section.example && (
              <aside className="spark-primer-example" aria-label={section.example.title}>
                <p className="spark-primer-example-title">{section.example.title}</p>
                {section.example.paragraphs.map((paragraph) => (
                  <p key={paragraph.slice(0, 56)} className="spark-primer-copy">
                    {paragraph}
                  </p>
                ))}
                {section.example.bullets && section.example.bullets.length > 0 && (
                  <ul className="spark-primer-example-list">
                    {section.example.bullets.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </aside>
            )}
            <figure className="spark-primer-figure">
              <img src={section.image} alt={section.imageAlt} loading="lazy" />
              <figcaption>{section.caption}</figcaption>
            </figure>
          </section>
        ))}

        <section id="next" className="spark-primer-section spark-primer-next">
          <p className="spark-primer-section-eyebrow">Next</p>
          <h2 className="spark-primer-section-title">Open a lab</h2>
          <p className="spark-primer-copy">
            You do not need every Spark API first. You need the story above — one machine hits a
            wall; many workers share the slices — then practice. Optional papers if you want more
            theory after a few runs.
          </p>
          <ul className="spark-primer-links">
            {SPARK_PRIMER_NEXT_LINKS.map((link) => (
              <li key={link.href}>
                {link.external ? (
                  <a href={link.href} target="_blank" rel="noreferrer">
                    {link.label}
                    <span aria-hidden> ↗</span>
                  </a>
                ) : (
                  <Link to={link.href}>{link.label}</Link>
                )}
              </li>
            ))}
          </ul>
          <div className="spark-primer-cta-row">
            <Link to={SPARK_LABS_PATH} className="spark-primer-cta">
              Open Spark labs
              <span aria-hidden> →</span>
            </Link>
            <Link to="/play/papers/spark" className="spark-primer-cta spark-primer-cta--ghost">
              Spark white papers
            </Link>
          </div>
        </section>
      </article>
    </div>
  );
}
