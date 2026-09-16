/** Kubernetes "Start here" primer — plain notes before labs. */

import engineImg from '../assets/k8s-primer/k8s-primer-engine.png';
import wallImg from '../assets/k8s-primer/k8s-primer-wall.png';
import sharingImg from '../assets/k8s-primer/k8s-primer-sharing.png';
import labImg from '../assets/k8s-primer/k8s-primer-lab.png';

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
  image: string;
  imageAlt: string;
  caption: string;
}

export const K8S_PRIMER_SECTIONS: K8sPrimerSection[] = [
  {
    id: 'engine',
    eyebrow: 'The engine',
    title: 'Kubernetes is the orchestration layer',
    body: [
      'Kubernetes schedules and keeps containerized apps running across a cluster of machines. You describe what you want (pods, replicas, services); the cluster places containers, restarts failures, and gives workloads a stable way to talk to each other.',
      'It is not a replacement for your app code, and it is not “just Docker.” Docker (or another runtime) runs a container on one machine. Kubernetes decides where containers run, how many, and what happens when a node or process dies.',
    ],
    image: engineImg,
    imageAlt: 'Hand-drawn sketch: app containers scheduled as pods across a Kubernetes cluster',
    caption: 'Same app idea — containers scheduled across machines.',
  },
  {
    id: 'wall',
    eyebrow: 'The wall',
    title: 'When one server and docker run fall short',
    body: [
      'Running containers on a single server is fine for demos. It breaks down when you need several copies for traffic, automatic restarts at 3 a.m., or the machine itself fails and someone has to babysit `docker run` again.',
      'That wall shows up as manual restarts, snowflake hosts, and “it worked on my server” — not as a clean error message on day one.',
    ],
    example: {
      title: 'Example: guestbook front desk on one box vs a cluster',
      paragraphs: [
        'Same task: keep a small web front end up for a class project or internal demo.',
        'On one server you might `docker run` a container, publish a port, and hope the process stays up. With light traffic that works. When the process crashes overnight, the host reboots, or you need three copies behind one name, hand-operated containers stop being a plan.',
      ],
      bullets: [
        'Single server — one container: easy to start; you own restarts and upgrades',
        'Single server — crash or reboot: app stays down until a human fixes it',
        'Single server — need more capacity: you SSH in and start more containers by hand (or write fragile scripts)',
        'Kubernetes — same app as a Deployment: declare replicas; cluster creates pods and replaces dead ones',
        'What changes: desired state is continuous — the control plane keeps trying to make reality match your YAML',
      ],
    },
    image: wallImg,
    imageAlt: 'Hand-drawn sketch: overloaded single server versus pods rescheduled across nodes',
    caption: 'When docker run on one server is not enough.',
  },
  {
    id: 'sharing',
    eyebrow: 'Sharing the work',
    title: 'Desired state, pods, nodes, and Services',
    body: [
      'You give the cluster a desired state — usually YAML or imperative kubectl flags. The control plane reconciles: create missing pods, remove extras, reschedule work if a node disappears.',
      'A Pod is the smallest deployable unit (one or more containers that schedule together). Nodes are the machines that run pods. A Service gives pods a stable name and load-balances traffic so clients do not chase changing pod IPs.',
      'Going back to the front-desk example: a Deployment keeps N replicas Ready; a Service named front-desk points at those pods. You watch with kubectl — not by SSHing into every node.',
    ],
    example: {
      title: 'How orchestration eases the same app',
      paragraphs: [
        'Instead of one process on one host, Kubernetes spreads replicas across nodes. If a pod dies, a replacement is scheduled. Scaling is changing a number (replicas), not inventing a new ops ritual each time.',
      ],
      bullets: [
        'Control plane: stores desired state and reconciles toward it',
        'Nodes: run kubelet + containers for the pods assigned to them',
        'Pods: your running units (often one main container for L1 labs)',
        'Service: stable network handle in front of matching pods',
      ],
    },
    image: sharingImg,
    imageAlt: 'Hand-drawn sketch: control plane reconciles desired YAML state onto nodes and pods with a Service',
    caption: 'Declare what you want — the cluster keeps it true.',
  },
  {
    id: 'lab',
    eyebrow: 'Inside a lab',
    title: 'What you will do in DevLabs',
    body: [
      'You work inside your own namespace with kubectl (and a YAML scratch pad). Apply resources, watch pods become Ready, then submit for grading.',
      'Labs grade the cluster state — Deployments, Services, labels — not memorized trivia. When something fails, describe + logs + events are your first mirrors.',
      'Start with small L1 objects (Pod → Deployment → Service). The “one server vs cluster” intuition above is why those labs matter before every API resource.',
    ],
    image: labImg,
    imageAlt: 'Hand-drawn comic: write YAML, apply in your namespace, pods run, submit grade',
    caption: 'Declare → apply → run → grade.',
  },
];

export const K8S_PRIMER_NEXT_LINKS: Array<{ label: string; href: string; external?: boolean }> = [
  {
    label: 'Reading: Containers, runtimes, and Pods',
    href: '/play/devops-engineer/kubernetes/read/containers-runtimes-pods',
  },
  {
    label: 'Reading: Controllers, ReplicaSets, and Deployments',
    href: '/play/devops-engineer/kubernetes/read/controllers-replicasets-deployments',
  },
  {
    label: 'Official Kubernetes concepts',
    href: 'https://kubernetes.io/docs/concepts/',
    external: true,
  },
  {
    label: 'Pods documentation',
    href: 'https://kubernetes.io/docs/concepts/workloads/pods/',
    external: true,
  },
  {
    label: 'Open Kubernetes labs',
    href: K8S_LABS_PATH,
  },
];
