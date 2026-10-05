import { isBoardChallenge } from '../components/BoardWorkspace';
import type { ReadingTrack } from '../constants/readingTracks';
import type { PlayPanel } from '../constants/playCatalog';
import type { ChallengePublic } from '../types/domain';

export type TrackRoadmapNode =
  | {
      kind: 'reading';
      key: string;
      trackId: string;
      title: string;
      href: string;
    }
  | {
      kind: 'lab';
      key: string;
      trackId: string;
      title: string;
      challenge: ChallengePublic;
      playable: boolean;
      solved: boolean;
    };

function catalogIdLabel(challenge: ChallengePublic): string {
  const fromK8sId = /^(?:k8s|linux|docker)-0*(\d+)-/i.exec(challenge.id)?.[1];
  if (fromK8sId) return String(Number(fromK8sId));
  if (/^l1-/i.test(challenge.id)) return '1';
  const ps = challenge.problemStatement;
  const fromPs =
    ps && typeof ps === 'object' && typeof (ps as { idLabel?: unknown }).idLabel === 'string'
      ? (ps as { idLabel: string }).idLabel.trim()
      : '';
  if (fromPs) return fromPs;
  return '—';
}

function labTrackId(challenge: ChallengePublic): string {
  const label = catalogIdLabel(challenge);
  return label === '—' ? '—' : `L${label}`;
}

/** Ordered blogs + labs for a panel (same order as the track table). */
export function buildPanelRoadmapNodes(
  panel: PlayPanel,
  readingTrack: ReadingTrack | null,
  byId: Map<string, ChallengePublic>,
): TrackRoadmapNode[] {
  const nodes: TrackRoadmapNode[] = [];

  if (readingTrack) {
    for (const item of readingTrack.listTrackItems()) {
      if (item.type === 'reading') {
        const reading = readingTrack.getReading(item.readingId);
        if (!reading) continue;
        if (reading.gatedByChallengeId && !byId.has(reading.gatedByChallengeId)) continue;
        nodes.push({
          kind: 'reading',
          key: item.id,
          trackId: reading.trackId,
          title: reading.title,
          href: readingTrack.readingPath(reading.slug),
        });
        continue;
      }
      const challenge = byId.get(item.challengeId);
      if (!challenge || isBoardChallenge(challenge)) continue;
      nodes.push({
        kind: 'lab',
        key: item.id,
        trackId: labTrackId(challenge),
        title: challenge.title,
        challenge,
        playable: Boolean(challenge.finalized),
        solved: Boolean(challenge.solved),
      });
    }
    return nodes;
  }

  for (const challengeId of panel.challengeIds) {
    const challenge = byId.get(challengeId);
    if (!challenge || isBoardChallenge(challenge)) continue;
    nodes.push({
      kind: 'lab',
      key: challenge.id,
      trackId: labTrackId(challenge),
      title: challenge.title,
      challenge,
      playable: Boolean(challenge.finalized),
      solved: Boolean(challenge.solved),
    });
  }

  return nodes;
}
