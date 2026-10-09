import React from 'react';

/** Atmospheric feature visuals — distinct from the hero terminal panel. */

export function TracksAnim(): JSX.Element {
  return (
    <div className="viz viz--tracks" aria-hidden>
      <div className="viz-glow viz-glow--a" />
      <div className="viz-glow viz-glow--b" />

      <div className="viz-tracks-head">
        <div className="viz-tracks-name-cycle">
          <strong data-n="1">Data Engineer</strong>
          <strong data-n="2">DevOps Engineer</strong>
          <strong data-n="3">Platform Engineer</strong>
          <strong data-n="4">Systems Engineer</strong>
        </div>
      </div>

      <div className="viz-tracks-main">
        <div className="viz-curve">
          <svg className="viz-curve-svg" viewBox="0 0 420 140" fill="none" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="vizCurveStroke" x1="20" y1="100" x2="400" y2="40" gradientUnits="userSpaceOnUse">
                <stop stopColor="#10b981" stopOpacity="0.2" />
                <stop offset="0.5" stopColor="#34d399" stopOpacity="0.85" />
                <stop offset="1" stopColor="#38bdf8" stopOpacity="0.9" />
              </linearGradient>
              <filter id="vizCurveGlow" x="-20%" y="-40%" width="140%" height="180%">
                <feGaussianBlur stdDeviation="2" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <path
              className="viz-curve-rail"
              d="M28 108 C 110 108, 130 52, 210 58 C 290 64, 310 36, 392 40"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              className="viz-curve-draw"
              d="M28 108 C 110 108, 130 52, 210 58 C 290 64, 310 36, 392 40"
              stroke="url(#vizCurveStroke)"
              strokeWidth="2.25"
              strokeLinecap="round"
              filter="url(#vizCurveGlow)"
            />
            <circle className="viz-curve-dot" data-d="1" cx="28" cy="108" r="4.5" />
            <circle className="viz-curve-dot" data-d="2" cx="210" cy="58" r="4.5" />
            <circle className="viz-curve-dot" data-d="3" cx="392" cy="40" r="4.5" />
            <circle className="viz-curve-pulse" r="5.5" filter="url(#vizCurveGlow)">
              <animateMotion
                dur="9s"
                repeatCount="indefinite"
                path="M28 108 C 110 108, 130 52, 210 58 C 290 64, 310 36, 392 40"
              />
            </circle>
          </svg>
          <div className="viz-curve-labels">
            <span data-c="1">Reading</span>
            <span data-c="2">Solving labs</span>
            <span data-c="3">Instant grading</span>
          </div>
          <div className="viz-curve-lines">
            <p data-line="1">Theory that sticks before you touch the cluster.</p>
            <p data-line="2">Run the challenge yourself — fail safely, iterate.</p>
            <p data-line="3">Know what passed, what broke, and what to try next.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectsAnim(): JSX.Element {
  return (
    <div className="viz viz--projects" aria-hidden>
      <div className="viz-glow viz-glow--c" />
      <div className="viz-stack">
        <div className="viz-layer" data-l="1">
          <span className="viz-layer-tag">log</span>
          <div className="viz-layer-bars">
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className="viz-layer" data-l="2">
          <span className="viz-layer-tag">segments</span>
          <div className="viz-layer-tiles">
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className="viz-layer viz-layer--top" data-l="3">
          <span className="viz-layer-tag">lookup</span>
          <div className="viz-layer-key">
            <span>key</span>
            <em>→</em>
            <span className="viz-layer-val">value</span>
          </div>
        </div>
      </div>
      <p className="viz-projects-caption">theory ↔ live scratch</p>
    </div>
  );
}

export function WhiteboardAnim(): JSX.Element {
  return (
    <div className="viz viz--board" aria-hidden>
      <div className="viz-glow viz-glow--d" />
      <p className="viz-board-prompt">“Design a resilient order pipeline…”</p>

      <svg className="viz-board-svg" viewBox="0 0 440 200" fill="none" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="vizBoardStroke" x1="40" y1="40" x2="400" y2="170" gradientUnits="userSpaceOnUse">
            <stop stopColor="#34d399" stopOpacity="0.85" />
            <stop offset="1" stopColor="#38bdf8" stopOpacity="0.8" />
          </linearGradient>
          <filter id="vizBoardSoft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* links draw first as faint sketch */}
        <path
          className="viz-board-link"
          data-l="1"
          d="M95 58 C 150 58, 170 95, 220 100"
          stroke="url(#vizBoardStroke)"
          strokeWidth="1.75"
          strokeLinecap="round"
          filter="url(#vizBoardSoft)"
        />
        <path
          className="viz-board-link"
          data-l="2"
          d="M345 58 C 290 58, 270 95, 220 100"
          stroke="url(#vizBoardStroke)"
          strokeWidth="1.75"
          strokeLinecap="round"
          filter="url(#vizBoardSoft)"
        />
        <path
          className="viz-board-link"
          data-l="3"
          d="M220 118 C 220 145, 220 150, 220 162"
          stroke="url(#vizBoardStroke)"
          strokeWidth="1.75"
          strokeLinecap="round"
          filter="url(#vizBoardSoft)"
        />

        {/* soft nodes */}
        <g className="viz-board-node" data-n="1">
          <rect x="42" y="40" width="90" height="36" rx="10" />
          <text x="87" y="62" textAnchor="middle">
            Order in
          </text>
        </g>
        <g className="viz-board-node" data-n="2">
          <rect x="300" y="40" width="90" height="36" rx="10" />
          <text x="345" y="62" textAnchor="middle">
            Pay
          </text>
        </g>
        <g className="viz-board-node viz-board-node--focus" data-n="3">
          <rect x="175" y="88" width="90" height="36" rx="10" />
          <text x="220" y="110" textAnchor="middle">
            Reserve
          </text>
        </g>
        <g className="viz-board-node" data-n="4">
          <rect x="175" y="158" width="90" height="36" rx="10" />
          <text x="220" y="180" textAnchor="middle">
            Ship
          </text>
        </g>
      </svg>

      <div className="viz-board-lines">
        <p data-line="1">Start from the problem statement.</p>
        <p data-line="2">Sketch blocks, flows, and constraints.</p>
        <p data-line="3">Reason about design before you implement.</p>
      </div>
    </div>
  );
}
