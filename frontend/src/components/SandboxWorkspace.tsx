import React, { useState } from 'react';
import ProblemStatement from './ProblemStatement';
import TerminalWorkspace from './TerminalWorkspace';
import CodeEditor from './CodeEditor';
import BrowserTab from './BrowserTab';
import WorkspaceMobileSwitcher, { type WorkspaceMobilePane } from './WorkspaceMobileSwitcher';
import { useIsNarrowUi } from '../hooks/useMediaQuery';
import type { ChallengePublic, ChallengeFull, ActiveSession } from '../types/domain';

export interface SandboxWorkspaceProps {
  challenge: ChallengePublic | ChallengeFull | null | undefined;
  session: ActiveSession | null;
  onClose?: () => void;
  closing?: boolean;
}

/** Play compose sandbox: brief, terminal, editor, browser. */
export default function SandboxWorkspace({
  challenge,
  session,
  onClose,
  closing,
}: SandboxWorkspaceProps): JSX.Element | null {
  const [rightTab, setRightTab] = useState<string>('terminal');
  const isNarrow = useIsNarrowUi();
  const [mobilePane, setMobilePane] = useState<WorkspaceMobilePane>('brief');
  const showBrief = !isNarrow || mobilePane === 'brief';
  const showWorkspace = !isNarrow || mobilePane === 'workspace';

  if (!session) return null;

  return (
    <div
      className={`workspace workspace-2col sandbox-workspace${
        isNarrow ? ` workspace--mobile workspace--mobile-pane-${mobilePane}` : ''
      }`}
    >
      {isNarrow && (
        <WorkspaceMobileSwitcher
          pane={mobilePane}
          onChange={setMobilePane}
          briefLabel="Brief"
          workspaceLabel="Lab"
        />
      )}
      {showBrief && (
        <div className="col spark-brief-col">
          <div className="panel sandbox-brief-panel--solo" style={{ flex: 1 }}>
            <div className="panel-header">
              <div className="title">
                <span className="icon">◆</span> Inc Brief
              </div>
              <span className="meta">
                {challenge?.difficulty && <span>{challenge.difficulty}</span>}
              </span>
            </div>
            <div className="panel-body">
              <ProblemStatement challenge={challenge} />
            </div>
          </div>
        </div>
      )}

      {showWorkspace && (
        <div className="col col-main">
          <div className="panel" style={{ flex: 1 }}>
            <div className="panel-header">
              <div className="panel-tabs">
                <button
                  type="button"
                  className={`panel-tab ${rightTab === 'terminal' ? 'active' : ''}`}
                  onClick={() => setRightTab('terminal')}
                >
                  <span className="term-dots"><span /><span /><span /></span>
                  Terminal
                </button>
                <button
                  type="button"
                  className={`panel-tab ${rightTab === 'editor' ? 'active' : ''}`}
                  onClick={() => setRightTab('editor')}
                >
                  <span className="icon">&#9632;</span> Editor
                </button>
                <button
                  type="button"
                  className={`panel-tab ${rightTab === 'browser' ? 'active' : ''}`}
                  onClick={() => setRightTab('browser')}
                >
                  <span className="icon">⬡</span> Browser
                </button>
              </div>
              <span className="meta">
                {(session.services || []).length}{' '}
                {(session.services || []).length === 1 ? 'container' : 'containers'}
                {' · '}
                <span title={session.id} style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {session.id.slice(0, 8)}
                </span>
                {onClose && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className="ghost sm"
                      onClick={onClose}
                      disabled={closing}
                    >
                      {closing ? 'Ending…' : 'End session'}
                    </button>
                  </>
                )}
              </span>
            </div>
            <div className="panel-body flush">
              <div style={{ display: rightTab === 'terminal' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <TerminalWorkspace
                  services={session.services}
                  baseWsUrl={session.terminalWsUrl ?? ''}
                  defaultService={session.terminalService}
                />
              </div>
              <div style={{ display: rightTab === 'editor' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <CodeEditor
                  sessionId={session.id}
                  services={session.services}
                  defaultContainer={session.terminalService ?? undefined}
                />
              </div>
              <div style={{ display: rightTab === 'browser' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <BrowserTab sessionId={session.id} portMap={session.portMap} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
