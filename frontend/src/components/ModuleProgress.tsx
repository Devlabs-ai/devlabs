import React from 'react';
import { Link } from 'react-router-dom';
import { MAJORS_PATH, type ProjectEntry } from '../constants/projects';
import { hasModuleContent } from '../fixtures/projectModules';

interface ModuleProgressProps {
  project: ProjectEntry;
  activeId: string | null;
  onSelect?: (moduleId: string) => void;
  variant?: 'hero' | 'compact';
}

export default function ModuleProgress({
  project,
  activeId,
  onSelect,
  variant = 'compact',
}: ModuleProgressProps): JSX.Element {
  const total = project.modules.length;
  const readyCount = project.modules.filter((m) => m.status === 'ready').length;
  const fill = total <= 1 ? 0 : ((readyCount - 1) / (total - 1)) * 100;
  const activeIndex = Math.max(
    0,
    project.modules.findIndex((m) => m.id === activeId),
  );

  return (
    <nav
      className={`module-progress module-progress--${variant}`}
      aria-label="Module progress"
      style={
        {
          ['--charge' as string]: `${Math.max(0, fill)}%`,
          ['--active-i' as string]: String(activeIndex),
          ['--stops' as string]: String(Math.max(total - 1, 1)),
        } as React.CSSProperties
      }
    >
      <div className="module-progress-track">
        <span className="module-progress-rail" aria-hidden="true">
          <span className="module-progress-rail-ghost" />
          <span className="module-progress-fill">
            <span className="module-progress-fill-sheen" />
            <span className="module-progress-spark" />
          </span>
        </span>
        <ol className="module-progress-stops">
          {project.modules.map((module, index) => {
            const open = module.status === 'ready' && hasModuleContent(project.id, module.id);
            const active = module.id === activeId;
            const ordinal = String(index + 1).padStart(2, '0');
            const className = `module-progress-stop${open ? ' is-open' : ' is-planned'}${
              active ? ' is-active' : ''
            }`;
            const style = { ['--i' as string]: String(index) };
            const inner = (
              <>
                <span className="module-progress-core">
                  {open && <span className="module-progress-halo" />}
                  <span className="module-progress-orbit" />
                  <span className="module-progress-dot">{ordinal}</span>
                </span>
                <span className="module-progress-name">{module.label}</span>
              </>
            );

            if (open) {
              return (
                <li key={module.id} style={style}>
                  <Link
                    to={`${MAJORS_PATH}/${project.id}/${module.id}`}
                    className={className}
                    aria-current={active ? 'step' : undefined}
                    title={module.label}
                    onClick={
                      onSelect
                        ? (event) => {
                            event.preventDefault();
                            onSelect(module.id);
                          }
                        : undefined
                    }
                  >
                    {inner}
                  </Link>
                </li>
              );
            }

            return (
              <li key={module.id} style={style}>
                <button
                  type="button"
                  className={className}
                  title={`${module.label} — planned`}
                  disabled={!onSelect}
                  onClick={onSelect ? () => onSelect(module.id) : undefined}
                >
                  {inner}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
