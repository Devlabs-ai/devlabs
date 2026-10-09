'use strict';

import type {
  BoardClaimResult,
  BoardFinale,
  BoardFinaleOption,
  BoardGameConfig,
  BoardGameState,
  BoardGradeCheck,
  BoardGradeResult,
  BoardGraphEdge,
  BoardGraphNode,
  BoardPiece,
  BoardSpec,
  BoardState,
  PublicBoardSpec,
} from '../types/domain';

const LANE_X: Record<string, number> = {
  driver: 48,
  map: 280,
  network: 512,
  reduce: 744,
};

function titleOf(spec: BoardSpec, id: string): string {
  return spec.pieces.find((p) => p.id === id)?.title || id;
}

function edgeKey(from: string, to: string): string {
  return `${from}\0${to}`;
}

function parentsOf(p: BoardPiece): string[] {
  return p.parents.filter(Boolean);
}

function migrateLegacyPlaced(raw: unknown, spec: BoardSpec): { nodes: BoardGraphNode[]; edges: BoardGraphEdge[] } {
  if (!Array.isArray(raw)) return { nodes: [], edges: [] };
  const known = new Set(spec.pieces.map((p) => p.id));
  const slots: Array<{ id: string; lane: string; order: number }> = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as { id?: unknown; lane?: unknown; order?: unknown };
    const id = typeof rec.id === 'string' ? rec.id.trim() : '';
    const lane = typeof rec.lane === 'string' ? rec.lane.trim() : '';
    const order = typeof rec.order === 'number' && Number.isFinite(rec.order)
      ? rec.order
      : Number(rec.order);
    if (!id || seen.has(id) || !known.has(id) || !lane || !Number.isFinite(order)) continue;
    seen.add(id);
    slots.push({ id, lane, order });
  }
  const nodes = slots.map((s) => ({
    id: s.id,
    x: LANE_X[s.lane] ?? 48,
    y: 56 + Math.max(0, s.order - 1) * 92,
  }));
  const byLane = new Map<string, string[]>();
  for (const s of slots.sort((a, b) => a.order - b.order)) {
    const list = byLane.get(s.lane) || [];
    list.push(s.id);
    byLane.set(s.lane, list);
  }
  const edges: BoardGraphEdge[] = [];
  for (const list of byLane.values()) {
    for (let i = 1; i < list.length; i++) edges.push({ from: list[i - 1], to: list[i] });
  }
  const laneOrder = ['driver', 'map', 'network', 'reduce'];
  let prevLast: string | null = null;
  for (const lane of laneOrder) {
    const list = byLane.get(lane) || [];
    if (list.length === 0) continue;
    if (prevLast) edges.push({ from: prevLast, to: list[0] });
    prevLast = list[list.length - 1];
  }
  return { nodes, edges };
}

function clampCoord(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(-4000, Math.min(8000, n));
}

function normalizeGraph(raw: unknown, spec: BoardSpec): { nodes: BoardGraphNode[]; edges: BoardGraphEdge[] } {
  const known = new Set(spec.pieces.map((p) => p.id));
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as { nodes?: unknown; edges?: unknown; placed?: unknown })
    : null;

  if (Array.isArray(raw)) return migrateLegacyPlaced(raw, spec);
  if (rec && Array.isArray(rec.placed) && !Array.isArray(rec.nodes)) {
    return migrateLegacyPlaced(rec.placed, spec);
  }

  const nodes: BoardGraphNode[] = [];
  const seen = new Set<string>();
  const srcNodes = Array.isArray(rec?.nodes) ? rec.nodes : [];
  srcNodes.forEach((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const n = item as { id?: unknown; x?: unknown; y?: unknown };
    const id = typeof n.id === 'string' ? n.id.trim() : '';
    if (!id || seen.has(id) || !known.has(id)) return;
    seen.add(id);
    nodes.push({
      id,
      x: clampCoord(Number(n.x), 48 + (i % 4) * 220),
      y: clampCoord(Number(n.y), 56 + Math.floor(i / 4) * 96),
    });
  });
  const onGraph = new Set(nodes.map((n) => n.id));
  const edges: BoardGraphEdge[] = [];
  const edgeSeen = new Set<string>();
  const srcEdges = Array.isArray(rec?.edges) ? rec.edges : [];
  for (const item of srcEdges) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const e = item as { from?: unknown; to?: unknown };
    const from = typeof e.from === 'string' ? e.from.trim() : '';
    const to = typeof e.to === 'string' ? e.to.trim() : '';
    if (!from || !to || from === to) continue;
    if (!onGraph.has(from) || !onGraph.has(to)) continue;
    const k = edgeKey(from, to);
    if (edgeSeen.has(k)) continue;
    edgeSeen.add(k);
    edges.push({ from, to });
  }
  return { nodes, edges };
}

const SLOT_W = 228;
const SLOT_H = 70;
const SLOT_GAP_Y = 34;
const SLOT_GAP_X = 56;
const SLOT_START_X = 96;
const SLOT_START_Y = 24;

interface BoardShadow {
  slots: Array<{ id: string; optional: boolean; x: number; y: number; prompt: string | null }>;
  edges: BoardGraphEdge[];
  gold: Record<string, string>;
}

function topoRequired(spec: BoardSpec): BoardPiece[] {
  const required = spec.pieces.filter((p) => p.gold === 'required');
  const ids = new Set(required.map((p) => p.id));
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const p of required) {
    indeg.set(p.id, 0);
    adj.set(p.id, []);
  }
  for (const p of required) {
    for (const par of parentsOf(p)) {
      if (!ids.has(par)) continue;
      adj.set(par, [...(adj.get(par) || []), p.id]);
      indeg.set(p.id, (indeg.get(p.id) || 0) + 1);
    }
  }
  const q = required.filter((p) => (indeg.get(p.id) || 0) === 0).map((p) => p.id);
  const order: string[] = [];
  while (q.length) {
    const id = q.shift() as string;
    order.push(id);
    for (const next of adj.get(id) || []) {
      const left = (indeg.get(next) || 1) - 1;
      indeg.set(next, left);
      if (left === 0) q.push(next);
    }
  }
  for (const p of required) {
    if (!order.includes(p.id)) order.push(p.id);
  }
  const byId = new Map(required.map((p) => [p.id, p]));
  return order.map((id) => byId.get(id)).filter((p): p is BoardPiece => Boolean(p));
}

function buildShadow(spec: BoardSpec): BoardShadow {
  const required = topoRequired(spec);
  const pieceToSlot = new Map<string, string>();
  const gold: Record<string, string> = {};
  const slots: BoardShadow['slots'] = required.map((p, i) => {
    const id = `s${i + 1}`;
    pieceToSlot.set(p.id, id);
    gold[id] = p.id;
    return {
      id,
      optional: false,
      x: SLOT_START_X,
      y: SLOT_START_Y + i * (SLOT_H + SLOT_GAP_Y),
      prompt: p.prompt,
    };
  });
  const edges: BoardGraphEdge[] = [];
  for (let i = 1; i < required.length; i++) {
    edges.push({ from: `s${i}`, to: `s${i + 1}` });
  }
  const optionals = spec.pieces.filter((p) => p.gold === 'optional' && p.child);
  optionals.forEach((opt, k) => {
    const par = parentsOf(opt)[0];
    const fromSlot = par ? pieceToSlot.get(par) : null;
    const toSlot = opt.child ? pieceToSlot.get(opt.child) : null;
    const id = `o${k + 1}`;
    gold[id] = opt.id;
    const fromBox = slots.find((s) => s.id === fromSlot);
    const toBox = slots.find((s) => s.id === toSlot);
    const x = (fromBox ? fromBox.x : SLOT_START_X) + SLOT_W + SLOT_GAP_X;
    const y = fromBox && toBox
      ? Math.round((fromBox.y + toBox.y) / 2)
      : (fromBox ? fromBox.y : SLOT_START_Y);
    slots.push({
      id,
      optional: true,
      x,
      y,
      prompt: opt.prompt,
    });
    if (fromSlot) edges.push({ from: fromSlot, to: id });
    if (toSlot) edges.push({ from: id, to: toSlot });
  });
  return { slots, edges, gold };
}

function publicShadow(spec: BoardSpec): { slots: BoardShadow['slots']; edges: BoardGraphEdge[] } {
  const { slots, edges } = buildShadow(spec);
  return { slots, edges };
}

function parseFills(raw: unknown, spec: BoardSpec): Record<string, string | null> {
  const shadow = buildShadow(spec);
  const slotIds = new Set(shadow.slots.map((s) => s.id));
  const known = new Set(spec.pieces.map((p) => p.id));
  const fills: Record<string, string | null> = {};
  for (const s of shadow.slots) fills[s.id] = null;
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as { fills?: unknown })
    : null;
  const src = rec && rec.fills && typeof rec.fills === 'object' && !Array.isArray(rec.fills)
    ? rec.fills as Record<string, unknown>
    : rec && !('nodes' in (rec as object)) && !('placed' in (rec as object)) && !('trayOrder' in (rec as object))
      ? rec as Record<string, unknown>
      : null;
  if (!src) return fills;
  const used = new Set<string>();
  for (const [slotId, value] of Object.entries(src)) {
    if (!slotIds.has(slotId)) continue;
    const pieceId = typeof value === 'string' ? value.trim() : '';
    if (!pieceId || !known.has(pieceId) || used.has(pieceId)) {
      fills[slotId] = null;
      continue;
    }
    used.add(pieceId);
    fills[slotId] = pieceId;
  }
  return fills;
}

function gradeBoard(spec: BoardSpec, graphRaw: unknown): BoardGradeResult {
  const shadow = buildShadow(spec);
  const fills = parseFills(graphRaw, spec);
  const byPiece = new Map(spec.pieces.map((p) => [p.id, p]));
  const checks: BoardGradeCheck[] = [];
  const used = new Set(Object.values(fills).filter((id): id is string => Boolean(id)));

  const requiredSlots = shadow.slots.filter((s) => !s.optional);
  const optionalSlots = shadow.slots.filter((s) => s.optional);

  requiredSlots.forEach((slot, i) => {
    const want = shadow.gold[slot.id];
    const got = fills[slot.id];
    const label = `Step ${i + 1}`;
    if (!got) {
      checks.push({
        id: slot.id,
        label,
        passed: false,
        required: true,
        detail: 'Drop a card into this block.',
      });
      return;
    }
    const piece = byPiece.get(got);
    if (piece?.gold === 'tray') {
      checks.push({
        id: slot.id,
        label,
        passed: false,
        required: true,
        detail: piece.trapIfPlaced || 'This card does not belong on the path.',
      });
      return;
    }
    if (got !== want) {
      checks.push({
        id: slot.id,
        label,
        passed: false,
        required: true,
        detail: 'Wrong card for this step.',
      });
      return;
    }
    checks.push({
      id: slot.id,
      label,
      passed: true,
      required: true,
      detail: 'Filled.',
    });
  });

  optionalSlots.forEach((slot, i) => {
    const want = shadow.gold[slot.id];
    const got = fills[slot.id];
    const label = optionalSlots.length === 1 ? 'Optional step' : `Optional step ${i + 1}`;
    if (!got) {
      checks.push({
        id: slot.id,
        label,
        passed: true,
        required: false,
        skipped: true,
        detail: 'Left empty — allowed.',
      });
      return;
    }
    const piece = byPiece.get(got);
    if (piece?.gold === 'tray') {
      checks.push({
        id: slot.id,
        label,
        passed: false,
        required: false,
        detail: piece.trapIfPlaced || 'Leave this unused, or pick the optional card.',
      });
      return;
    }
    if (got !== want) {
      checks.push({
        id: slot.id,
        label,
        passed: false,
        required: false,
        detail: 'Wrong card for the optional block.',
      });
      return;
    }
    checks.push({
      id: slot.id,
      label,
      passed: true,
      required: false,
      detail: 'Optional card placed.',
    });
  });

  let trapsPlaced = 0;
  for (const piece of spec.pieces.filter((p) => p.gold === 'tray')) {
    if (!used.has(piece.id)) {
      checks.push({
        id: piece.id,
        label: piece.title,
        passed: true,
        required: false,
        detail: 'Left unused.',
      });
      continue;
    }
    trapsPlaced += 1;
    if (!checks.some((c) => c.detail === (piece.trapIfPlaced || 'Leave this unused.') && !c.passed)) {
      checks.push({
        id: piece.id,
        label: piece.title,
        passed: false,
        required: false,
        detail: piece.trapIfPlaced || 'Leave this unused.',
      });
    }
  }

  const requiredChecks = checks.filter((c) => c.required);
  const correctRequired = requiredChecks.filter((c) => c.passed).length;
  const requiredCount = requiredChecks.length;
  const optionalFailed = checks.some((c) => !c.required && !c.skipped && !c.passed && shadow.slots.some((s) => s.optional && s.id === c.id));
  const boardPassed = correctRequired === requiredCount && trapsPlaced === 0 && !optionalFailed;
  const game = graphRaw && typeof graphRaw === 'object' && 'game' in (graphRaw as object)
    ? coerceGame((graphRaw as { game?: unknown }).game, spec)
    : defaultGame(spec);
  const needsFinale = Boolean(spec.finale) && boardPassed && !game.finaleCorrect;
  const passed = boardPassed && (!spec.finale || game.finaleCorrect);
  const stars = passed && game.livesMax != null && game.lives != null
    ? (game.resets > 0 ? 1 : Math.max(1, Math.min(3, 3 - (game.livesMax - game.lives))))
    : null;

  const summary = passed
    ? spec.passMessage || 'Every block is in the right place.'
    : needsFinale
      ? 'Every block is right. One last question.'
      : [
        correctRequired < requiredCount
          ? `${correctRequired}/${requiredCount} required blocks correct`
          : null,
        trapsPlaced > 0 ? `${trapsPlaced} trap${trapsPlaced === 1 ? '' : 's'} on the path` : null,
        optionalFailed ? 'optional block is wrong' : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'Not quite.';

  return {
    passed,
    summary,
    checks,
    correctRequired,
    requiredCount,
    trapsPlaced,
    boardPassed,
    needsFinale,
    stars,
  };
}

function parseParents(p: Record<string, unknown>): string[] {
  if (Array.isArray(p.parents)) {
    return p.parents.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
  }
  if (typeof p.parent === 'string' && p.parent.trim()) return [p.parent.trim()];
  return [];
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function parseGameConfig(raw: unknown): BoardGameConfig {
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const mode = rec.mode === 'unlock' || rec.mode === 'debate' ? rec.mode : 'classic';
  const lives = typeof rec.lives === 'number' && Number.isFinite(rec.lives) && rec.lives > 0
    ? Math.min(9, Math.trunc(rec.lives))
    : null;
  return { mode, lives };
}

function parseFinale(raw: unknown): BoardFinale | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const prompt = text(rec.prompt);
  const answer = text(rec.answer);
  const options = Array.isArray(rec.options)
    ? rec.options
      .map((o) => {
        const r = o && typeof o === 'object' ? o as Record<string, unknown> : {};
        const id = text(r.id);
        const label = text(r.label);
        return id && label ? { id, label } : null;
      })
      .filter((o): o is BoardFinaleOption => Boolean(o))
    : [];
  if (!prompt || !answer || !options.some((o) => o.id === answer)) return null;
  return { prompt, options, answer, explanation: text(rec.explanation) || '' };
}

function parseBoardSpec(raw: unknown): BoardSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as {
    pieces?: unknown;
    kicker?: unknown;
    passMessage?: unknown;
    game?: unknown;
    finale?: unknown;
    trayLabel?: unknown;
    unlockAfter?: unknown;
  };
  if (!Array.isArray(rec.pieces)) return null;
  const pieces = rec.pieces
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const p = item as Record<string, unknown>;
      const id = typeof p.id === 'string' ? p.id.trim() : '';
      const title = typeof p.title === 'string' ? p.title.trim() : '';
      if (!id || !title) return null;
      const gold = p.gold === 'required' || p.gold === 'optional' || p.gold === 'tray' ? p.gold : 'tray';
      return {
        id,
        title,
        blurb: typeof p.blurb === 'string' ? p.blurb : '',
        kind: p.kind === 'mechanism' ? 'mechanism' as const : 'stage' as const,
        gold,
        parents: parseParents(p),
        child: typeof p.child === 'string' && p.child.trim() ? p.child.trim() : null,
        trapIfPlaced: typeof p.trapIfPlaced === 'string' ? p.trapIfPlaced : null,
        prompt: gold !== 'tray' ? text(p.prompt) : null,
        clue: gold === 'required' ? text(p.clue) : null,
        speaker: text(p.speaker),
      };
    })
    .filter((item): item is BoardSpec['pieces'][number] => Boolean(item));
  if (!pieces.length) return null;
  return {
    pieces,
    kicker: text(rec.kicker),
    passMessage: text(rec.passMessage),
    game: parseGameConfig(rec.game),
    finale: parseFinale(rec.finale),
    trayLabel: text(rec.trayLabel),
    unlockAfter: text(rec.unlockAfter),
  };
}

type PublicPieceIn = {
  id: string;
  title: string;
  blurb: string;
  kind: 'stage' | 'mechanism';
  speaker?: string | null;
  gold?: string;
};

function publicBoardSpec(spec: (Omit<Partial<BoardSpec>, 'pieces' | 'finale'> & {
  pieces?: PublicPieceIn[];
  shadow?: { slots: BoardShadow['slots']; edges: BoardGraphEdge[] };
  finale?: { prompt: string; options: BoardFinaleOption[]; answer?: string } | null;
}) | null): PublicBoardSpec | null {
  if (!spec || !Array.isArray(spec.pieces) || spec.pieces.length === 0) return null;
  const strip = (p: PublicPieceIn) => ({
    id: p.id,
    title: p.title,
    blurb: p.blurb,
    kind: p.kind,
    speaker: p.speaker ?? null,
  });
  const extras = (s: typeof spec) => ({
    kicker: text(s.kicker),
    game: parseGameConfig(s.game),
    finale: s.finale && s.finale.prompt
      ? { prompt: s.finale.prompt, options: s.finale.options || [] }
      : null,
    trayLabel: text(s.trayLabel),
    unlockAfter: text(s.unlockAfter),
  });
  const hasGold = spec.pieces.some((p) =>
    p.gold === 'required' || p.gold === 'optional' || p.gold === 'tray',
  );
  if (!hasGold) {
    const shadow = spec.shadow;
    if (!shadow || !Array.isArray(shadow.slots) || shadow.slots.length === 0) return null;
    return {
      pieces: spec.pieces.map(strip),
      shadow: { slots: shadow.slots, edges: Array.isArray(shadow.edges) ? shadow.edges : [] },
      ...extras(spec),
    };
  }
  const parsed = parseBoardSpec(spec);
  if (!parsed) return null;
  return {
    pieces: parsed.pieces.map(strip),
    shadow: publicShadow(parsed),
    ...extras(parsed),
  };
}

function emptyBoardState(spec: BoardSpec): BoardState {
  const ids = spec.pieces.map((p) => p.id);
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  const fills = parseFills({}, spec);
  return { trayOrder: shuffled, fills, nodes: [], edges: [], lastGrade: null, game: defaultGame(spec) };
}

function defaultGame(spec: BoardSpec, resets = 0): BoardGameState {
  const lives = spec.game?.lives ?? null;
  return {
    lives,
    livesMax: lives,
    step: 0,
    clues: [],
    claims: null,
    finaleCorrect: false,
    finaleExplanation: null,
    resets,
    over: false,
  };
}

function coerceGame(raw: unknown, spec: BoardSpec): BoardGameState {
  const base = defaultGame(spec);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const rec = raw as Partial<BoardGameState>;
  const required = buildShadow(spec).slots.filter((s) => !s.optional).length;
  const lives = base.livesMax == null
    ? null
    : Math.max(0, Math.min(base.livesMax, Number.isFinite(rec.lives) ? Number(rec.lives) : base.livesMax));
  return {
    lives,
    livesMax: base.livesMax,
    step: Math.max(0, Math.min(required, Number.isFinite(rec.step) ? Number(rec.step) : 0)),
    clues: Array.isArray(rec.clues) ? rec.clues.filter((c): c is string => typeof c === 'string') : [],
    claims: rec.claims && typeof rec.claims === 'object' ? rec.claims : null,
    finaleCorrect: rec.finaleCorrect === true,
    finaleExplanation: typeof rec.finaleExplanation === 'string' ? rec.finaleExplanation : null,
    resets: Number.isFinite(rec.resets) ? Math.max(0, Number(rec.resets)) : 0,
    over: lives === 0,
  };
}

function coerceBoardState(raw: unknown, spec: BoardSpec): BoardState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyBoardState(spec);
  const rec = raw as {
    trayOrder?: unknown;
    lastGrade?: BoardState['lastGrade'];
    fills?: unknown;
    nodes?: unknown;
    game?: unknown;
  };
  const fills = parseFills(rec, spec);
  const migrated = Array.isArray(rec.nodes) && rec.fills == null;
  const tray = Array.isArray(rec.trayOrder)
    ? rec.trayOrder.filter((id): id is string => typeof id === 'string')
    : spec.pieces.map((p) => p.id);
  return {
    trayOrder: tray.length ? tray : spec.pieces.map((p) => p.id),
    fills,
    nodes: [],
    edges: [],
    lastGrade: migrated ? null : rec.lastGrade ?? null,
    game: coerceGame(rec.game, spec),
  };
}

function loseLife(game: BoardGameState): void {
  if (game.lives == null) return;
  game.lives = Math.max(0, game.lives - 1);
  game.over = game.lives === 0;
}

type GameError = Error & { status?: number };

function gameError(message: string, status = 409): GameError {
  return Object.assign(new Error(message), { status });
}

function assertPlayable(game: BoardGameState): void {
  if (game.over) throw gameError('Out of lives. Reset the board to try again.');
}

/** Unlock mode: check one card against the current step. Mutates and returns the state. */
function checkStep(
  spec: BoardSpec,
  state: BoardState,
  slotId: string,
  pieceId: string,
): { state: BoardState; correct: boolean; detail: string; clue: string | null } {
  if (spec.game?.mode !== 'unlock') throw gameError('This board is not in step-by-step mode.');
  const game = state.game || defaultGame(spec);
  assertPlayable(game);
  const shadow = buildShadow(spec);
  const required = shadow.slots.filter((s) => !s.optional);
  const current = required[game.step];
  if (!current) throw gameError('Every step is already unlocked.');
  if (slotId !== current.id) throw gameError('That step is still locked. Fill the highlighted step first.');
  const piece = spec.pieces.find((p) => p.id === pieceId);
  if (!piece) throw gameError('Unknown card.', 400);
  if (Object.entries(state.fills).some(([sid, pid]) => pid === pieceId && sid !== slotId)) {
    throw gameError('That card is already on the board.', 400);
  }

  if (shadow.gold[current.id] === pieceId) {
    state.fills = { ...state.fills, [current.id]: pieceId };
    game.step += 1;
    if (piece.clue) game.clues = [...game.clues, piece.clue];
    state.game = game;
    return { state, correct: true, detail: 'Locked in.', clue: piece.clue };
  }
  loseLife(game);
  state.game = game;
  const detail = piece.gold === 'tray'
    ? piece.trapIfPlaced || 'That card is a trap.'
    : 'That card belongs on the board, just not at this step.';
  return { state, correct: false, detail, clue: null };
}

/** Debate mode: judge every claim. True claims are the ones that belong on the board. */
function judgeClaims(
  spec: BoardSpec,
  state: BoardState,
  verdictsRaw: unknown,
): { state: BoardState; wrong: number } {
  if (spec.game?.mode !== 'debate') throw gameError('This board has no claims to judge.');
  const game = state.game || defaultGame(spec);
  assertPlayable(game);
  if (game.claims) throw gameError('Claims are already judged. Reset the board to judge them again.');
  const verdicts = verdictsRaw && typeof verdictsRaw === 'object' && !Array.isArray(verdictsRaw)
    ? verdictsRaw as Record<string, unknown>
    : {};
  const missing = spec.pieces.filter((p) => typeof verdicts[p.id] !== 'boolean');
  if (missing.length) throw gameError(`Mark every claim true or false (${missing.length} left).`, 400);

  const claims: Record<string, BoardClaimResult> = {};
  let wrong = 0;
  for (const p of spec.pieces) {
    const verdict = verdicts[p.id] === true;
    const truth = p.gold !== 'tray';
    const correct = verdict === truth;
    if (!correct) wrong += 1;
    claims[p.id] = { verdict, correct, explanation: truth ? null : p.trapIfPlaced || 'This claim is false.' };
  }
  for (let i = 0; i < wrong; i++) loseLife(game);
  game.claims = claims;
  state.game = game;
  // False claims leave the table; the board is built from the true ones.
  state.trayOrder = state.trayOrder.filter((id) => spec.pieces.find((p) => p.id === id)?.gold !== 'tray');
  return { state, wrong };
}

/** Closing question; only once every block is correct. */
function answerFinale(
  spec: BoardSpec,
  state: BoardState,
  optionId: unknown,
): { state: BoardState; correct: boolean; explanation: string } {
  if (!spec.finale) throw gameError('This board has no final question.');
  const game = state.game || defaultGame(spec);
  assertPlayable(game);
  if (!gradeBoard(spec, state).boardPassed) throw gameError('Get every block right first.');
  if (game.finaleCorrect) {
    return { state, correct: true, explanation: game.finaleExplanation || spec.finale.explanation };
  }
  const correct = optionId === spec.finale.answer;
  if (correct) {
    game.finaleCorrect = true;
    game.finaleExplanation = spec.finale.explanation;
  } else {
    loseLife(game);
  }
  state.game = game;
  return {
    state,
    correct,
    explanation: correct ? spec.finale.explanation : 'Not quite. Look at the board again and think about what the evidence points to.',
  };
}

module.exports = {
  gradeBoard,
  normalizeGraph,
  parseBoardSpec,
  publicBoardSpec,
  emptyBoardState,
  coerceBoardState,
  defaultGame,
  loseLife,
  assertPlayable,
  checkStep,
  judgeClaims,
  answerFinale,
};
