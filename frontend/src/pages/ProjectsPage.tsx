import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { PROJECTS, MAJORS_PATH, getProject, type ProjectEntry, type ProjectModule } from '../constants/projects';
import { MINORS_PATH, minorsFor } from '../constants/minors';
import { hasModuleContent } from '../fixtures/projectModules';

function MilestoneRow({
  projectId,
  module,
  index,
}: {
  projectId: string;
  module: ProjectModule;
  index: number;
}): JSX.Element {
  const open = module.status === 'ready' && hasModuleContent(projectId, module.id);
  const ordinal = String(index + 1).padStart(2, '0');

  const body = (
    <>
      <span className="project-milestone-ord">{ordinal}</span>
      <span className="project-milestone-copy">
        <span className="project-milestone-label">{module.label}</span>
        <span className="project-milestone-sub">{module.subtitle}</span>
      </span>
      <span className={`project-milestone-state${open ? ' is-open' : ''}`}>
        {open ? 'Open' : 'Soon'}
      </span>
    </>
  );

  if (open) {
    return (
      <li>
        <Link to={`${MAJORS_PATH}/${projectId}/${module.id}`} className="project-milestone is-open">
          {body}
        </Link>
      </li>
    );
  }

  return (
    <li>
      <div className="project-milestone is-planned" aria-disabled="true">
        {body}
      </div>
    </li>
  );
}

function ProjectDetail({ project }: { project: ProjectEntry }): JSX.Element {
  const relatedMinors = minorsFor(project.minors);

  return (
    <div className="app-page play-problems-page project-detail--list">
      <header className="project-detail-compact">
        <p className="play-papers-crumb">
          <Link to={MAJORS_PATH}>Majors</Link>
          <span aria-hidden> / </span>
          <span>{project.name}</span>
        </p>
        <h1 className="project-detail-compact-title">{project.name}</h1>
        <p className="project-detail-subtitle">{project.subtitle}</p>
      </header>

      {relatedMinors.length > 0 && (
        <ul className="project-minor-refs">
          {relatedMinors.map((minor) => (
            <li key={minor.id}>
              <Link to={`${MINORS_PATH}/${minor.id}`} className="project-minor-chip">
                {minor.name}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="project-about">
        {project.about.map((paragraph) => (
          <p key={paragraph.slice(0, 48)} className="project-about-body">
            {paragraph}
          </p>
        ))}
      </div>

      <section className="project-milestones" aria-label="Chapters">
        <h2 className="project-milestones-heading">Chapters</h2>
        <ol className="project-milestones-list">
          {project.modules.map((module, index) => (
            <MilestoneRow
              key={module.id}
              projectId={project.id}
              module={module}
              index={index}
            />
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function ProjectsPage(): JSX.Element {
  const { projectId } = useParams<{ projectId?: string }>();

  if (projectId) {
    const project = getProject(projectId);
    if (!project || project.status !== 'ready') return <Navigate to={MAJORS_PATH} replace />;
    return <ProjectDetail project={project} />;
  }

  return (
    <div className="app-page play-problems-page">
      <header className="play-problems-hero">
        <div className="play-problems-hero-copy">
          <p className="play-papers-crumb">
            <Link to="/play">Play</Link>
            <span aria-hidden> / </span>
            <Link to={MAJORS_PATH}>Majors</Link>
          </p>
          <h1 className="play-problems-title">Majors</h1>
          <p className="play-problems-lead">
            Long-form builds instead of single labs. Each one starts from an empty repo and ends
            with a system you can run, break, and explain.
          </p>
        </div>
      </header>

      <section className="playgrounds-grid">
        {PROJECTS.map((project) => {
          if (project.status !== 'ready') {
            return (
              <div key={project.id} className="playground-tile playground-tile--soon">
                <strong className="playground-tile-title">
                  {project.name}
                  <span className="playground-tile-soon">Coming soon</span>
                </strong>
                <p className="project-tile-subtitle">{project.subtitle}</p>
                <p className="playground-tile-blurb">{project.blurb}</p>
              </div>
            );
          }
          return (
            <Link key={project.id} to={`${MAJORS_PATH}/${project.id}`} className="playground-tile">
              <strong className="playground-tile-title">
                {project.name}
                <span className="project-tile-level">{project.level}</span>
              </strong>
              <p className="project-tile-subtitle">{project.subtitle}</p>
              <p className="playground-tile-blurb">{project.blurb}</p>
              <ul className="playground-tile-facts">
                <li className="playground-tile-fact">{project.language}</li>
                <li className="playground-tile-fact">
                  {project.modules.filter((m) => m.status === 'ready').length} open
                </li>
                {project.facts.map((fact) => (
                  <li key={fact} className="playground-tile-fact">
                    {fact}
                  </li>
                ))}
              </ul>
              <span className="playground-tile-cta">
                View {project.name}
                <span aria-hidden>→</span>
              </span>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
