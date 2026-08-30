import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ModuleWorkspace } from './ProjectModulePage';
import { MINORS, MINORS_PATH, getMinor } from '../constants/minors';
import { getMinorContent, hasMinorContent } from '../fixtures/projectModules';

function MinorsIndex(): JSX.Element {
  return (
    <div className="app-page play-problems-page">
      <header className="play-problems-hero">
        <div className="play-problems-hero-copy">
          <p className="play-papers-crumb">
            <Link to="/play">Play</Link>
            <span aria-hidden> / </span>
            <Link to={MINORS_PATH}>Minors</Link>
          </p>
          <h1 className="play-problems-title">Minors</h1>
          <p className="play-problems-lead">
            Small independent builds. One sitting, one working program — a
            listener, a protocol, a thing you can run and break on its own.
          </p>
        </div>
      </header>

      <section className="playgrounds-grid">
        {MINORS.map((minor) => {
          const open = minor.status === 'ready' && hasMinorContent(minor.id);
          if (!open) {
            return (
              <div key={minor.id} className="playground-tile playground-tile--soon">
                <strong className="playground-tile-title">
                  {minor.name}
                  <span className="playground-tile-soon">Soon</span>
                </strong>
                <p className="project-tile-subtitle">{minor.subtitle}</p>
                <p className="playground-tile-blurb">{minor.blurb}</p>
              </div>
            );
          }
          return (
            <Link key={minor.id} to={`${MINORS_PATH}/${minor.id}`} className="playground-tile">
              <strong className="playground-tile-title">{minor.name}</strong>
              <p className="project-tile-subtitle">{minor.subtitle}</p>
              <p className="playground-tile-blurb">{minor.blurb}</p>
              <ul className="playground-tile-facts">
                <li className="playground-tile-fact">{minor.language}</li>
                {minor.facts.map((fact) => (
                  <li key={fact} className="playground-tile-fact">
                    {fact}
                  </li>
                ))}
              </ul>
              <span className="playground-tile-cta">
                Open {minor.name}
                <span aria-hidden>→</span>
              </span>
            </Link>
          );
        })}
      </section>
    </div>
  );
}

export default function MinorsPage(): JSX.Element {
  const { minorId } = useParams<{ minorId?: string }>();

  if (!minorId) return <MinorsIndex />;

  const minor = getMinor(minorId);
  if (!minor) return <Navigate to={MINORS_PATH} replace />;

  const content = getMinorContent(minor.id);
  if (!content) return <Navigate to={MINORS_PATH} replace />;

  return (
    <ModuleWorkspace
      persistId={`minor.${minor.id}.v2`}
      content={content}
      trail={[{ to: MINORS_PATH, label: 'Minors' }]}
      title={minor.name}
    />
  );
}
