/** Kubernetes "Start here" primer — why the platform exists, before labs. */

export const K8S_PRIMER_PATH = '/play/devops-engineer/kubernetes/intro';
export const K8S_LABS_PATH = '/play/devops-engineer/kubernetes';

export interface K8sPrimerExample {
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface K8sPrimerSection {
  id: string;
  eyebrow: string;
  title: string;
  body: string[];
  example?: K8sPrimerExample;
}

export const K8S_PRIMER_SECTIONS: K8sPrimerSection[] = [
  {
    id: 'history',
    eyebrow: 'History',
    title: 'From Borg to the industry default',
    body: [
      'Kubernetes did not appear out of nowhere. Google had already run containers at enormous scale for more than a decade with an internal system called Borg. Engineers who worked on that world open-sourced Kubernetes in 2014 so the rest of the industry could get a portable way to schedule and heal containerized apps across machines.',
      'The project moved under the Cloud Native Computing Foundation (CNCF) and became the shared control plane that vendors, clouds, and startups could agree on. Managed offerings (GKE, EKS, AKS, and many others) made “a cluster” a product you buy, not a research project you build from scratch.',
      'That combination — battle-tested ideas, open governance, and cloud packaging — is why Kubernetes is still the default answer when teams ask how to run many services reliably without tying the company to one vendor’s proprietary orchestrator.',
    ],
  },
  {
    id: 'problem',
    eyebrow: 'What it solves',
    title: 'An abstract of the problem',
    body: [
      'Modern products are not one process on one server. They are dozens or hundreds of services that must start, stop, scale with traffic, survive machine failure, and roll out without weekend fire drills. Containers package each service; something still has to decide where those containers run, how many copies exist, and what happens when a box dies at 3 a.m.',
      'Kubernetes is that something: a control plane that takes a desired state (“keep three healthy copies of checkout behind this name”) and continuously drives the cluster toward it. Scheduling, restarts, rolling updates, and a stable network front for changing backends are the core jobs — not writing your business logic for you.',
      'In short: Docker (or another runtime) runs a container on a machine. Kubernetes keeps fleets of containers alive across machines so product teams can ship faster without reinventing ops for every service.',
    ],
    example: {
      title: 'The wall it removes',
      paragraphs: [
        'Without an orchestrator, growth usually means more SSH sessions, more snowflake hosts, and more “it worked on my box” incidents. With one, capacity and recovery become declared policy instead of tribal knowledge.',
      ],
      bullets: [
        'Place work across a pool of machines instead of pinning each app to a pet server',
        'Replace failed instances automatically instead of paging a human for every crash',
        'Scale replicas with demand instead of hand-starting containers under load',
        'Roll out (and roll back) versions safely instead of big-bang weekend cutovers',
      ],
    },
  },
  {
    id: 'impact',
    eyebrow: 'In the wild',
    title: 'Companies that grew on Kubernetes',
    body: [
      'Public case studies are not marketing fluff when you read them for the outcome: more deploys, better machine use, or surviving a traffic spike without rewriting the product. A few well-known stories:',
    ],
    example: {
      title: 'Growth and ops wins teams talk about',
      paragraphs: [
        'These are condensed from public engineering posts and conference talks — useful as orientation, not as lab specs.',
      ],
      bullets: [
        'Niantic (Pokémon GO) — sudden global launch traffic was absorbed on Google Kubernetes Engine; the stack could scale nodes and pods without rebuilding the game for “viral day.”',
        'Spotify — moved from a home-grown Helios fleet to Kubernetes so hundreds of squads shared one deployment model; engineering time shifted from cluster babysitting to product work as the catalog of services grew.',
        'Airbnb — standardized services on Kubernetes to raise utilization and cut the toil of custom deployment paths as the marketplace scaled.',
        'Shopify — runs core commerce on Kubernetes so Black Friday / Cyber Monday peaks are capacity and rollout problems, not “rebuild the platform” problems — critical when GMV spikes are the business.',
        'The New York Times — migrated publishing and digital products onto cloud Kubernetes to retire aging data-center workflows and ship features on a shared platform as digital readership became the growth engine.',
        'Capital One — adopted Kubernetes as a standard runtime so product teams could provision and ship faster under bank-grade controls, supporting more digital products without a linear ops headcount curve.',
      ],
    },
  },
  {
    id: 'lab',
    eyebrow: 'Why labs',
    title: 'What you will practice in DevSetu',
    body: [
      'The stories above all rest on the same muscle: declare what should be running, apply it, and let the cluster reconcile. Labs train that muscle in a small namespace with kubectl — Deployments, Services, labels, and the mirrors you use when something is not Ready.',
      'You do not need every API object before Lab 1. You need the intuition that Kubernetes exists because companies outgrew one-server ops — and that desired state is how they keep shipping while the fleet grows.',
    ],
  },
];

export const K8S_PRIMER_NEXT_LINKS: Array<{ label: string; href: string; external?: boolean }> = [
  {
    label: 'Official Kubernetes documentation',
    href: 'https://kubernetes.io/docs/',
    external: true,
  },
  {
    label: 'CKAD exam curriculum (CNCF)',
    href: 'https://github.com/cncf/curriculum',
    external: true,
  },
];
