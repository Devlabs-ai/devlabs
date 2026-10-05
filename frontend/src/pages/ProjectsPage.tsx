import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { PROJECTS, MAJORS_PATH, getProject, type ProjectEntry, type ProjectModule } from '../constants/projects';
import { hasModuleContent } from '../fixtures/projectModules';
import NotifyButton from '../components/NotifyButton';

function MilestoneRow({
  projectId,
  projectReady,
  module,
  index,
}: {
  projectId: string;
  projectReady: boolean;
  module: ProjectModule;
  index: number;
}): JSX.Element {
  const open = projectReady && module.status === 'ready' && hasModuleContent(projectId, module.id);
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
  return (
    <div className="app-page play-problems-page project-detail--list">
      <header className="project-detail-compact">
        <p className="play-papers-crumb">
          <Link to={MAJORS_PATH}>Majors</Link>
          <span aria-hidden> / </span>
          <span>{project.name}</span>
        </p>
        <h1 className="project-detail-compact-title">
          {project.name}
          {project.status !== 'ready' && (
            <span className="playground-tile-soon project-soon-badge">Coming soon</span>
          )}
          {project.status !== 'ready' && (
            <NotifyButton kind="major" itemId={project.id} label={project.name} />
          )}
        </h1>
        <p className="project-detail-subtitle">{project.subtitle}</p>
      </header>

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
              projectReady={project.status === 'ready'}
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
    if (!project || (project.status !== 'ready' && !project.previewable)) {
      return <Navigate to={MAJORS_PATH} replace />;
    }
    return <ProjectDetail project={project} />;
  }

  return (
    <div className="app-page play-problems-page">
      <header className="play-problems-hero">
        <div className="play-problems-hero-copy">
          <h1 className="play-problems-title">Majors</h1>
          <p className="play-problems-lead">
            Long-form builds instead of single labs. Each one starts from an empty repo and ends
            with a system you can run, break, and explain.
          </p>
        </div>
      </header>

      <section className="playgrounds-grid">
        {PROJECTS.map((project) => {
          if (project.status !== 'ready' && project.previewable) {
            return (
              <Link
                key={project.id}
                to={`${MAJORS_PATH}/${project.id}`}
                className="playground-tile playground-tile--soon playground-tile--preview"
              >
                <strong className="playground-tile-title">
                  {project.name}
                  <span className="playground-tile-soon">Coming soon</span>
                  <NotifyButton kind="major" itemId={project.id} label={project.name} />
                </strong>
                <p className="project-tile-subtitle">{project.subtitle}</p>
                <p className="playground-tile-blurb">{project.blurb}</p>
                <ul className="playground-tile-facts">
                  {project.facts.map((fact) => (
                    <li key={fact} className="playground-tile-fact">
                      {fact}
                    </li>
                  ))}
                </ul>
                <span className="playground-tile-cta">
                  View chapters
                  <span aria-hidden>→</span>
                </span>
              </Link>
            );
          }
          if (project.status !== 'ready') {
            return (
              <div key={project.id} className="playground-tile playground-tile--soon">
                <strong className="playground-tile-title">
                  {project.name}
                  <span className="playground-tile-soon">Coming soon</span>
                  <NotifyButton kind="major" itemId={project.id} label={project.name} />
                </strong>
                <p className="project-tile-subtitle">{project.subtitle}</p>
                <p className="playground-tile-blurb">{project.blurb}</p>
                <ul className="playground-tile-facts">
                  {project.facts.map((fact) => (
                    <li key={fact} className="playground-tile-fact">
                      {fact}
                    </li>
                  ))}
                </ul>
              </div>
            );
          }
          return (
            <Link key={project.id} to={`${MAJORS_PATH}/${project.id}`} className="playground-tile">
              <strong className="playground-tile-title">
                {project.name}
                {project.level && <span className="project-tile-level">{project.level}</span>}
              </strong>
              <p className="project-tile-subtitle">{project.subtitle}</p>
              <p className="playground-tile-blurb">{project.blurb}</p>
              <ul className="playground-tile-facts">
                {project.language && <li className="playground-tile-fact">{project.language}</li>}
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
