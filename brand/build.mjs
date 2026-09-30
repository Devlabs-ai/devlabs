// Renders DevSetu social assets with headless Chrome.
// Usage: node brand/build.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'social');
const TMP = join(tmpdir(), 'devsetu-brand');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const EMERALD = '#10b981';
const EMERALD_BRIGHT = '#34d399';
const SKY = '#38bdf8';
const INK = '#eef0ff';
const INK_DARK = '#0b1020';

const mark = (size, { edge = EMERALD, node = EMERALD, apex = SKY } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" fill="none">
  <g stroke="${edge}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="32" y1="16" x2="14" y2="48" />
    <line x1="32" y1="16" x2="50" y2="48" />
    <line x1="14" y1="48" x2="50" y2="48" />
  </g>
  <circle cx="32" cy="16" r="6.5" fill="${apex}" />
  <circle cx="14" cy="48" r="6.5" fill="${node}" />
  <circle cx="50" cy="48" r="6.5" fill="${node}" />
</svg>`;

const DARK_BG = `
  background:
    radial-gradient(ellipse 70% 60% at 50% 45%, rgba(16,185,129,0.20), transparent 65%),
    radial-gradient(ellipse 50% 40% at 50% 20%, rgba(56,189,248,0.10), transparent 70%),
    #05070d;`;

const page = (w, h, body, { bg = 'transparent' } = {}) => `<!doctype html>
<html><head><meta charset="utf-8" />
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@500,700,900&display=block" rel="stylesheet" />
<style>
  html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; }
  body { ${bg === 'transparent' ? 'background: transparent;' : bg}
    font-family: 'Satoshi', -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }
  .center { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
  .word { font-weight: 700; letter-spacing: -0.035em; line-height: 1; }
  .word .dev { color: var(--dev, ${INK}); }
  .word .setu { color: var(--setu, ${EMERALD_BRIGHT}); }
</style></head><body>${body}</body></html>`;

const lockup = (markSize, fontSize, gap, vars = '') => `
  <div style="display:flex;align-items:center;gap:${gap}px;${vars}">
    ${mark(markSize)}
    <span class="word" style="font-size:${fontSize}px"><span class="dev">Dev</span><span class="setu">Setu</span></span>
  </div>`;

// Faint node-graph texture for banners.
const graphTexture = (w, h) => {
  const pts = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 28; i++) pts.push([rnd() * w, rnd() * h]);
  const lines = [];
  pts.forEach((a, i) => {
    pts.slice(i + 1).forEach((b) => {
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (d < w * 0.14) lines.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" />`);
    });
  });
  const dots = pts.map(([x, y], i) =>
    `<circle cx="${x}" cy="${y}" r="3.5" fill="${i % 5 === 0 ? SKY : EMERALD}" />`).join('');
  return `<svg width="${w}" height="${h}" style="position:absolute;inset:0;opacity:0.22">
    <g stroke="${EMERALD}" stroke-width="1.2" stroke-opacity="0.6">${lines.join('')}</g>${dots}</svg>`;
};

const banner = (w, h) => page(w, h, `
  <div style="position:relative;width:100%;height:100%">
    ${graphTexture(w, h)}
    <div style="position:absolute;inset:0;background:radial-gradient(ellipse 55% 75% at 50% 50%, rgba(5,7,13,0.92) 35%, transparent 80%)"></div>
    <div class="center" style="position:relative;flex-direction:column;gap:${Math.round(h * 0.07)}px">
      ${lockup(Math.round(h * 0.30), Math.round(h * 0.22), Math.round(h * 0.05))}
      <div style="color:#98a2c2;font-weight:500;font-size:${Math.round(h * 0.075)}px;letter-spacing:-0.01em">
        The bridge to become a versatile engineer
      </div>
    </div>
  </div>`, { bg: DARK_BG });

const ASSETS = [
  // Profile pictures — mark sits inside the circular crop safe zone.
  ['avatar-dark-1024.png', 1024, 1024, page(1024, 1024,
    `<div class="center">${mark(700)}</div>`, { bg: DARK_BG })],
  ['avatar-light-1024.png', 1024, 1024, page(1024, 1024,
    `<div class="center">${mark(700, { edge: '#059669', node: '#059669', apex: '#0ea5e9' })}</div>`,
    { bg: 'background:#ffffff;' })],
  ['avatar-emerald-1024.png', 1024, 1024, page(1024, 1024,
    `<div class="center">${mark(700, { edge: '#ffffff', node: '#ffffff', apex: '#05070d' })}</div>`,
    { bg: `background:linear-gradient(160deg, ${EMERALD_BRIGHT}, #047857);` })],

  ['avatar-dark-lockup-1024.png', 1024, 1024, page(1024, 1024, `
    <div class="center" style="flex-direction:column;gap:56px">
      ${mark(440)}
      <span class="word" style="font-size:150px"><span class="dev">Dev</span><span class="setu">Setu</span></span>
    </div>`, { bg: DARK_BG })],

  // Horizontal lockups.
  ['logo-horizontal-dark.png', 2400, 800, page(2400, 800,
    `<div class="center">${lockup(420, 300, 70)}</div>`, { bg: DARK_BG })],
  ['logo-horizontal-transparent-light-text.png', 2400, 800, page(2400, 800,
    `<div class="center">${lockup(420, 300, 70)}</div>`)],
  ['logo-horizontal-transparent-dark-text.png', 2400, 800, page(2400, 800,
    `<div class="center">${lockup(420, 300, 70, `--dev:${INK_DARK};--setu:#059669;`)}</div>`)],
  ['mark-transparent-1024.png', 1024, 1024, page(1024, 1024,
    `<div class="center">${mark(900)}</div>`)],

  // Banners / cards.
  ['banner-linkedin-1584x396.png', 1584, 396, banner(1584, 396)],
  ['banner-x-1500x500.png', 1500, 500, banner(1500, 500)],
  ['banner-youtube-2560x1440.png', 2560, 1440, banner(2560, 1440)],
  ['og-card-1200x630.png', 1200, 630, banner(1200, 630)],
];

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });

for (const [name, w, h, html] of ASSETS) {
  const htmlPath = join(TMP, `${name}.html`);
  writeFileSync(htmlPath, html);
  execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    '--virtual-time-budget=6000',
    `--window-size=${w},${h}`,
    `--screenshot=${join(OUT, name)}`,
    `file://${htmlPath}`,
  ], { stdio: 'ignore' });
  console.log(`✓ ${name} (${w}×${h})`);
}

// Vector source for the mark (lockup text needs Satoshi, so it ships as PNG).
writeFileSync(join(OUT, 'mark.svg'), mark(64).trim() + '\n');
console.log('✓ mark.svg');
