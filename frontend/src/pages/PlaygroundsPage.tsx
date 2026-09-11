import React from 'react';
import { Link } from 'react-router-dom';
import { PLAYGROUNDS } from '../constants/playgrounds';

export default function PlaygroundsPage(): JSX.Element {
  return (
    <div className="app-page play-problems-page">
      <header className="play-problems-hero">
        <div className="play-problems-hero-copy">
          <p className="play-papers-crumb">
            <Link to="/play">Play</Link>
            <span aria-hidden> / </span>
            <span>Playgrounds</span>
          </p>
          <h1 className="play-problems-title">Playgrounds</h1>
          <p className="play-problems-lead">
            Open benches, one per engine — no grader and no fixed task. Shape an idea against real
            data, then promote it into a lab.
          </p>
        </div>
      </header>

      <section className="playgrounds-grid">
        {PLAYGROUNDS.map((pg) =>
          pg.to ? (
            <Link key={pg.id} to={pg.to} className="playground-tile">
              <strong className="playground-tile-title">{pg.label}</strong>
              <p className="playground-tile-blurb">{pg.blurb}</p>
              {pg.facts.length > 0 && (
                <ul className="playground-tile-facts">
                  {pg.facts.map((fact) => (
                    <li key={fact} className="playground-tile-fact">
                      {fact}
                    </li>
                  ))}
                </ul>
              )}
              <span className="playground-tile-cta">
                Open {pg.label} playground
                <span aria-hidden>→</span>
              </span>
            </Link>
          ) : (
            <div key={pg.id} className="playground-tile playground-tile--soon">
              <strong className="playground-tile-title">
                {pg.label}
                <span className="playground-tile-soon">Soon</span>
              </strong>
              <p className="playground-tile-blurb">{pg.blurb}</p>
            </div>
          ),
        )}
      </section>
    </div>
  );
}
