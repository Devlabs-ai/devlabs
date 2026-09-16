/** Kubernetes track readings (blogs) interleaved with labs. */

import { PLAY_DOMAINS } from './playCatalog';
import { K8S_LABS_PATH } from './k8sPrimer';
import vmVsContainerImg from '../assets/k8s-readings/containers-runtimes-pods/vm-vs-container.png';
import whatIsAPodImg from '../assets/k8s-readings/containers-runtimes-pods/what-is-a-pod.png';
import controllerLoopImg from '../assets/k8s-readings/controllers-replicasets-deployments/controller-loop.png';
import labelsSelectorsImg from '../assets/k8s-readings/controllers-replicasets-deployments/labels-selectors.png';
import replicaSetImg from '../assets/k8s-readings/controllers-replicasets-deployments/replicaset.png';
import deploymentLayersImg from '../assets/k8s-readings/controllers-replicasets-deployments/deployment-layers.png';
import whyDeploymentImg from '../assets/k8s-readings/controllers-replicasets-deployments/why-deployment.png';

export const K8S_READINGS_BASE = `${K8S_LABS_PATH}/read`;

export interface K8sReadingTable {
  headers: string[];
  rows: string[][];
}

export interface K8sReadingFigure {
  image: string;
  imageAlt: string;
  caption: string;
}

export interface K8sReadingCallout {
  kind: 'idea' | 'tip' | 'warn' | 'takeaway';
  title: string;
  body: string[];
}

export interface K8sReadingCodeBlock {
  language: string;
  code: string;
}

export interface K8sReadingSection {
  id: string;
  title: string;
  body: string[];
  table?: K8sReadingTable;
  /** Optional second table (e.g. after elaboration). */
  tableAfter?: K8sReadingTable;
  bullets?: string[];
  figure?: K8sReadingFigure;
  callout?: K8sReadingCallout;
  code?: K8sReadingCodeBlock;
  codes?: K8sReadingCodeBlock[];
  /** Extra paragraphs after figure / first code. */
  after?: string[];
  quote?: string;
}

export interface K8sReadingRelatedLab {
  challengeId: string;
  label: string;
}

export interface K8sReading {
  id: string;
  slug: string;
  trackId: string;
  eyebrow: string;
  title: string;
  lede: string;
  sections: K8sReadingSection[];
  takeaways: string[];
  relatedLabs: K8sReadingRelatedLab[];
}

export type K8sTrackItem =
  | { type: 'reading'; id: string; readingId: string }
  | { type: 'challenge'; id: string; challengeId: string };

export function k8sReadingPath(slug: string): string {
  return `${K8S_READINGS_BASE}/${slug}`;
}

export const K8S_READINGS: K8sReading[] = [
  {
    id: 'containers-runtimes-pods',
    slug: 'containers-runtimes-pods',
    trackId: 'B1',
    eyebrow: '',
    title: 'Containers, runtimes, and Pods',
    lede:
      'What a container is (beyond a venv), how a runtime starts it on Docker Desktop vs Kubernetes, and why Kubernetes schedules a Pod — not a bare container.',
    sections: [
      {
        id: 'what-is-a-container',
        title: 'Let’s first understand what a container is',
        body: [
          'A **container** is a way to run a program so it brings its own files and libraries with it, and is lightly isolated from other programs on the same machine.',
          'If you’ve used Python, the first fix that comes to mind for dependency clashes is a **venv**: a project-local environment so `pip install` does not pollute the whole system. That solves *library* isolation for one language on one OS.',
          'A **container** goes further. It packages the app **plus** a filesystem view (language runtime, system libraries, config files) so the process does not depend on “whatever happens to be installed on this host.” You can move that package to another machine and get the same shape of environment — not only the same pip packages.',
          'You still *run* a process either way. The container’s win is **how much of the environment travels with the app**.',
        ],
        table: {
          headers: ['', 'venv / language env', 'Container'],
          rows: [
            [
              'Isolates',
              'Mostly language packages',
              'App + OS-level files/libs it needs',
            ],
            [
              'Feels like',
              '“clean Python for this project”',
              '“a small portable machine view for this process”',
            ],
            [
              'Ships as',
              'Usually not a single runnable image',
              'An **image** you pull and run anywhere the runtime exists',
            ],
          ],
        },
        after: [
          'An **image** is that package (e.g. `rithvikreddyalkanti/order-processor:v1.0`). A **container** is a running instance of that image — the live process.',
        ],
      },
      {
        id: 'vm-vs-container',
        title: 'VM vs container',
        body: [
          'Before containers were common, the usual “give the app its own world” tool was a **virtual machine (VM)**.',
        ],
        figure: {
          image: vmVsContainerImg,
          imageAlt:
            'Hand-drawn sketch comparing a virtual machine with a full guest OS to a lighter container that shares the host kernel',
          caption: 'Same goal: run an app with its deps. Different isolation cost.',
        },
        after: [
          '**Virtual machine** — Emulates (or virtualizes) a whole computer on top of hardware. Inside: a **guest OS** with its **own kernel**, then libraries, then your app. Strong isolation: almost like a separate laptop. Cost: more CPU/memory, slower to create/boot, heavier to ship.',
          '**Container** — Does **not** boot a second OS. Uses the **host kernel** and isolates the process with OS features (namespaces, cgroups, etc.). Inside the container boundary you mainly see **your app + the libs/files it needs**. Cost: much lighter and faster to start; many containers can share one kernel.',
          'Same goal — run an app with its dependencies. Different isolation cost.',
        ],
        tableAfter: {
          headers: ['', 'VM', 'Container'],
          rows: [
            ['Kernel', 'Own guest kernel', 'Shared host kernel'],
            ['Typical start', 'Seconds to minutes', 'Often about a second'],
            [
              'Isolation strength',
              'Very strong',
              'Strong enough for most apps; not a full hardware VM',
            ],
            [
              'What you usually ship',
              'VM disk / image (large)',
              'Container image (smaller layers)',
            ],
          ],
        },
      },
      {
        id: 'runtime',
        title: 'What is a container runtime — Docker Desktop vs Kubernetes',
        body: [
          'A container does not start itself. A **container runtime** on the machine pulls the image, creates the container, and starts the process inside it.',
          '**On Docker Desktop (typical laptop)** — You talk to the Docker CLI/UI. Docker Desktop’s engine uses a runtime under the hood and starts the container on your machine (often inside a small Linux VM on Mac/Windows).',
        ],
        codes: [
          {
            language: 'text',
            code: 'you → Docker Desktop / docker CLI → engine → runtime → container',
          },
        ],
        after: [
          '**On Kubernetes (cluster)** — You do not usually “docker run” into the cluster. You declare a **Pod**. The **kubelet** on a node talks to a runtime through the **CRI** (Container Runtime Interface) and starts the container(s) *inside that Pod*.',
        ],
        code: {
          language: 'text',
          code: 'you → Pod YAML / kubectl → API server → kubelet → CRI → runtime → container(s) in the Pod',
        },
        callout: {
          kind: 'idea',
          title: 'Other runtimes besides Docker',
          body: [
            'Docker made containers popular, but it is not the only way to run them. Clusters commonly use **containerd** or **CRI-O** through Kubernetes’ **CRI** (Container Runtime Interface). Older setups talked to Docker Engine; many modern clusters never mention Docker at all — they still run the **same OCI images**, just with a different runtime under the kubelet. You may also hear **Podman** (Docker-compatible CLI, no daemon) on laptops — again: same container/image idea, different front door.',
          ],
        },
        quote:
          'Same kind of container (same OCI images). Different control path — Docker Desktop for one machine; Kubernetes for scheduling across nodes.',
      },
      {
        id: 'what-is-a-pod',
        title: 'What is a Pod?',
        body: [
          'Kubernetes does **not** schedule a bare container as its main object. The smallest deployable unit is a **Pod**.',
          'Read the three boundaries from the outside in:',
        ],
        bullets: [
          '**Node** — a worker machine in the cluster',
          '**Pod** — what Kubernetes places on a node (the basic unit)',
          '**Container** — the process running *inside* the Pod',
        ],
        figure: {
          image: whatIsAPodImg,
          imageAlt:
            'Hand-drawn sketch: Node machine containing a Pod boundary containing one container process',
          caption: 'One Pod sits on one Node. The container runs inside the Pod.',
        },
        after: [
          'A Pod wraps one or more containers that always land on **one** node together, share a network namespace (same Pod IP; they can talk on `localhost`), and can share volumes.',
          'For most simple apps: **one Pod → one container**.',
        ],
        quote:
          '**Container** = how the app runs. **Pod** = how Kubernetes names, places, and tracks that run. **Node** = which machine it landed on.',
      },
      {
        id: 'pod-yaml',
        title: 'Pod YAML: the schema you’ll use',
        body: ['You describe a Pod with a YAML document. Think of it as a form with fixed sections:'],
        code: {
          language: 'yaml',
          code: `apiVersion: v1          # which API understands this object
kind: Pod               # this object is a Pod
metadata:
  name: ...             # Pod’s name in the cluster
  # namespace: ...       # often comes from your kubectl context
  # labels: ...         # optional tags for selection later
spec:
  containers:
    - name: ...         # container name *inside* the Pod
      image: ...        # image to pull and run
      ports:
        - containerPort: ...   # port the process listens on
      resources:
        requests:              # CPU/memory the scheduler reserves
          cpu: "..."
          memory: "..."`,
        },
        table: {
          headers: ['Field', 'Role'],
          rows: [
            ['`apiVersion` / `kind`', '“This is a Pod (v1)”'],
            ['`metadata.name`', 'Identity of the Pod'],
            ['`spec.containers[].name`', 'Name of the container inside the Pod'],
            ['`spec.containers[].image`', 'Which image to run'],
            [
              '`spec.containers[].ports[].containerPort`',
              'Port the app binds to',
            ],
            [
              '`spec.containers[].resources.requests`',
              'What the scheduler reserves on a node',
            ],
          ],
        },
      },
    ],
    takeaways: [
      '**venv** isolates language packages; a **container** isolates a fuller filesystem/runtime view you can ship as an **image**.',
      'A **VM** gives a full guest OS; a **container** shares the host kernel and stays lighter.',
      'A **runtime** starts containers — via **Docker Desktop** on a laptop, or via **kubelet + CRI** on Kubernetes.',
      'Kubernetes schedules **Pods**, not bare containers; the **container** runs inside the Pod on a **Node**.',
      'Pod YAML is the form: `metadata` names the Pod; `spec.containers` names the image and how it runs.',
    ],
    relatedLabs: [
      {
        challengeId: 'l1-namespace-and-pod',
        label: 'Migrate Order Processor',
      },
    ],
  },
  {
    id: 'controllers-replicasets-deployments',
    slug: 'controllers-replicasets-deployments',
    trackId: 'B2',
    eyebrow: '',
    title: 'Controllers, ReplicaSets, and Deployments',
    lede:
      'A single Pod is fine for learning. Real apps need several copies, replacements when a Pod dies, and a way to change the image without deleting everything by hand. That is what controllers, ReplicaSets, and Deployments are for.',
    sections: [
      {
        id: 'pods-dont-babysit',
        title: 'Recap: Pods don’t babysit themselves',
        body: [
          'A **Pod** is the unit Kubernetes places on a node. If you create one Pod and it crashes or you delete it, **nothing automatically recreates it** unless something else is watching.',
          'That “something else” is usually a **controller**.',
        ],
      },
      {
        id: 'what-is-a-controller',
        title: 'What is a controller?',
        body: [
          'In Kubernetes, a **controller** is a control loop in the control plane that:',
        ],
        bullets: [
          'Reads a **desired state** (from an object you created — e.g. “I want 3 Pods like this”)',
          'Observes **current state** (how many matching Pods exist)',
          '**Acts** to close the gap (create / delete Pods, update objects)',
        ],
        after: [
          'Mental model: a thermostat — you set 22°C; it keeps nudging reality toward that number.',
        ],
        figure: {
          image: controllerLoopImg,
          imageAlt:
            'Hand-drawn sketch: desired state clipboard, controller, reconciles toward current Pods',
          caption: 'Declare what you want — the controller closes the gap.',
        },
        callout: {
          kind: 'idea',
          title: 'Not one magic process',
          body: [
            '“Controller” is a pattern. Many controllers run in the cluster (ReplicaSet controller, Deployment controller, Job controller, …). Each watches its own kinds of objects.',
          ],
        },
      },
      {
        id: 'labels-selectors',
        title: 'Labels and selectors',
        body: [
          'Controllers don’t attach to Pods by secret handshake. They use **labels** on Pods and a **selector** on the controller object.',
          'Example: the Pod template says `app: order-processor`. The ReplicaSet selector says: match Pods with `app: order-processor`. The controller counts and creates Pods that match that selector.',
          'If selector and template labels disagree, the ReplicaSet cannot manage the Pods correctly — a common beginner trap.',
        ],
        figure: {
          image: labelsSelectorsImg,
          imageAlt:
            'Hand-drawn sketch: ReplicaSet selector matching labeled Pods; unmatched Pod left outside',
          caption: 'The controller only owns Pods that match its selector.',
        },
      },
      {
        id: 'what-is-a-replicaset',
        title: 'What is a ReplicaSet?',
        body: [
          'A **ReplicaSet** is a controller object whose job is simple:',
        ],
        quote: 'Keep **N identical Pods** running from a **Pod template**.',
        after: [
          'You set `replicas` (how many), `selector` (which Pods count), and `template` (the Pod recipe — same ideas as a bare Pod: containers, image, ports, …).',
          'If a Pod dies, the ReplicaSet creates a replacement. If you scale `replicas` from 3 → 5, it creates two more.',
          'A ReplicaSet does **not** by itself do fancy rolling updates when you change the image. You typically replace the whole ReplicaSet or hand-edit carefully — which is why Deployments exist.',
        ],
        figure: {
          image: replicaSetImg,
          imageAlt: 'Hand-drawn sketch: ReplicaSet with replicas 3 pointing at three identical Pods',
          caption: 'One desired count. Matching Pods. Automatic replace on failure.',
        },
        tableAfter: {
          headers: ['Field', 'Role'],
          rows: [
            ['`spec.replicas`', 'Desired Pod count'],
            ['`spec.selector`', 'Label query for owned Pods'],
            [
              '`spec.template`',
              'Pod blueprint (metadata.labels must match selector)',
            ],
          ],
        },
      },
      {
        id: 'what-is-a-deployment',
        title: 'What is a Deployment?',
        body: [
          'A **Deployment** is a higher-level controller object for **stateless apps**. You still declare replicas + Pod template, but the Deployment’s job is broader:',
        ],
        bullets: [
          'Ensure the right number of Pods are up (by owning **ReplicaSet(s)** underneath)',
          '**Roll out** a new template (e.g. new image) gradually',
          'Keep history so you can **roll back**',
        ],
        after: [
          'Important relationship: you → **Deployment** → creates/manages **ReplicaSet(s)** → create/manage **Pods**.',
          'You almost always edit the **Deployment**; you rarely create a ReplicaSet by hand in production. Learning tracks often create a ReplicaSet once so you see the middle layer.',
        ],
        figure: {
          image: deploymentLayersImg,
          imageAlt:
            'Hand-drawn sketch: Deployment containing a ReplicaSet containing Pods',
          caption: 'Deployment manages ReplicaSets; ReplicaSets manage Pods.',
        },
        code: {
          language: 'text',
          code: 'Deployment  →  ReplicaSet(s)  →  Pods',
        },
      },
      {
        id: 'rs-vs-deployment',
        title: 'How Deployment differs from ReplicaSet — and why the abstraction appeared',
        body: [
          'A **ReplicaSet** answers one question well: keep **N** Pods that match **this exact template**. That is enough for **scale** and **self-heal** (replace a dead Pod). It is awkward for **change**.',
          'Suppose an app runs under a ReplicaSet on image `v1.0` with `replicas: 3`, and you need `v1.1`. With only a ReplicaSet you typically create a **new** ReplicaSet with the new template, or edit/replace the old one carefully.',
          'Either way **you** own the migration story: how many old Pods die at once, when new ones start, what to do if `v1.1` is bad, and how to go back to `v1.0`. The ReplicaSet API does not give you a first-class “roll forward / roll back this app” object — it only knows “N of *this* template.”',
          'So teams reinvented the same ops ritual: old RS down, new RS up, keep a trail of old ReplicaSets by hand.',
          'A **Deployment** answers a bigger question: keep **N** Pods for this app, and when the Pod template changes, **move** me from the old generation to the new one — and remember how to undo.',
        ],
        table: {
          headers: ['', 'ReplicaSet', 'Deployment'],
          rows: [
            [
              'Primary job',
              'Hold N copies of **one** template',
              'Hold N copies **and** manage **template changes**',
            ],
            [
              'What you usually edit',
              'The RS itself',
              'The Deployment (RS is underneath)',
            ],
            [
              'Scale / restart dead Pods',
              'Yes',
              'Yes (via its ReplicaSet)',
            ],
            [
              'Roll out a new image',
              'Manual / DIY across ReplicaSets',
              'Built-in (creates/scales ReplicaSets for you)',
            ],
            [
              'Roll back',
              'You recreate or point at an old RS yourself',
              'Deployment revision history',
            ],
            [
              'Mental layer',
              '“Pod factory for one recipe”',
              '“App release object” that owns factories',
            ],
          ],
        },
        after: [
          'Deployment did not replace the idea of a ReplicaSet. It **sat on top** of it so humans stop micromanaging ReplicaSets for every release.',
          'Historically (and in how people still learn): **Pods** run one unit → **replication** needs N units + replace failures → ReplicaSet → **releases** need to change the template without delete-all → **Deployment**.',
          'The gap ReplicaSet left was not “counting Pods.” It was **lifecycle of change**: progressive update, rollback, and a single object that means “this app’s desired version,” not “this one frozen template.”',
        ],
        figure: {
          image: whyDeploymentImg,
          imageAlt:
            'Hand-drawn sketch comparing juggling ReplicaSets by hand versus a Deployment owning old and new ReplicaSets',
          caption: 'Same Pod machinery. Deployment owns the change story.',
        },
        callout: {
          kind: 'idea',
          title: 'Rule of thumb',
          body: [
            'Use a **ReplicaSet** when you are learning “keep N alive.” Use a **Deployment** when the thing you care about is an **app that will be updated**. In real clusters, Deployments are the default for stateless services; bare ReplicaSets are the mechanism underneath.',
          ],
        },
      },
      {
        id: 'deployment-yaml',
        title: 'Deployment YAML: the schema you’ll see',
        body: [
          'Same ideas as a ReplicaSet’s `replicas` / `selector` / `template` — Deployment wraps that lifecycle:',
        ],
        code: {
          language: 'yaml',
          code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ...
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ...
  template:
    metadata:
      labels:
        app: ...          # must match selector
    spec:
      containers:
        - name: ...
          image: ...`,
        },
      },
    ],
    takeaways: [
      'A **controller** reconciles desired vs current state in a loop.',
      'A **ReplicaSet** keeps **N** Pods of **one** template (scale + self-heal).',
      'A **Deployment** sits above ReplicaSets so **template changes** (roll out / roll back) are first-class — that is why the abstraction exists.',
      '**Labels + selectors** define which Pods a controller owns.',
      'Day to day you declare a **Deployment**; ReplicaSets are usually the layer underneath.',
    ],
    relatedLabs: [
      {
        challengeId: 'k8s-02-scale-out-with-a-replicaset',
        label: 'Scale Out with a ReplicaSet',
      },
      {
        challengeId: 'k8s-03-roll-forward-with-a-deployment',
        label: 'Roll Forward with a Deployment',
      },
    ],
  },
];

export function getK8sReading(slug: string | null | undefined): K8sReading | null {
  if (!slug) return null;
  return K8S_READINGS.find((r) => r.slug === slug || r.id === slug) || null;
}

export function listK8sReadings(): K8sReading[] {
  return K8S_READINGS;
}

/** Readings inserted at the start of the Kubernetes track (before L1). */
const K8S_READINGS_BEFORE_LABS = ['containers-runtimes-pods'] as const;

/** Readings inserted immediately after a given challenge id. */
const K8S_READINGS_AFTER_CHALLENGE: Record<string, string[]> = {
  'l1-namespace-and-pod': ['controllers-replicasets-deployments'],
};

/** Ordered mixed roadmap for the DevOps Kubernetes panel: readings + challenges. */
export function listK8sTrackItems(): K8sTrackItem[] {
  const panel = PLAY_DOMAINS.find((d) => d.id === 'devops-engineer')?.panels.find(
    (p) => p.id === 'kubernetes',
  );
  const challengeIds = panel?.challengeIds ?? [];
  const items: K8sTrackItem[] = [];

  for (const readingId of K8S_READINGS_BEFORE_LABS) {
    items.push({
      type: 'reading',
      id: `reading:${readingId}`,
      readingId,
    });
  }

  for (const challengeId of challengeIds) {
    items.push({ type: 'challenge', id: `challenge:${challengeId}`, challengeId });
    for (const readingId of K8S_READINGS_AFTER_CHALLENGE[challengeId] ?? []) {
      items.push({
        type: 'reading',
        id: `reading:${readingId}`,
        readingId,
      });
    }
  }

  return items;
}
