import React, { useEffect, useRef } from 'react';

type Rng = () => number;
type Pt = { x: number; y: number };

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function islandRing(rng: Rng): Pt[] {
  const pts: Pt[] = [];
  const n = 56;
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 - Math.PI * 0.55;
    const wobble =
      0.78 +
      0.1 * Math.sin(a * 2.2) +
      0.07 * Math.cos(a * 4.7) +
      0.04 * Math.sin(a * 9) +
      (rng() - 0.5) * 0.045;
    pts.push({
      x: 0.5 + Math.cos(a) * 0.37 * wobble,
      y: 0.49 + Math.sin(a) * 0.34 * wobble,
    });
  }
  return pts;
}

function inPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    const hit = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (hit) inside = !inside;
  }
  return inside;
}

function pathPoly(ctx: CanvasRenderingContext2D, pts: Pt[], sx: number, sy: number, start = true) {
  if (start) ctx.beginPath();
  ctx.moveTo(pts[0].x * sx, pts[0].y * sy);
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x * sx, pts[i].y * sy);
  ctx.closePath();
}

function drawParchment(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#e9d7ae');
  g.addColorStop(0.45, '#e0c997');
  g.addColorStop(1, '#d4b57a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 18; i += 1) {
    ctx.fillStyle = `rgba(120, 80, 30, ${0.018 + rng() * 0.03})`;
    ctx.beginPath();
    ctx.ellipse(rng() * w, rng() * h, 40 + rng() * 120, 24 + rng() * 70, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 16) {
    const n = (rng() - 0.5) * 18;
    d[i] = Math.min(255, d[i] + n);
    d[i + 1] = Math.min(255, d[i + 1] + n);
    d[i + 2] = Math.min(255, d[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
}

function drawBorder(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const m = Math.min(w, h) * 0.028;
  ctx.strokeStyle = '#5c4630';
  ctx.lineWidth = 2.2;
  ctx.strokeRect(m, m, w - m * 2, h - m * 2);
  ctx.lineWidth = 0.8;
  ctx.strokeRect(m + 6, m + 6, w - m * 2 - 12, h - m * 2 - 12);

  const corners: Pt[] = [
    { x: m + 10, y: m + 10 },
    { x: w - m - 10, y: m + 10 },
    { x: m + 10, y: h - m - 10 },
    { x: w - m - 10, y: h - m - 10 },
  ];
  ctx.strokeStyle = '#7a5a32';
  ctx.lineWidth = 1.2;
  for (const c of corners) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c.x, c.y, 7, 0.2, Math.PI * 1.6);
    ctx.stroke();
  }
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, shade: number) {
  ctx.fillStyle = '#5a3d24';
  ctx.fillRect(x - s * 0.07, y - s * 0.12, s * 0.14, s * 0.32);
  ctx.fillStyle = shade > 0.5 ? '#3f5c32' : '#2f4a28';
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.95);
  ctx.lineTo(x + s * 0.42, y - s * 0.08);
  ctx.lineTo(x - s * 0.42, y - s * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade > 0.5 ? '#527544' : '#3d5e36';
  ctx.beginPath();
  ctx.moveTo(x, y - s * 1.12);
  ctx.lineTo(x + s * 0.28, y - s * 0.38);
  ctx.lineTo(x - s * 0.28, y - s * 0.38);
  ctx.closePath();
  ctx.fill();
}

function drawPeak(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#6e6860';
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + w, y + h * 0.15);
  ctx.lineTo(x - w, y + h * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8b847c';
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + w * 0.28, y - h * 0.15);
  ctx.lineTo(x, y + h * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,36,32,0.28)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 5; i += 1) {
    const t = 0.25 + i * 0.14;
    ctx.beginPath();
    ctx.moveTo(x - w * (1 - t) * 0.7, y - h + h * t * 1.1);
    ctx.lineTo(x + w * (1 - t) * 0.35, y - h + h * t * 1.1);
    ctx.stroke();
  }
}

function drawKeep(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  kind: 'fortress' | 'walled' | 'manor' | 'castle' | 'abbey' | 'village' | 'hamlet' | 'outpost',
) {
  const stone = '#d9d1c4';
  const stoneDark = '#b7aea0';
  const roof = '#a33c2e';
  const roofDark = '#7a2a20';

  const block = (bx: number, by: number, bw: number, bh: number) => {
    ctx.fillStyle = stone;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = stoneDark;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
  };
  const peaked = (bx: number, by: number, bw: number, bh: number) => {
    block(bx, by, bw, bh);
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(bx - 2, by);
    ctx.lineTo(bx + bw / 2, by - bh * 0.55);
    ctx.lineTo(bx + bw + 2, by);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = roofDark;
    ctx.stroke();
  };

  if (kind === 'fortress' || kind === 'castle') {
    peaked(x - s * 0.55, y - s * 0.15, s * 0.28, s * 0.7);
    peaked(x + s * 0.28, y - s * 0.15, s * 0.28, s * 0.7);
    block(x - s * 0.32, y - s * 0.05, s * 0.64, s * 0.48);
    ctx.fillStyle = roof;
    ctx.fillRect(x - s * 0.32, y - s * 0.18, s * 0.64, s * 0.14);
    peaked(x - s * 0.12, y - s * 0.22, s * 0.24, s * 0.4);
  } else if (kind === 'walled') {
    block(x - s * 0.7, y + s * 0.1, s * 1.4, s * 0.18);
    peaked(x - s * 0.5, y - s * 0.05, s * 0.32, s * 0.38);
    peaked(x - s * 0.08, y - s * 0.12, s * 0.36, s * 0.42);
    peaked(x + s * 0.32, y - s * 0.02, s * 0.28, s * 0.34);
  } else if (kind === 'manor') {
    peaked(x - s * 0.55, y, s * 1.1, s * 0.42);
    peaked(x + s * 0.05, y - s * 0.18, s * 0.4, s * 0.38);
  } else if (kind === 'abbey') {
    peaked(x - s * 0.35, y, s * 0.7, s * 0.4);
    block(x - s * 0.08, y - s * 0.55, s * 0.16, s * 0.7);
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(x, y - s * 0.95);
    ctx.lineTo(x + s * 0.14, y - s * 0.55);
    ctx.lineTo(x - s * 0.14, y - s * 0.55);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'outpost') {
    peaked(x - s * 0.16, y - s * 0.1, s * 0.32, s * 0.7);
  } else {
    peaked(x - s * 0.42, y + s * 0.05, s * 0.28, s * 0.28);
    peaked(x - s * 0.08, y, s * 0.26, s * 0.3);
    peaked(x + s * 0.22, y + s * 0.08, s * 0.24, s * 0.24);
  }
}

function drawCompass(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.strokeStyle = '#5c4630';
  ctx.fillStyle = 'rgba(232, 214, 176, 0.65)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#a33c2e';
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.85);
  ctx.lineTo(x + r * 0.14, y);
  ctx.lineTo(x, y + r * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3a3228';
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.85);
  ctx.lineTo(x - r * 0.14, y);
  ctx.lineTo(x, y - r * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#5c4630';
  ctx.font = `bold ${Math.max(10, r * 0.28)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.fillText('N', x, y - r - 4);
}

function drawShip(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number) {
  const bob = Math.sin(t) * 3;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.fillStyle = '#5a3d24';
  ctx.beginPath();
  ctx.moveTo(-s, 0);
  ctx.lineTo(s, 0);
  ctx.lineTo(s * 0.7, s * 0.35);
  ctx.lineTo(-s * 0.7, s * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#efe6d4';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -s * 1.15);
  ctx.lineTo(s * 0.7, -s * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

interface World {
  land: Pt[];
  trees: { x: number; y: number; s: number; shade: number }[];
  peaks: { x: number; y: number; w: number; h: number }[];
  towns: { x: number; y: number; s: number; kind: Parameters<typeof drawKeep>[4] }[];
  river: Pt[];
  chimneys: Pt[];
}

function buildWorld(rng: Rng): World {
  const land = islandRing(rng);
  const trees: World['trees'] = [];
  for (let i = 0; i < 420; i += 1) {
    const p = { x: 0.18 + rng() * 0.64, y: 0.22 + rng() * 0.58 };
    if (!inPoly(p, land)) continue;
    if (p.y < 0.34 && p.x > 0.42) continue;
    trees.push({ x: p.x, y: p.y, s: 0.012 + rng() * 0.018, shade: rng() });
  }
  trees.sort((a, b) => a.y - b.y);

  const peaks: World['peaks'] = [];
  for (let i = 0; i < 14; i += 1) {
    peaks.push({
      x: 0.4 + rng() * 0.38,
      y: 0.2 + rng() * 0.16,
      w: 0.028 + rng() * 0.03,
      h: 0.05 + rng() * 0.07,
    });
  }

  const towns: World['towns'] = [
    { x: 0.3, y: 0.5, s: 0.055, kind: 'fortress' },
    { x: 0.47, y: 0.36, s: 0.05, kind: 'walled' },
    { x: 0.64, y: 0.5, s: 0.048, kind: 'manor' },
    { x: 0.5, y: 0.7, s: 0.052, kind: 'castle' },
    { x: 0.34, y: 0.6, s: 0.042, kind: 'abbey' },
    { x: 0.7, y: 0.3, s: 0.036, kind: 'village' },
    { x: 0.72, y: 0.6, s: 0.034, kind: 'hamlet' },
    { x: 0.78, y: 0.24, s: 0.032, kind: 'outpost' },
  ];

  const river: Pt[] = [
    { x: 0.58, y: 0.28 },
    { x: 0.55, y: 0.4 },
    { x: 0.52, y: 0.52 },
    { x: 0.54, y: 0.64 },
    { x: 0.57, y: 0.76 },
  ];

  const chimneys = towns.map((t) => ({ x: t.x + 0.01, y: t.y - t.s * 0.7 }));
  return { land, trees, peaks, towns, river, chimneys };
}

function paintStatic(ctx: CanvasRenderingContext2D, w: number, h: number, world: World, rng: Rng) {
  drawParchment(ctx, w, h, rng);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  pathPoly(ctx, world.land, w, h, false);
  ctx.clip('evenodd');
  ctx.fillStyle = 'rgba(122, 142, 152, 0.4)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  ctx.save();
  pathPoly(ctx, world.land, w, h);
  ctx.clip();
  ctx.fillStyle = 'rgba(110, 140, 72, 0.38)';
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = '#5c4630';
  ctx.lineWidth = 1.6;
  pathPoly(ctx, world.land, w, h);
  ctx.stroke();

  ctx.strokeStyle = '#5a8aa8';
  ctx.lineWidth = Math.max(2, w * 0.004);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(world.river[0].x * w, world.river[0].y * h);
  for (let i = 1; i < world.river.length; i += 1) {
    const p = world.river[i];
    ctx.lineTo(p.x * w, p.y * h);
  }
  ctx.stroke();

  for (const peak of world.peaks) drawPeak(ctx, peak.x * w, peak.y * h, peak.w * w, peak.h * h);
  for (const tree of world.trees) drawTree(ctx, tree.x * w, tree.y * h, tree.s * w, tree.shade);
  for (const town of world.towns) drawKeep(ctx, town.x * w, town.y * h, town.s * w, town.kind);

  drawCompass(ctx, w * 0.16, h * 0.84, Math.min(w, h) * 0.055);

  ctx.strokeStyle = '#6a5030';
  ctx.fillStyle = 'rgba(90, 64, 32, 0.08)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(w * 0.86, h * 0.14, Math.min(w, h) * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w * 0.86, h * 0.14, Math.min(w, h) * 0.03, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#4a3a28';
  ctx.font = `italic ${Math.max(13, w * 0.018)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.fillText('The Cinder Coast', w * 0.5, h * 0.08);

  drawBorder(ctx, w, h);
}

function paintFrame(
  ctx: CanvasRenderingContext2D,
  staticLayer: HTMLCanvasElement,
  w: number,
  h: number,
  world: World,
  t: number,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(staticLayer, 0, 0);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  pathPoly(ctx, world.land, w, h, false);
  ctx.clip('evenodd');
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = '#6d8490';
  ctx.lineWidth = 1;
  const gap = 14;
  for (let y = 20 + ((t * 12) % gap); y < h - 20; y += gap) {
    ctx.beginPath();
    for (let x = 16; x < w - 16; x += 8) {
      const yy = y + Math.sin(x * 0.04 + t * 1.4) * 1.8;
      if (x === 16) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.restore();

  drawShip(ctx, w * 0.12, h * 0.22, w * 0.018, t * 1.3);
  drawShip(ctx, w * 0.88, h * 0.7, w * 0.016, t * 1.1 + 2);
  drawShip(ctx, w * 0.82, h * 0.88, w * 0.014, t * 0.9 + 4);

  ctx.strokeStyle = 'rgba(90,64,32,0.45)';
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 3; i += 1) {
    const bx = w * (0.2 + i * 0.28);
    const by = h * (0.18 + Math.sin(t * 0.6 + i) * 0.02);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + 8, by - 6, bx + 16, by - 2);
    ctx.stroke();
  }

  for (const c of world.chimneys) {
    for (let i = 0; i < 4; i += 1) {
      const k = (t * 0.35 + i * 0.22) % 1;
      ctx.fillStyle = `rgba(90,90,90,${0.16 * (1 - k)})`;
      ctx.beginPath();
      ctx.ellipse(c.x * w + Math.sin(t + i) * 4, c.y * h - k * 28, 4 + k * 6, 3 + k * 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export default function KingdomCanvas(): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const world = buildWorld(mulberry32(50189));
    const staticLayer = document.createElement('canvas');
    let raf = 0;
    let running = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const fit = () => {
      const css = Math.min(wrap.clientWidth || 920, 920);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.width = `${css}px`;
      canvas.style.height = `${css}px`;
      canvas.width = Math.floor(css * dpr);
      canvas.height = Math.floor(css * dpr);
      staticLayer.width = canvas.width;
      staticLayer.height = canvas.height;
      const sctx = staticLayer.getContext('2d');
      if (!sctx) return;
      paintStatic(sctx, staticLayer.width, staticLayer.height, world, mulberry32(50196));
      paintFrame(ctx, staticLayer, canvas.width, canvas.height, world, 0);
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    const t0 = performance.now();
    const tick = (now: number) => {
      if (!running) return;
      if (!reduce) {
        paintFrame(ctx, staticLayer, canvas.width, canvas.height, world, (now - t0) / 1000);
      }
      raf = requestAnimationFrame(tick);
    };
    if (!reduce) raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} className="project-map-scene">
      <canvas ref={canvasRef} className="project-map-art" aria-label="The Cinder Coast" />
    </div>
  );
}
