import React from 'react';
import { Link } from 'react-router-dom';
import { MONTHLY_PAPER_PATH } from '../constants/monthlyPaper';
import { useMonthlyPaper } from '../hooks/useMonthlyPaper';
import { IconCoins } from './ChromeIcons';

/** Desktop left-column teaser; the paper, PDF and quiz live on the monthly paper page. */
export default function MonthlyPaperCard(): JSX.Element | null {
  const { state } = useMonthlyPaper();
  if (!state) return null;
  const { paper } = state;
  return (
    <Link to={MONTHLY_PAPER_PATH} className="play-sidebar-card monthly-paper" aria-label={`Paper of the Month: ${paper.title}`}>
      <span className="monthly-paper-coin" title={`Up to ${state.tokensPerPaper} tokens`}>
        <IconCoins size={18} />
      </span>
      <h3 className="monthly-paper-title">{paper.title}</h3>
      <p className="monthly-paper-blurb">{paper.blurb}</p>
      <span className="monthly-paper-open" aria-hidden>
        Read the paper →
      </span>
    </Link>
  );
}

/** Mobile banner at the top of the track page, in place of the left column. */
export function MonthlyPaperBanner(): JSX.Element | null {
  const { state } = useMonthlyPaper();
  if (!state) return null;
  return (
    <Link to={MONTHLY_PAPER_PATH} className="monthly-paper-banner">
      <span className="monthly-paper-banner-kicker">Monthly Paper</span>
      <span className="monthly-paper-banner-title">{state.paper.title}</span>
      <span className="monthly-paper-banner-arrow" aria-hidden>→</span>
    </Link>
  );
}
