import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  WHITE_PAPER_SECTIONS,
  getWhitePaperSection,
  type WhitePaper,
} from '../constants/whitePapers';

function PaperTile({ paper }: { paper: WhitePaper }): JSX.Element {
  const body = (
    <>
      <span className="play-paper-tile-meta">
        {paper.venue} · {paper.year}
      </span>
      <strong className="play-paper-tile-title">{paper.shortTitle}</strong>
      <span className="play-paper-tile-full">{paper.title}</span>
      <span className="play-paper-tile-authors">{paper.authors}</span>
      <p className="play-paper-tile-blurb">{paper.blurb}</p>
      <span className="play-paper-tile-cta">
        {paper.href ? 'Open paper' : 'Coming soon'}
        <span aria-hidden>→</span>
      </span>
    </>
  );

  if (paper.href && paper.status === 'available') {
    return (
      <a
        className="play-paper-tile"
        href={paper.href}
        target="_blank"
        rel="noreferrer"
      >
        {body}
      </a>
    );
  }

  return (
    <div className="play-paper-tile play-paper-tile--soon" aria-disabled>
      {body}
    </div>
  );
}

export default function WhitePapersPage(): JSX.Element {
  const { sectionId } = useParams<{ sectionId?: string }>();
  const section = getWhitePaperSection(sectionId);

  if (sectionId && !section) {
    return <Navigate to="/play/papers" replace />;
  }

  if (section) {
    return (
      <div className="app-page play-problems-page play-papers-page">
        <header className="play-problems-hero">
          <div className="play-problems-hero-copy">
            <p className="play-problems-kicker">
              <Link to="/play/papers" className="play-papers-crumb">
                White papers
              </Link>
              <span aria-hidden> / </span>
              {section.label}
            </p>
            <h1 className="play-problems-title">{section.label}</h1>
            <p className="play-problems-lead">{section.blurb}</p>
          </div>
        </header>

        <div className="play-paper-tile-grid" aria-label={`${section.label} papers`}>
          {section.papers.map((paper) => (
            <PaperTile key={paper.id} paper={paper} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="app-page play-problems-page play-papers-page">
      <header className="play-problems-hero">
        <div className="play-problems-hero-copy">
          <p className="play-problems-kicker">
            <Link to="/play" className="play-papers-crumb">
              Play
            </Link>
            <span aria-hidden> / </span>
            Explore
          </p>
          <h1 className="play-problems-title">White papers</h1>
          <p className="play-problems-lead">
            Landmark data-systems papers across storage, compute, and query engines — browse by shelf.
          </p>
        </div>
      </header>

      <div className="play-paper-section-grid" aria-label="Paper sections">
        {WHITE_PAPER_SECTIONS.map((s) => (
          <Link key={s.id} to={`/play/papers/${s.id}`} className="play-paper-section-card">
            <span className="play-paper-section-kicker">{s.papers.length} papers</span>
            <strong className="play-paper-section-title">{s.label}</strong>
            <p className="play-paper-section-blurb">{s.blurb}</p>
            <span className="play-paper-section-cta">
              Browse
              <span aria-hidden>→</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
