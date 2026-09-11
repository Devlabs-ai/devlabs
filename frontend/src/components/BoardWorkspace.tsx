import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconLibrary, IconSubmit } from './ChromeIcons';
import MarkdownProse from './MarkdownProse';
import {
  fetchBoardState,
  saveBoardGraph,
  submitBoard,
} from '../services/sessionApi';
import type {
  ActiveSession,
  BoardGradeResult,
  ChallengeFull,
  ChallengePublic,
  PublicBoardPiece,
  PublicBoardSlot,
} from '../types/domain';

interface BoardWorkspaceProps {
  challenge: ChallengePublic | ChallengeFull | null | undefined;
  session: ActiveSession;
  onClose?: () => void;
}

const EMPTY_PIECES: PublicBoardPiece[] = [];
const SLOT_W = 228;
const SLOT_H = 70;

function boardStory(challenge: ChallengePublic | ChallengeFull | null | undefined): {
  overview: string;
  yourTask: string;
  steps: string[];
  hints: string[];
} {
  const ps = challenge?.problemStatement;
  const rec = ps && typeof ps === 'object' && !Array.isArray(ps)
    ? (ps as {
      overview?: unknown;
      yourTask?: unknown;
      yourTaskSteps?: unknown;
      hints?: unknown;
    })
    : {};
  const steps = Array.isArray(rec.yourTaskSteps)
    ? rec.yourTaskSteps.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];
  const hints = Array.isArray(rec.hints)
    ? rec.hints.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];
  return {
    overview: typeof rec.overview === 'string' ? rec.overview.trim() : '',
    yourTask: typeof rec.yourTask === 'string' ? rec.yourTask.trim() : '',
    steps,
    hints,
  };
}

function slotAnchor(box: PublicBoardSlot, other: PublicBoardSlot): { x: number; y: number } {
  const cx = box.x + SLOT_W / 2;
  const cy = box.y + SLOT_H / 2;
  const ox = other.x + SLOT_W / 2;
  const oy = other.y + SLOT_H / 2;
  const dx = ox - cx;
  const dy = oy - cy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? { x: box.x + SLOT_W, y: cy } : { x: box.x, y: cy };
  }
  return dy > 0 ? { x: cx, y: box.y + SLOT_H } : { x: cx, y: box.y };
}

function edgePath(a: PublicBoardSlot, b: PublicBoardSlot): string {
  const p1 = slotAnchor(a, b);
  const p2 = slotAnchor(b, a);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  if (Math.abs(dx) < 2 || Math.abs(dy) < 2) {
    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  }
  const r = 14;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const midX = p1.x + dx / 2;
    const dirY = dy >= 0 ? 1 : -1;
    const dirX = dx >= 0 ? 1 : -1;
    return [
      `M ${p1.x} ${p1.y}`,
      `L ${midX - dirX * r} ${p1.y}`,
      `Q ${midX} ${p1.y} ${midX} ${p1.y + dirY * r}`,
      `L ${midX} ${p2.y - dirY * r}`,
      `Q ${midX} ${p2.y} ${midX + dirX * r} ${p2.y}`,
      `L ${p2.x} ${p2.y}`,
    ].join(' ');
  }
  const midY = p1.y + dy / 2;
  const dirX = dx >= 0 ? 1 : -1;
  const dirY = dy >= 0 ? 1 : -1;
  return [
    `M ${p1.x} ${p1.y}`,
    `L ${p1.x} ${midY - dirY * r}`,
    `Q ${p1.x} ${midY} ${p1.x + dirX * r} ${midY}`,
    `L ${p2.x - dirX * r} ${midY}`,
    `Q ${p2.x} ${midY} ${p2.x} ${midY + dirY * r}`,
    `L ${p2.x} ${p2.y}`,
  ].join(' ');
}

function hitBoardDrop(clientX: number, clientY: number): { slotId: string | null; palette: boolean } {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    if (!(node instanceof Element) || node.closest('.board-drag-ghost')) continue;
    const slot = node.closest('.board-slot');
    if (slot instanceof HTMLElement && slot.dataset.slotId) {
      return { slotId: slot.dataset.slotId, palette: false };
    }
    if (node.closest('.board-palette') || node.closest('[data-board-return]')) {
      return { slotId: null, palette: true };
    }
  }
  return { slotId: null, palette: false };
}

export default function BoardWorkspace({
  challenge,
  session,
  onClose,
}: BoardWorkspaceProps): JSX.Element {
  const spec = challenge?.boardSpec;
  const pieces = spec?.pieces || EMPTY_PIECES;
  const slots = spec?.shadow?.slots || [];
  const shadowEdges = spec?.shadow?.edges || [];
  const byId = useMemo(() => {
    const map = new Map<string, PublicBoardPiece>();
    for (const p of pieces) map.set(p.id, p);
    return map;
  }, [pieces]);
  const slotById = useMemo(() => {
    const map = new Map<string, PublicBoardSlot>();
    for (const s of slots) map.set(s.id, s);
    return map;
  }, [slots]);
  const stepIndex = useMemo(() => {
    const map = new Map<string, number>();
    slots.filter((s) => !s.optional).forEach((s, i) => map.set(s.id, i + 1));
    return map;
  }, [slots]);
  const spine = useMemo(() => {
    const required = slots.filter((s) => !s.optional);
    if (required.length === 0) return null;
    const first = required[0];
    const last = required[required.length - 1];
    return {
      x: first.x - 18,
      y: first.y - 18,
      w: SLOT_W + 36,
      h: last.y + SLOT_H - first.y + 36,
    };
  }, [slots]);

  const [trayOrder, setTrayOrder] = useState<string[]>(() => pieces.map((p) => p.id));
  const [fills, setFills] = useState<Record<string, string | null>>({});
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [grade, setGrade] = useState<BoardGradeResult | null>(null);
  const [dirtySinceGrade, setDirtySinceGrade] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 48, y: 20 });
  const [zoom, setZoom] = useState(0.82);
  const [dropSlot, setDropSlot] = useState<string | null>(null);
  const [dropPalette, setDropPalette] = useState(false);
  const [storyOpen, setStoryOpen] = useState(true);
  const [pieceDragPos, setPieceDragPos] = useState<{
    pieceId: string;
    fromSlotId: string;
    x: number;
    y: number;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<number | null>(null);
  const fillsRef = useRef(fills);
  fillsRef.current = fills;
  const panning = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const userZoomed = useRef(false);
  const pieceDrag = useRef<{
    pointerId: number;
    pieceId: string;
    fromSlotId: string;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const pieceDragListeners = useRef<{
    move: (ev: PointerEvent) => void;
    up: (ev: PointerEvent) => void;
  } | null>(null);
  const story = boardStory(challenge);

  const world = useMemo(() => {
    const maxX = slots.reduce((m, s) => Math.max(m, s.x + SLOT_W), 640);
    const maxY = slots.reduce((m, s) => Math.max(m, s.y + SLOT_H), 320);
    return { w: maxX + 72, h: maxY + 48 };
  }, [slots]);

  const persist = useCallback((nextFills: Record<string, string | null>, reset = false) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const run = (): void => {
      void saveBoardGraph(session.id, { fills: nextFills, reset }).catch((err: unknown) => {
        const msg =
          (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data
            ?.error
          || (err as { message?: string })?.message
          || 'Save failed';
        setSaveError(msg);
      });
    };
    if (reset) {
      run();
      return;
    }
    saveTimer.current = window.setTimeout(run, 400);
  }, [session.id]);

  const applyFills = useCallback((nextFills: Record<string, string | null>, reset = false) => {
    setFills(nextFills);
    setSaveError(null);
    setDirtySinceGrade(reset ? false : Boolean(grade));
    persist(nextFills, reset);
  }, [grade, persist]);

  useEffect(() => {
    let cancelled = false;
    void fetchBoardState(session.id)
      .then((res) => {
        if (cancelled) return;
        const state = res.boardState;
        if (state?.trayOrder?.length) setTrayOrder(state.trayOrder);
        else setTrayOrder(pieces.map((p) => p.id));
        setFills(state?.fills && typeof state.fills === 'object' ? state.fills : {});
        setGrade(state?.lastGrade ?? null);
        setDirtySinceGrade(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data
            ?.error
          || (err as { message?: string })?.message
          || 'Failed to load board';
        setLoadError(msg);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, pieces]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || slots.length === 0) return;
    const fit = (): void => {
      if (userZoomed.current) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 40 || h < 40) return;
      const next = Math.min(1, Math.max(0.55, Math.min((w - 56) / world.w, (h - 36) / world.h)));
      if (Number.isFinite(next)) {
        setZoom(next);
        setPan({
          x: Math.max(24, Math.round((w - world.w * next) / 2)),
          y: 20,
        });
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [world.w, world.h, slots.length]);

  useEffect(() => () => {
    const listeners = pieceDragListeners.current;
    if (listeners) {
      window.removeEventListener('pointermove', listeners.move);
      window.removeEventListener('pointerup', listeners.up);
      window.removeEventListener('pointercancel', listeners.up);
    }
  }, []);

  const usedIds = useMemo(() => {
    const set = new Set<string>();
    for (const id of Object.values(fills)) {
      if (id) set.add(id);
    }
    return set;
  }, [fills]);

  const trayPieces = trayOrder
    .map((id) => byId.get(id))
    .filter((p): p is PublicBoardPiece => p != null && !usedIds.has(p.id));

  const selectedSlot = selectedSlotId ? slotById.get(selectedSlotId) || null : null;
  const selectedFillId = selectedSlotId ? fills[selectedSlotId] || null : null;
  const selectedPiece = selectedFillId
    ? byId.get(selectedFillId) || null
    : selectedPieceId && !usedIds.has(selectedPieceId)
      ? byId.get(selectedPieceId) || null
      : null;

  const checkById = useMemo(() => {
    const map = new Map<string, BoardGradeResult['checks'][number]>();
    if (!grade || dirtySinceGrade) return map;
    for (const c of grade.checks) map.set(c.id, c);
    return map;
  }, [grade, dirtySinceGrade]);

  const failedChecks = useMemo(() => {
    if (!grade || dirtySinceGrade) return [];
    return grade.checks.filter((c) => !c.passed);
  }, [grade, dirtySinceGrade]);

  const fillSlot = (slotId: string, pieceId: string): void => {
    if (!slotById.has(slotId) || !byId.has(pieceId)) return;
    const next: Record<string, string | null> = { ...fillsRef.current };
    for (const [sid, pid] of Object.entries(next)) {
      if (pid === pieceId) next[sid] = null;
    }
    next[slotId] = pieceId;
    applyFills(next);
    setSelectedSlotId(slotId);
    setSelectedPieceId(null);
  };

  const clearSlot = (slotId: string): void => {
    applyFills({ ...fillsRef.current, [slotId]: null });
    if (selectedSlotId === slotId) setSelectedPieceId(null);
  };

  const returnPiece = (pieceId: string): void => {
    const next: Record<string, string | null> = { ...fillsRef.current };
    let changed = false;
    for (const [sid, pid] of Object.entries(next)) {
      if (pid === pieceId) {
        next[sid] = null;
        changed = true;
      }
    }
    if (!changed) return;
    applyFills(next);
    setSelectedPieceId(pieceId);
    setSelectedSlotId(null);
  };

  const resetBoard = (): void => {
    if (!window.confirm('Reset the plan to empty shadows? Every widget goes back to Unused.')) {
      return;
    }
    const empty: Record<string, string | null> = {};
    for (const slot of slots) empty[slot.id] = null;
    applyFills(empty, true);
    setTrayOrder(pieces.map((p) => p.id));
    setGrade(null);
    setDirtySinceGrade(false);
    setSelectedSlotId(null);
    setSelectedPieceId(null);
    setDropSlot(null);
    setDropPalette(false);
  };

  const handleSubmit = async (): Promise<void> => {
    setSubmitting(true);
    setSaveError(null);
    try {
      const res = await submitBoard(session.id, { fills: fillsRef.current });
      setGrade(res.grade);
      setDirtySinceGrade(false);
      if (res.boardState?.fills) setFills(res.boardState.fills);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data
          ?.error
        || (err as { message?: string })?.message
        || 'Submit failed';
      setSaveError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const slotClass = (slot: PublicBoardSlot): string => {
    const filled = Boolean(fills[slot.id]);
    const parts = ['board-slot', filled ? 'is-filled' : 'is-empty'];
    if (slot.optional) parts.push('is-optional');
    if (selectedSlotId === slot.id) parts.push('is-selected');
    if (dropSlot === slot.id) parts.push('is-drop');
    const check = checkById.get(slot.id);
    if (check && filled) parts.push(check.passed ? 'is-ok' : 'is-bad');
    if (pieceDragPos && fills[slot.id] === pieceDragPos.pieceId) parts.push('is-dragging');
    return parts.join(' ');
  };

  const onCanvasPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.board-slot')) return;
    setSelectedSlotId(null);
    panning.current = { x: pan.x, y: pan.y, px: e.clientX, py: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onCanvasPointerMove = (e: React.PointerEvent): void => {
    if (!panning.current) return;
    setPan({
      x: panning.current.x + (e.clientX - panning.current.px),
      y: panning.current.y + (e.clientY - panning.current.py),
    });
  };

  const onCanvasPointerUp = (): void => {
    panning.current = null;
  };

  const tryPlaceSelected = (slotId: string): void => {
    if (selectedPieceId && !usedIds.has(selectedPieceId)) {
      fillSlot(slotId, selectedPieceId);
      return;
    }
    setSelectedSlotId(slotId);
  };

  const onFilledPointerDown = (
    e: React.PointerEvent,
    slot: PublicBoardSlot,
    piece: PublicBoardPiece,
  ): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const drag = {
      pointerId: e.pointerId,
      pieceId: piece.id,
      fromSlotId: slot.id,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    pieceDrag.current = drag;

    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== drag.pointerId) return;
      if (!drag.active) {
        if (Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < 8) return;
        drag.active = true;
      }
      ev.preventDefault();
      setPieceDragPos({
        pieceId: drag.pieceId,
        fromSlotId: drag.fromSlotId,
        x: ev.clientX,
        y: ev.clientY,
      });
      const hit = hitBoardDrop(ev.clientX, ev.clientY);
      setDropSlot(hit.slotId);
      setDropPalette(hit.palette);
    };
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId !== drag.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      pieceDragListeners.current = null;
      const wasActive = drag.active;
      pieceDrag.current = null;
      setPieceDragPos(null);
      setDropSlot(null);
      setDropPalette(false);
      if (!wasActive) {
        tryPlaceSelected(slot.id);
        return;
      }
      const hit = hitBoardDrop(ev.clientX, ev.clientY);
      if (hit.slotId) fillSlot(hit.slotId, drag.pieceId);
      else if (hit.palette) returnPiece(drag.pieceId);
    };
    pieceDragListeners.current = { move: onMove, up: onUp };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const dragGhostPiece = pieceDragPos ? byId.get(pieceDragPos.pieceId) : null;

  return (
    <div className="workspace board-workspace">
      <header className="board-top">
        <div className="board-top-copy">
          <p className="board-kicker">Spark · Fill the plan</p>
          <h1 className="board-title">{challenge?.title || 'Board'}</h1>
        </div>
        <div className="board-top-actions">
          {saveError && <span className="board-save-error">{saveError}</span>}
          {grade && !dirtySinceGrade && (
            <span className={`board-score${grade.passed ? ' pass' : ' fail'}`}>
              {grade.correctRequired}/{grade.requiredCount}
              {grade.passed ? ' passed' : ''}
            </span>
          )}
          {onClose && (
            <button type="button" className="board-icon-btn" title="Back to Whiteboard" onClick={onClose}>
              <IconLibrary color="currentColor" />
            </button>
          )}
          <button
            type="button"
            className="board-reset-btn"
            title="Reset to empty shadows"
            onClick={resetBoard}
            disabled={submitting || (usedIds.size === 0 && !grade)}
          >
            Reset
          </button>
          <button
            type="button"
            className="board-submit-btn"
            onClick={() => void handleSubmit()}
            disabled={submitting}
          >
            <IconSubmit color="currentColor" />
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </header>

      {loadError && <div className="alert">{loadError}</div>}

      {grade && (
        <div className={`board-grade-strip${grade.passed ? ' pass' : ' fail'}${dirtySinceGrade ? ' stale' : ''}`}>
          <strong>
            {dirtySinceGrade ? 'Blocks changed — submit again to regrade.' : grade.summary}
          </strong>
          {!dirtySinceGrade && failedChecks.length > 0 && (
            <details>
              <summary>{failedChecks.length} to fix</summary>
              <ul>
                {failedChecks.map((c) => (
                  <li key={c.id}>
                    {c.label}
                    {c.detail ? ` — ${c.detail}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className={`board-body${storyOpen ? '' : ' board-body--story-closed'}`}>
        <div className={`board-story-rail${storyOpen ? '' : ' is-collapsed'}`}>
          {storyOpen ? (
            <section className="board-story" aria-label="Story">
              <header className="board-rail-head">
                <h2>Story</h2>
                <button
                  type="button"
                  className="board-place-btn"
                  onClick={() => setStoryOpen(false)}
                >
                  Hide
                </button>
              </header>
              <div className="board-story-body">
                {story.overview && (
                  <MarkdownProse text={story.overview} className="markdown-prose board-story-prose" />
                )}
                {(story.yourTask || story.steps.length > 0) && (
                  <section className="board-story-task">
                    <h3>Your task</h3>
                    {story.yourTask && <p>{story.yourTask}</p>}
                    {story.steps.length > 0 && (
                      <ol>
                        {story.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    )}
                  </section>
                )}
                {story.hints.length > 0 && (
                  <details className="board-story-hints">
                    <summary>Hints</summary>
                    <ul>
                      {story.hints.map((hint) => (
                        <li key={hint}>{hint}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </section>
          ) : (
            <button
              type="button"
              className="board-story-reopen"
              onClick={() => setStoryOpen(true)}
            >
              Story
            </button>
          )}
        </div>

        <div
          ref={canvasRef}
          className="board-canvas"
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onWheel={(e) => {
            e.preventDefault();
            userZoomed.current = true;
            const next = Math.min(1.6, Math.max(0.45, zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
            setZoom(next);
          }}
          role="application"
          aria-label="Physical plan shadow"
        >
          <div
            className="board-world"
            style={{
              width: world.w,
              height: world.h,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            <svg className="board-edges" width={world.w} height={world.h} aria-hidden>
              <defs>
                <marker
                  id="board-arrow"
                  viewBox="0 0 10 8"
                  refX="9"
                  refY="4"
                  markerWidth="8"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M 0 0 L 10 4 L 0 8 z" fill="rgba(52, 211, 153, 0.55)" />
                </marker>
                <marker
                  id="board-arrow-optional"
                  viewBox="0 0 10 8"
                  refX="9"
                  refY="4"
                  markerWidth="8"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M 0 0 L 10 4 L 0 8 z" fill="rgba(251, 191, 36, 0.7)" />
                </marker>
              </defs>
              {spine && (
                <rect
                  className="board-spine"
                  x={spine.x}
                  y={spine.y}
                  width={spine.w}
                  height={spine.h}
                  rx="18"
                />
              )}
              {shadowEdges.map((e) => {
                const a = slotById.get(e.from);
                const b = slotById.get(e.to);
                if (!a || !b) return null;
                const optional = a.optional || b.optional;
                return (
                  <path
                    key={`${e.from}-${e.to}`}
                    className={`board-edge${optional ? ' is-optional' : ' is-shadow'}`}
                    d={edgePath(a, b)}
                    markerEnd={optional ? 'url(#board-arrow-optional)' : 'url(#board-arrow)'}
                  />
                );
              })}
            </svg>
            {slots.map((slot) => {
              const pieceId = fills[slot.id];
              const piece = pieceId ? byId.get(pieceId) : null;
              const step = stepIndex.get(slot.id);
              return (
                <div
                  key={slot.id}
                  className={slotClass(slot)}
                  data-kind={piece?.kind}
                  data-slot-id={slot.id}
                  role="button"
                  tabIndex={0}
                  aria-label={
                    piece
                      ? piece.title
                      : slot.optional
                        ? 'Optional empty block'
                        : `Step ${step ?? ''} empty block`
                  }
                  style={{ left: slot.x, top: slot.y, width: SLOT_W, height: SLOT_H }}
                  onPointerDown={(e) => {
                    if (piece) onFilledPointerDown(e, slot, piece);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropSlot(slot.id);
                  }}
                  onDragLeave={() => setDropSlot((cur) => (cur === slot.id ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropSlot(null);
                    const id = e.dataTransfer.getData('text/plain');
                    if (id) fillSlot(slot.id, id);
                  }}
                  onClick={() => {
                    if (pieceDrag.current?.active) return;
                    if (!piece) tryPlaceSelected(slot.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      tryPlaceSelected(slot.id);
                    }
                  }}
                >
                  <span className="board-slot-index">
                    {slot.optional ? 'opt' : step}
                  </span>
                  {piece ? (
                    <>
                      <span className="board-node-kind">{piece.kind}</span>
                      <span className="board-node-title">{piece.title}</span>
                    </>
                  ) : (
                    <>
                      <span className="board-slot-kicker">
                        {slot.optional ? 'Optional' : `Step ${step}`}
                      </span>
                      <span className="board-slot-label">Drop a widget</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <aside className={`board-side${dropPalette ? ' is-drop' : ''}`} aria-label="Widgets" data-board-return>
          <div className="board-inspector">
            <header className="board-rail-head">
              <h2>
                {selectedSlot && selectedFillId ? 'Block' : selectedPiece ? 'Widget' : 'Plan'}
              </h2>
            </header>
            {selectedSlot && selectedPiece && selectedFillId ? (
              <>
                <p className="board-node-kind" data-kind={selectedPiece.kind}>{selectedPiece.kind}</p>
                <h3 className="board-inspector-title">{selectedPiece.title}</h3>
                <p className="board-inspector-blurb">{selectedPiece.blurb}</p>
                <div className="board-inspector-places">
                  <button
                    type="button"
                    className="board-place-btn board-place-btn--off"
                    onClick={() => clearSlot(selectedSlot.id)}
                  >
                    Return to unused
                  </button>
                </div>
              </>
            ) : selectedSlot && !selectedFillId ? (
              <p className="board-rail-hint">
                {selectedSlot.optional
                  ? 'Optional step — fill it from Unused, or leave it empty.'
                  : 'Empty step on the plan. Drop a widget here from Unused.'}
              </p>
            ) : selectedPiece ? (
              <>
                <p className="board-node-kind" data-kind={selectedPiece.kind}>{selectedPiece.kind}</p>
                <h3 className="board-inspector-title">{selectedPiece.title}</h3>
                <p className="board-inspector-blurb">{selectedPiece.blurb}</p>
                <p className="board-rail-hint">Click an empty step to place this operator.</p>
              </>
            ) : (
              <p className="board-rail-hint">
                Fill each numbered step from Unused. The dashed block is optional.
              </p>
            )}
          </div>
          <aside
            className={`board-palette${dropPalette ? ' is-drop' : ''}`}
            aria-label="Unused operators"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDropPalette(true);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDropPalette(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDropPalette(false);
              const id = e.dataTransfer.getData('text/plain');
              if (id) returnPiece(id);
            }}
          >
            <header className="board-rail-head">
              <h2>Unused</h2>
              <span>{trayPieces.length}</span>
            </header>
            <p className="board-rail-hint">
              Drag onto a step. Drag a placed widget back here to unused.
            </p>
            <div className="board-palette-list">
              {trayPieces.length === 0 && (
                <p className="board-empty">Every widget is on the plan.</p>
              )}
              {trayPieces.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`board-chip${selectedPieceId === p.id ? ' is-selected' : ''}`}
                  data-kind={p.kind}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', p.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setSelectedPieceId(p.id);
                  }}
                  onClick={() => {
                    if (selectedSlotId && !fills[selectedSlotId]) {
                      fillSlot(selectedSlotId, p.id);
                      return;
                    }
                    setSelectedPieceId(p.id);
                    setSelectedSlotId(null);
                  }}
                  title={p.blurb}
                >
                  <span className="board-node-kind">{p.kind}</span>
                  <span className="board-chip-title">{p.title}</span>
                </button>
              ))}
            </div>
          </aside>
        </aside>
      </div>
      {dragGhostPiece && pieceDragPos && (
        <div
          className="board-drag-ghost"
          data-kind={dragGhostPiece.kind}
          style={{ left: pieceDragPos.x, top: pieceDragPos.y }}
          aria-hidden
        >
          <span className="board-node-kind">{dragGhostPiece.kind}</span>
          <span className="board-chip-title">{dragGhostPiece.title}</span>
        </div>
      )}
    </div>
  );
}

export function isBoardChallenge(
  challenge: ChallengePublic | ChallengeFull | null | undefined,
): boolean {
  return (challenge?.sandboxType || '') === 'board';
}
