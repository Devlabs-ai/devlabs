import React from 'react';

export type WorkspaceMobilePane = 'brief' | 'workspace';

interface WorkspaceMobileSwitcherProps {
  pane: WorkspaceMobilePane;
  onChange: (pane: WorkspaceMobilePane) => void;
  briefLabel?: string;
  workspaceLabel?: string;
}

/** Brief ↔ workspace toggle for narrow viewports (labs / modules). */
export default function WorkspaceMobileSwitcher({
  pane,
  onChange,
  briefLabel = 'Brief',
  workspaceLabel = 'Workspace',
}: WorkspaceMobileSwitcherProps): JSX.Element {
  return (
    <div className="workspace-mobile-switcher" role="tablist" aria-label="Panel">
      <button
        type="button"
        role="tab"
        aria-selected={pane === 'brief'}
        className={`workspace-mobile-switcher-tab${pane === 'brief' ? ' active' : ''}`}
        onClick={() => onChange('brief')}
      >
        {briefLabel}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={pane === 'workspace'}
        className={`workspace-mobile-switcher-tab${pane === 'workspace' ? ' active' : ''}`}
        onClick={() => onChange('workspace')}
      >
        {workspaceLabel}
      </button>
    </div>
  );
}
