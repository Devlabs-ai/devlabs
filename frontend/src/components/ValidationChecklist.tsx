import React from 'react';
import type { ChallengeDraft } from '../types/domain';

type CheckStatus = 'pass' | 'fail' | 'skip' | 'pending';

function statusIcon(status: CheckStatus | string): string {
  if (status === 'pass') return '✓';
  if (status === 'fail') return '✗';
  if (status === 'skip') return '–';
  return '○';
}

interface DesignValidationChecklistProps {
  draft: ChallengeDraft | null | undefined;
}

/** Phase 1 / schema preview — what build validation must prove (not run yet). */
export function DesignValidationChecklist({ draft }: DesignValidationChecklistProps): JSX.Element | null {
  const symptoms = draft?.brokenState?.validationSymptoms || [];
  const services = (draft?.infra?.services || [])
    .map((s) => (typeof s === 'string' ? s : s.name))
    .filter(Boolean);
  const metricsOn = draft?.metrics?.enabled;
  const guidance = draft?.metrics?.display?.guidance;

  if (!symptoms.length && !services.length) return null;

  return (
    <div className="iteration-checklist design-checklist">
      <div className="iteration-checklist-head">
        <span className="badge">Design validation checklist</span>
        <span className="feedback dim">Statuses update when you run the build pipeline</span>
      </div>
      {services.length > 0 && (
        <div className="checklist-section">
          <div className="checklist-section-title">Required services</div>
          <ul className="checklist">
            {services.map((name) => (
              <li key={name} className="check-pending">
                <span className="check-icon">{statusIcon('pending')}</span>
                <span className="check-label">{name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {symptoms.length > 0 && (
        <div className="checklist-section">
          <div className="checklist-section-title">Symptoms (broken vs fixed)</div>
          <ul className="checklist">
            {symptoms.map((s) => (
              <li key={s.order ?? s.check} className="check-pending">
                <span className="check-icon">{statusIcon('pending')}</span>
                <span className="check-label">{s.check}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {metricsOn && (
        <div className="checklist-section">
          <div className="checklist-section-title">Metrics intent</div>
          <ul className="checklist">
            <li className="check-pending">
              <span className="check-icon">{statusIcon('pending')}</span>
              <span className="check-label">
                Load-generator emits {draft?.metrics?.format || 'METRIC …'} on interval
              </span>
            </li>
            {guidance && (
              <li className="check-pending">
                <span className="check-icon">{statusIcon('pending')}</span>
                <span className="check-label">{guidance}</span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export function statusIconForChecklist(status: CheckStatus | string): string {
  return statusIcon(status);
}
