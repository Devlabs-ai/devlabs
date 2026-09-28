import React from 'react';
import { Link } from 'react-router-dom';
import {
  K8S_LABS_PATH,
  K8S_PRIMER_NEXT_LINKS,
  K8S_PRIMER_SECTIONS,
} from '../constants/k8sPrimer';

export default function K8sPrimerPage(): JSX.Element {
  return (
    <div className="app-page spark-primer-page">
      <article className="spark-primer-notebook">
        <header className="spark-primer-header">
          <p className="spark-primer-crumb">
            <Link to="/play">Tracks</Link>
            <span aria-hidden> / </span>
            <Link to="/play/devops-engineer">DevOps Engineer</Link>
            <span aria-hidden> / </span>
            <Link to={K8S_LABS_PATH}>Kubernetes</Link>
            <span aria-hidden> / </span>
            Start here
          </p>
          <p className="spark-primer-eyebrow">Orientation</p>
          <h1 className="spark-primer-title">Why Kubernetes exists</h1>
          <p className="spark-primer-lede">
            A short brief on where Kubernetes came from, the problem it solves at scale, and how
            real companies used it to grow — before you touch YAML in the labs.
          </p>
        </header>

        <nav className="spark-primer-toc" aria-label="On this page">
          {K8S_PRIMER_SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.eyebrow}
            </a>
          ))}
        </nav>

        {K8S_PRIMER_SECTIONS.map((section) => (
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
          </section>
        ))}

        <section id="next" className="spark-primer-section spark-primer-next">
          <p className="spark-primer-section-eyebrow">Next</p>
          <h2 className="spark-primer-section-title">Open a lab</h2>
          <p className="spark-primer-copy">
            When you are ready to practice desired state in a real namespace, open the labs. For
            reference outside DevSetu, stick to the official docs and the CKAD curriculum.
          </p>
          <ul className="spark-primer-links">
            {K8S_PRIMER_NEXT_LINKS.map((link) => (
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
            <Link to={K8S_LABS_PATH} className="spark-primer-cta">
              Open Kubernetes labs
              <span aria-hidden> →</span>
            </Link>
          </div>
        </section>
      </article>
    </div>
  );
}
