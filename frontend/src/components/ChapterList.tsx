import React from 'react';
import { Link } from 'react-router-dom';
import type { ProjectModule } from '../constants/projects';

export interface ChapterListProps {
  chapters: ProjectModule[];
  /** Whether a chapter can be opened right now. */
  isOpen: (chapter: ProjectModule) => boolean;
  /** Route of an open chapter. */
  hrefFor: (chapter: ProjectModule) => string;
}

/** Numbered chapter list shared by majors and chaptered minors. */
export default function ChapterList({ chapters, isOpen, hrefFor }: ChapterListProps): JSX.Element {
  const firstNumber = chapters[0]?.kind === 'reading' ? 0 : 1;
  return (
    <section className="project-milestones" aria-label="Chapters">
      <h2 className="project-milestones-heading">Chapters</h2>
      <ol className="project-milestones-list">
        {chapters.map((chapter, index) => {
          const open = isOpen(chapter);
          const openLabel = chapter.kind === 'reading' ? 'Read' : 'Open';
          const body = (
            <>
              <span className="project-milestone-ord">
                {String(index + firstNumber).padStart(2, '0')}
              </span>
              <span className="project-milestone-copy">
                <span className="project-milestone-label">{chapter.label}</span>
                <span className="project-milestone-sub">{chapter.subtitle}</span>
              </span>
              <span className={`project-milestone-state${open ? ' is-open' : ''}`}>
                {open ? openLabel : 'Soon'}
              </span>
            </>
          );
          return (
            <li key={chapter.id}>
              {open ? (
                <Link to={hrefFor(chapter)} className="project-milestone is-open">
                  {body}
                </Link>
              ) : (
                <div className="project-milestone is-planned" aria-disabled="true">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
