import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import useMediaQuery from '../hooks/useMediaQuery';
import { useTrackRoadmapGeometry } from '../hooks/useTrackRoadmapGeometry';
import { useNavigate } from 'react-router-dom';
import type { TrackRoadmapNode } from '../lib/trackRoadmapNodes';
import {
  ROADMAP_VIEW_HEIGHT,
  buildRoadmapPathD,
  fallbackRoadmapYUnits,
  layoutRoadmapPinXs,
  milestoneConnectorX,
  milestoneSide,
} from '../lib/trackRoadmapLayout';
import type { ChallengePublic } from '../types/domain';
import {
  RoadmapIcon,
  StatusBookIcon,
  StatusCheckIcon,
  StatusPlayIcon,
} from './TrackStatusIcons';

interface TrackRoadmapModalProps {
  open: boolean;
  trackLabel: string;
  nodes: TrackRoadmapNode[];
  onClose: () => void;
  onSelectLab: (challenge: ChallengePublic) => void | Promise<void>;
}

const ROW_HEIGHT_DESKTOP = 88;
const ROW_HEIGHT_MOBILE_GRAPHIC = 46;
const ROADMAP_MOBILE_QUERY = '(max-width: 480px)';

function nodeLabel(node: TrackRoadmapNode): string {
  return `${node.trackId} · ${node.title}`;
}

export default function TrackRoadmapModal({
  open,
  trackLabel,
  nodes,
  onClose,
  onSelectLab,
}: TrackRoadmapModalProps): JSX.Element | null {
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    document.body.classList.add('landing-modal-open');
    return () => document.body.classList.remove('landing-modal-open');
  }, [open]);

  const mobileRoadmap = useMediaQuery(ROADMAP_MOBILE_QUERY);
  const layoutMode = mobileRoadmap ? 'mobile' : 'desktop';
  const rowHeight = mobileRoadmap ? ROW_HEIGHT_MOBILE_GRAPHIC : ROW_HEIGHT_DESKTOP;

  const canvasRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const milestoneRefs = useRef<(HTMLElement | null)[]>([]);

  const pinXs = useMemo(
    () => layoutRoadmapPinXs(nodes, trackLabel, layoutMode),
    [nodes, trackLabel, layoutMode],
  );

  const geometry = useTrackRoadmapGeometry(
    open,
    nodes.length,
    canvasRef,
    rowRefs,
    milestoneRefs,
  );

  const yUnits = useMemo(() => {
    if (geometry && geometry.length === nodes.length) {
      return geometry.map((g) => g.svgY);
    }
    return fallbackRoadmapYUnits(nodes.length);
  }, [geometry, nodes.length]);

  const pathD = useMemo(() => buildRoadmapPathD(pinXs, yUnits), [pinXs, yUnits]);

  const openNode = (node: TrackRoadmapNode): void => {
    if (node.kind === 'reading') {
      onClose();
      navigate(node.href);
      return;
    }
    if (node.playable) {
      onClose();
      void onSelectLab(node.challenge);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="login-modal-overlay track-roadmap-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="login-modal track-roadmap-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="track-roadmap-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="login-card login-modal-card track-roadmap-card">
          <header className="track-roadmap-header">
            <RoadmapIcon className="track-roadmap-header-icon" title="" />
            <div>
              <h2 id="track-roadmap-title" className="track-roadmap-title">
                {trackLabel} roadmap
              </h2>
              <p className="track-roadmap-sub">Track order — tap an item to open.</p>
            </div>
            <button
              type="button"
              className="ghost track-roadmap-close"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </header>

          {nodes.length === 0 ? (
            <div className="track-roadmap-empty">No track items loaded yet.</div>
          ) : (
            <div className="track-roadmap-scroll" tabIndex={0} aria-label="Track map">
              <div
                ref={canvasRef}
                className={`track-roadmap-canvas${
                  mobileRoadmap ? ' track-roadmap-canvas--mobile' : ''
                }`}
              >
                <svg
                  className="track-roadmap-path-svg"
                  viewBox={`0 0 100 ${ROADMAP_VIEW_HEIGHT}`}
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <path d={pathD} className="track-roadmap-spine-edge" vectorEffect="non-scaling-stroke" />
                  <path d={pathD} className="track-roadmap-spine" vectorEffect="non-scaling-stroke" />
                  <path d={pathD} className="track-roadmap-spine-dash" vectorEffect="non-scaling-stroke" />
                  {nodes.map((node, index) => {
                    const side = milestoneSide(index);
                    const rowGeom = geometry?.[index];
                    const mx =
                      rowGeom?.milestoneSvgX ?? milestoneConnectorX(side, layoutMode);
                    const ax = pinXs[index] ?? 50;
                    const y = yUnits[index] ?? ROADMAP_VIEW_HEIGHT / 2;
                    return (
                      <line
                        key={`conn-${node.key}`}
                        x1={mx}
                        y1={y}
                        x2={ax}
                        y2={y}
                        className="track-roadmap-connector-line"
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </svg>

                <ol className="track-roadmap-map">
                  {nodes.map((node, index) => {
                    const side = milestoneSide(index);
                    const roadX = pinXs[index] ?? 50;
                    const milestoneX = milestoneConnectorX(side, layoutMode);
                    const solved = node.kind === 'lab' && node.solved;
                    const locked = node.kind === 'lab' && !node.playable;
                    const stopClass = [
                      'track-roadmap-stop',
                      `track-roadmap-stop--${side}`,
                      node.kind === 'reading' ? 'track-roadmap-stop--blog' : 'track-roadmap-stop--lab',
                      locked ? 'is-locked' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');

                    const icon =
                      node.kind === 'reading' ? (
                        <StatusBookIcon className="track-roadmap-milestone-icon" title="" />
                      ) : (
                        <StatusPlayIcon className="track-roadmap-milestone-icon" title="" />
                      );

                    const rowGeom = geometry?.[index];

                    return (
                      <li
                        key={node.key}
                        ref={(el) => {
                          rowRefs.current[index] = el;
                        }}
                        className={stopClass}
                        style={
                          {
                            minHeight: rowHeight,
                            '--road-x': roadX,
                            '--milestone-x': milestoneX,
                            '--anchor-y': rowGeom
                              ? `${rowGeom.anchorTopPct}%`
                              : undefined,
                          } as React.CSSProperties
                        }
                      >
                        <div className="track-roadmap-row">
                          <span className="track-roadmap-anchor" aria-hidden />

                          <button
                            type="button"
                            className="track-roadmap-bundle"
                            aria-label={nodeLabel(node)}
                            disabled={locked}
                            onClick={() => openNode(node)}
                          >
                            <span className="track-roadmap-copy">
                              <span className="track-roadmap-stop-id">{node.trackId}</span>
                              <span className="track-roadmap-stop-title">{node.title}</span>
                              {solved ? (
                                <StatusCheckIcon
                                  className="track-roadmap-stop-tick"
                                  title="Solved"
                                />
                              ) : null}
                            </span>
                            <span
                              ref={(el) => {
                                milestoneRefs.current[index] = el;
                              }}
                              className={`track-roadmap-milestone${
                                node.kind === 'reading'
                                  ? ' track-roadmap-milestone--blog'
                                  : ' track-roadmap-milestone--lab'
                              }${solved ? ' track-roadmap-milestone--solved' : ''}`}
                            >
                              {icon}
                              <span className="track-roadmap-milestone-num">{node.trackId}</span>
                              {solved ? (
                                <StatusCheckIcon
                                  className="track-roadmap-milestone-solved"
                                  title="Solved"
                                />
                              ) : null}
                            </span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          )}

          <p className="track-roadmap-legend">
            <span>
              <StatusBookIcon className="track-roadmap-legend-icon" title="" /> Blog
            </span>
            <span>
              <StatusPlayIcon className="track-roadmap-legend-icon" title="" /> Lab
            </span>
            <span>
              <StatusCheckIcon className="track-roadmap-legend-icon" title="" /> Solved
            </span>
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
