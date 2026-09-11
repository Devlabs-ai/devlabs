'use strict';

import type {
  BoardGradeCheck,
  BoardGradeResult,
  BoardGraphEdge,
  BoardGraphNode,
  BoardPiece,
  BoardSpec,
  BoardState,
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
  slots: Array<{ id: string; optional: boolean; x: number; y: number }>;
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
        detail: 'Drop an operator into this block.',
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
        detail: piece.trapIfPlaced || 'This operator does not belong on the path.',
      });
      return;
    }
    if (got !== want) {
      checks.push({
        id: slot.id,
        label,
        passed: false,
        required: true,
        detail: 'Wrong operator for this step.',
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
        detail: piece.trapIfPlaced || 'Leave this unused, or pick the optional operator.',
      });
      return;
    }
    if (got !== want) {
      checks.push({
        id: slot.id,
        label,
        passed: false,
        required: false,
        detail: 'This optional block is empty, or a different operator.',
      });
      return;
    }
    checks.push({
      id: slot.id,
      label,
      passed: true,
      required: false,
      detail: 'Optional operator placed.',
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
  const passed = correctRequired === requiredCount && trapsPlaced === 0 && !optionalFailed;

  const summary = passed
    ? 'The blocks match the distinct() lifecycle.'
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
  };
}

function parseParents(p: Record<string, unknown>): string[] {
  if (Array.isArray(p.parents)) {
    return p.parents.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
  }
  if (typeof p.parent === 'string' && p.parent.trim()) return [p.parent.trim()];
  return [];
}

function parseBoardSpec(raw: unknown): BoardSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as { pieces?: unknown };
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
      };
    })
    .filter((item): item is BoardSpec['pieces'][number] => Boolean(item));
  if (!pieces.length) return null;
  return { pieces };
}

function publicBoardSpec(spec: BoardSpec | {
  pieces?: Array<{
    id: string;
    title: string;
    blurb: string;
    kind: 'stage' | 'mechanism';
    gold?: string;
  }>;
  shadow?: { slots: BoardShadow['slots']; edges: BoardGraphEdge[] };
} | null): {
  pieces: Array<{ id: string; title: string; blurb: string; kind: 'stage' | 'mechanism' }>;
  shadow: { slots: BoardShadow['slots']; edges: BoardGraphEdge[] };
} | null {
  if (!spec || !Array.isArray(spec.pieces) || spec.pieces.length === 0) return null;
  const strip = (p: { id: string; title: string; blurb: string; kind: 'stage' | 'mechanism' }) => ({
    id: p.id,
    title: p.title,
    blurb: p.blurb,
    kind: p.kind,
  });
  const hasGold = spec.pieces.some((p) =>
    (p as { gold?: string }).gold === 'required'
    || (p as { gold?: string }).gold === 'optional'
    || (p as { gold?: string }).gold === 'tray',
  );
  if (!hasGold) {
    const shadow = spec.shadow;
    if (!shadow || !Array.isArray(shadow.slots) || shadow.slots.length === 0) return null;
    return {
      pieces: spec.pieces.map(strip),
      shadow: { slots: shadow.slots, edges: Array.isArray(shadow.edges) ? shadow.edges : [] },
    };
  }
  const parsed = parseBoardSpec(spec);
  if (!parsed) return null;
  return {
    pieces: parsed.pieces.map(strip),
    shadow: publicShadow(parsed),
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
  return { trayOrder: shuffled, fills, nodes: [], edges: [], lastGrade: null };
}

function coerceBoardState(raw: unknown, spec: BoardSpec): BoardState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyBoardState(spec);
  const rec = raw as {
    trayOrder?: unknown;
    lastGrade?: BoardState['lastGrade'];
    fills?: unknown;
    nodes?: unknown;
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
  };
}

module.exports = {
  gradeBoard,
  normalizeGraph,
  parseBoardSpec,
  publicBoardSpec,
  emptyBoardState,
  coerceBoardState,
};
