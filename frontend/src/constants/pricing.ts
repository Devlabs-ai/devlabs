import { getPlayDomain, getPlayPanel } from './playCatalog';
import { LINUX_LABS_PATH, LINUX_READINGS } from './linuxReadings';
import { DOCKER_LABS_PATH, DOCKER_READINGS } from './dockerReadings';
import { K8S_LABS_PATH } from './k8sPrimer';
import { K8S_READINGS } from './k8sReadings';

export const PRICING_PATH = '/pricing';

export const LAUNCH_OFFER = {
  percentOff: 40,
  endsAt: new Date('2026-11-30T23:59:59+05:30'),
};

export function offerPrice(price: number): number {
  return Math.round(price * (1 - LAUNCH_OFFER.percentOff / 100));
}

const COMMUNITY = 'Community access (Discord)';

export interface PricingPlan {
  id: string;
  name: string;
  /** Monthly price in INR. */
  price: number;
  path: string;
  checklist: string[];
  featured?: boolean;
}

const devops = getPlayDomain('devops-engineer');
const labCount = (panelId: string): number => getPlayPanel(devops, panelId)?.challengeIds.length ?? 0;

const linuxLabs = labCount('linux');
const dockerLabs = labCount('docker');
const k8sLabs = labCount('kubernetes');

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'linux',
    name: 'Linux',
    price: 199,
    path: LINUX_LABS_PATH,
    checklist: [
      `${linuxLabs} hands-on labs`,
      `${LINUX_READINGS.length} blog readings`,
      'Your own Linux machine',
      'Instant grading on every submit',
      COMMUNITY,
    ],
  },
  {
    id: 'docker',
    name: 'Docker',
    price: 249,
    path: DOCKER_LABS_PATH,
    checklist: [
      `${dockerLabs} hands-on labs`,
      `${DOCKER_READINGS.length} blog readings`,
      'A real Docker host per lab',
      'Instant grading on every submit',
      COMMUNITY,
    ],
  },
  {
    id: 'kubernetes',
    name: 'Kubernetes',
    price: 399,
    path: K8S_LABS_PATH,
    checklist: [
      `${k8sLabs} hands-on labs`,
      `${K8S_READINGS.length} blog readings`,
      'Isolated namespace on a live cluster',
      'CKAD-style scenarios',
      COMMUNITY,
    ],
  },
  {
    id: 'devops-engineer',
    name: 'DevOps Engineer',
    price: 699,
    path: '/track/devops-engineer',
    featured: true,
    checklist: [
      'Everything in Linux, Docker and Kubernetes',
      `${linuxLabs + dockerLabs + k8sLabs} hands-on labs`,
      `${LINUX_READINGS.length + DOCKER_READINGS.length + K8S_READINGS.length} blog readings`,
      COMMUNITY,
      'One price for the whole track',
    ],
  },
];
