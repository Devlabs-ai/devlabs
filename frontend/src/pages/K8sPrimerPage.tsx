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
          <p className="spark-primer-eyebrow">Orientation · before Lab 1</p>
          <h1 className="spark-primer-title">From one container to a cluster</h1>
          <p className="spark-primer-lede">
            A short walk from `docker run` on a lonely server to the same app kept alive across
            nodes — enough intuition to start Lab 1 without drowning in every Kubernetes API.
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
            You do not need every Kubernetes resource first. Read Containers, Runtimes, and
            Pods for the core entities, then practice on the track. Official docs if you want
            more depth after a few labs.
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
            <a
              href="https://kubernetes.io/docs/concepts/"
              className="spark-primer-cta spark-primer-cta--ghost"
              target="_blank"
              rel="noreferrer"
            >
              Kubernetes concepts
            </a>
          </div>
        </section>
      </article>
    </div>
  );
}
