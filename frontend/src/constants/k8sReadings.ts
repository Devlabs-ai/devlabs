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
import podIpProblemImg from '../assets/k8s-readings/services/pod-ip-problem.png';
import whatIsAServiceImg from '../assets/k8s-readings/services/what-is-a-service.png';
import selectorEndpointsImg from '../assets/k8s-readings/services/selector-endpoints.png';
import portTargetPortImg from '../assets/k8s-readings/services/port-targetport.png';
import serviceTypesImg from '../assets/k8s-readings/services/service-types.png';
import configVsImageImg from '../assets/k8s-readings/configmaps-secrets/config-vs-image.png';
import configMapVsSecretImg from '../assets/k8s-readings/configmaps-secrets/configmap-vs-secret.png';
import base64NotEncryptionImg from '../assets/k8s-readings/configmaps-secrets/base64-not-encryption.png';
import secretTypesImg from '../assets/k8s-readings/configmaps-secrets/secret-types.png';
import consumeConfigImg from '../assets/k8s-readings/configmaps-secrets/consume-config.png';
import multiContainerPodImg from '../assets/k8s-readings/multi-container-pods/multi-container-pod.png';
import initContainersImg from '../assets/k8s-readings/multi-container-pods/init-containers.png';
import sidecarEphemeralImg from '../assets/k8s-readings/multi-container-pods/sidecar-ephemeral.png';
import podNetworkingImg from '../assets/k8s-readings/networking/pod-networking.png';
import networkPolicyImg from '../assets/k8s-readings/networking/network-policy.png';
import requestsLimitsImg from '../assets/k8s-readings/resources-quotas/requests-limits.png';
import quotaLimitRangeImg from '../assets/k8s-readings/resources-quotas/quota-limitrange.png';
import threeProbesImg from '../assets/k8s-readings/probes/three-probes.png';
import securityContextLayersImg from '../assets/k8s-readings/security-context/security-context-layers.png';
import hardeningChecklistImg from '../assets/k8s-readings/security-context/hardening-checklist.png';
import serviceAccountImg from '../assets/k8s-readings/rbac-serviceaccounts/serviceaccount.png';
import roleRoleBindingImg from '../assets/k8s-readings/rbac-serviceaccounts/role-rolebinding.png';
import whatIsAVolumeImg from '../assets/k8s-readings/storage/what-is-a-volume.png';
import volumeKindsImg from '../assets/k8s-readings/storage/volume-kinds.png';
import pvVsPvcImg from '../assets/k8s-readings/storage/pv-vs-pvc.png';
import storageClassDynamicImg from '../assets/k8s-readings/storage/storageclass-dynamic.png';
import accessReclaimImg from '../assets/k8s-readings/storage/access-reclaim.png';
import devlabsBlogStampImg from '../assets/k8s-readings/devlabs-blog-stamp.png';

export const K8S_READINGS_BASE = `${K8S_LABS_PATH}/read`;

/** Shared stamp asset for readings that opt in via `showBlogStamp`. */
export const K8S_BLOG_STAMP_SRC = devlabsBlogStampImg;

export interface K8sReadingTable {
  headers: string[];
  rows: string[][];
}

export interface K8sReadingFigure {
  image: string;
  imageAlt: string;
  caption: string;
  /** Display smaller via CSS (keeps full-res asset — no re-encode). */
  compact?: boolean;
  /** No frame/padding so dark sketches blend into the notebook. */
  flush?: boolean;
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
  /** Optional top-right “The Devlabs Blog” stamp (trial on select readings). */
  showBlogStamp?: boolean;
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
    title: 'Containers, Runtimes, and Pods',
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
    title: 'ReplicaSets and Deployments',
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
  {
    id: 'services',
    slug: 'services',
    trackId: 'B3',
    eyebrow: '',
    title: 'Services, DNS, and Endpoints',
    lede:
      'Pods get new IPs when they restart. A Service gives your app a stable name and virtual IP so other Pods (and later, outside traffic) can dial without chasing addresses.',
    sections: [
      {
        id: 'pod-ips-change',
        title: 'Why Pod IPs are awkward',
        body: [
          'You already know how to run several copies of an app with a **Deployment**. Each Pod still gets its **own IP** on the cluster network.',
          'That IP is not a permanent address. When a Pod is replaced — crash, scale-down, rollout — the new Pod usually gets a **different** IP. Hard-coding `http://10.0.1.7:8080` in another workload breaks the moment the first Pod dies.',
          'Clients need a **stable front door**, not “whatever Pod IP exists this minute.”',
        ],
        figure: {
          image: podIpProblemImg,
          imageAlt:
            'Hand-drawn sketch: Pods with changing IPs and a client unsure which address to dial',
          caption: 'Replicas come and go. Their IPs are not a contract.',
        },
      },
      {
        id: 'what-is-a-service',
        title: 'What is a Service?',
        body: [
          'A **Service** is a Kubernetes object that exposes a set of Pods under one **stable name** and (usually) one **stable virtual IP**.',
          'Mental model: the Service is the **front door**. Matching Pods are the **rooms**. Callers dial the door; Kubernetes forwards traffic to a ready room.',
        ],
        quote: 'Dial a name (and ClusterIP) — not a Pod IP.',
        figure: {
          image: whatIsAServiceImg,
          imageAlt:
            'Hand-drawn sketch: client dials a Service which fans out to labeled Pods',
          caption: 'One name in. Many Pods behind it.',
        },
        after: [
          'Inside the cluster, other Pods typically reach the Service via **DNS**: `http://api:8080` (short name in the same namespace) or the longer `api.<namespace>.svc.cluster.local`.',
          'Kubernetes also assigns a **ClusterIP** — a virtual IP that exists for the life of the Service object (until you delete it). Clients can use DNS or that IP; DNS is what you usually teach first.',
        ],
        callout: {
          kind: 'idea',
          title: 'Service ≠ Deployment',
          body: [
            'A **Deployment** keeps Pods alive and updated. A **Service** makes those Pods **reachable** under a stable address. You often create both for the same app.',
          ],
        },
      },
      {
        id: 'selector-endpoints',
        title: 'Selectors and Endpoints',
        body: [
          'A Service does not list Pod names by hand. It uses a **selector** — the same label idea you saw on ReplicaSets and Deployments.',
          'Example: `selector: app: api`. Every ready Pod with that label becomes a backend for the Service.',
          'Kubernetes tracks those backends as **Endpoints** (or EndpointSlices in newer clusters): the live list of `PodIP:port` pairs the Service can send traffic to. When Pods appear or disappear, Endpoints update automatically.',
        ],
        figure: {
          image: selectorEndpointsImg,
          imageAlt:
            'Hand-drawn sketch: Service selector matching labeled Pods into an Endpoints list; unmatched Pod left out',
          caption: 'Selector picks Pods. Endpoints are the live address list.',
        },
        after: [
          'If Endpoints are empty, nothing is ready (or nothing matches the selector) — `kubectl get endpoints <svc>` is a good first check.',
        ],
        tableAfter: {
          headers: ['Piece', 'Role'],
          rows: [
            ['`spec.selector`', 'Which Pods belong behind this Service'],
            ['Endpoints', 'Ready Pod IPs + ports right now'],
            ['ClusterIP / DNS', 'Stable address clients dial'],
          ],
        },
      },
      {
        id: 'port-targetport',
        title: 'port vs targetPort',
        body: [
          'On a Service you usually set two port numbers:',
        ],
        bullets: [
          '**`port`** — what clients dial **on the Service** (e.g. `api:8080`)',
          '**`targetPort`** — the port **on the Pod / container** that should receive the traffic',
        ],
        figure: {
          image: portTargetPortImg,
          imageAlt:
            'Hand-drawn sketch: client to Service port then to Pod targetPort, with optional different numbers',
          caption: 'Service port is the front door number; targetPort is the room number.',
        },
        after: [
          'They are often the **same** number (e.g. both `8080`). They can differ — classic pattern: Service `port: 80`, container listens on `8080` via `targetPort: 8080`.',
          'The container’s `containerPort` in the Pod template documents what the app listens on; `targetPort` should match that listening port.',
        ],
      },
      {
        id: 'service-types',
        title: 'Service types (quick map)',
        body: [
          'The default type is **ClusterIP**: reachable **inside** the cluster only. That is what you use for service-to-service calls (for example a `web` Pod dialing an `api` Service).',
          'Other types open different doors for **outside** traffic. You do not need every type on day one — know the map so NodePort and LoadBalancer do not feel like different animals.',
        ],
        figure: {
          image: serviceTypesImg,
          imageAlt:
            'Hand-drawn three-panel sketch comparing ClusterIP, NodePort, and LoadBalancer',
          caption: 'Same Service idea. Different who can reach it.',
        },
        table: {
          headers: ['Type', 'Who can dial it', 'Typical use'],
          rows: [
            [
              '**ClusterIP** (default)',
              'Pods / processes inside the cluster',
              'App-to-app (stable DNS name)',
            ],
            [
              '**NodePort**',
              'Also via `NodeIP:nodePort` on each node',
              'Simple external access without a cloud LB',
            ],
            [
              '**LoadBalancer**',
              'External VIP from a cloud provider',
              'Production ingress to the Service',
            ],
          ],
        },
        callout: {
          kind: 'tip',
          title: 'Learn ClusterIP first',
          body: [
            'Most of the mental model — selector, Endpoints, `port` / `targetPort`, DNS — is identical for every type. ClusterIP teaches the core; NodePort and LoadBalancer mainly change **how traffic enters** the cluster.',
          ],
        },
      },
      {
        id: 'service-yaml',
        title: 'Service YAML: the schema you’ll see',
        body: [
          'A minimal ClusterIP Service looks like this:',
        ],
        code: {
          language: 'yaml',
          code: `apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  type: ClusterIP          # optional — this is the default
  selector:
    app: api               # must match Pod labels
  ports:
    - port: 8080           # dial api:8080
      targetPort: 8080     # container listens here`,
        },
        after: [
          'After apply: `kubectl get svc api` shows the ClusterIP; `kubectl get endpoints api` shows whether any Pods are ready behind it.',
        ],
      },
    ],
    takeaways: [
      'Pod IPs change; a **Service** gives a **stable name** (and ClusterIP) in front of matching Pods.',
      'A Service finds Pods with a **selector**; **Endpoints** are the live backend list.',
      '**`port`** is what clients dial on the Service; **`targetPort`** is the Pod/container port.',
      '**ClusterIP** is in-cluster only (default). **NodePort** / **LoadBalancer** open external paths on top of the same idea.',
      'Deployments keep Pods running; Services make them **reachable**.',
    ],
    relatedLabs: [
      {
        challengeId: 'k8s-04-stable-address-for-payment-handler',
        label: 'Stable Address for Payment Handler',
      },
      {
        challengeId: 'k8s-05-expose-order-processor-for-qa',
        label: 'Expose Order Processor for QA',
      },
    ],
  },
  {
    id: 'configmaps-secrets',
    slug: 'configmaps-secrets',
    trackId: 'B4',
    eyebrow: '',
    title: 'ConfigMaps and Secrets',
    lede:
      'Apps need settings and credentials that change without rebuilding images. ConfigMaps hold non-sensitive config; Secrets hold sensitive data — with types like Opaque, and a clear story for what is (and is not) encrypted.',
    sections: [
      {
        id: 'config-beside-the-app',
        title: 'Config beside the app — not inside the image',
        body: [
          'Your Deployment pins an **image** (the app binary + filesystem). Settings like `LOG_LEVEL`, feature flags, or connection limits change more often than the code.',
          'If those values are **baked into the image**, every tweak means a new build, a new tag, and a rollout — slow and noisy.',
          'Kubernetes’ answer: keep **config as cluster objects**, inject them into Pods at runtime. Change the object (or which object the Pod references), not the image, when only config changed.',
        ],
        figure: {
          image: configVsImageImg,
          imageAlt:
            'Hand-drawn sketch comparing config baked into an image versus a ConfigMap injected into a Pod',
          caption: 'Ship the app once. Swap settings without a rebuild.',
        },
      },
      {
        id: 'what-is-a-configmap',
        title: 'What is a ConfigMap?',
        body: [
          'A **ConfigMap** is a namespaced object that stores **non-sensitive** configuration as key/value pairs (or small config files).',
          'Typical contents: log levels, timeouts, public URLs, feature toggles, non-secret limits.',
        ],
        code: {
          language: 'yaml',
          code: `apiVersion: v1
kind: ConfigMap
metadata:
  name: api-config
data:
  LOG_LEVEL: "INFO"
  MAX_CONNECTIONS: "100"
  FEATURE_FLAGS: "search,recommendations"`,
        },
        after: [
          'Keys under `data` are plain UTF-8 strings. Use `binaryData` (base64) only when you must store non-text bytes — uncommon for app env config.',
        ],
        callout: {
          kind: 'tip',
          title: 'Not for passwords',
          body: [
            'If a value would hurt you if it leaked in logs, git, or a screenshot — it does **not** belong in a ConfigMap. That is what Secrets are for.',
          ],
        },
      },
      {
        id: 'what-is-a-secret',
        title: 'What is a Secret?',
        body: [
          'A **Secret** is a namespaced object for **sensitive** data: API tokens, passwords, TLS private keys, registry credentials.',
          'Same key/value idea as a ConfigMap, but a different kind — so RBAC, tooling, and humans can treat it more carefully (who can `get` it, whether it shows up in plain `kubectl describe`, and so on).',
        ],
        figure: {
          image: configMapVsSecretImg,
          imageAlt:
            'Hand-drawn sketch comparing ConfigMap non-sensitive settings to Secret credentials',
          caption: 'Same injection pattern. Different sensitivity contract.',
        },
        after: [
          'You still wire Secrets into Pods the same ways as ConfigMaps (env or volume). The split is about **what the data is**, not a totally different delivery mechanism.',
        ],
      },
      {
        id: 'encoding-vs-encryption',
        title: 'How Secrets are stored — encoding vs encryption',
        body: [
          'When you put values under `data:` in a Secret YAML, Kubernetes expects **base64-encoded** bytes. That is **encoding**, not encryption.',
          'Base64 turns binary/text into a printable string so YAML can carry it. Anyone with the string can decode it instantly (`echo czNjcjN0LXRva2Vu | base64 -d`). It does **not** hide the secret from someone who can read the Secret object.',
        ],
        figure: {
          image: base64NotEncryptionImg,
          imageAlt:
            'Hand-drawn sketch: plaintext base64-encoded then easily decoded; etcd note about optional encryption at rest',
          caption: 'Base64 is packaging. Encryption is a separate control.',
        },
        after: [
          '**Default cluster behavior:** Secret objects live in **etcd** like other API objects. Without extra setup, the bytes in etcd are **not** encrypted at rest — only encoded as stored in the API. Anyone who can read etcd or `kubectl get secret -o yaml` can recover the plaintext.',
          '**Encryption at rest (optional):** Cluster admins can enable the API server’s **EncryptionConfiguration** so Secret (and other) resources are encrypted when written to etcd (e.g. AES-CBC / AES-GCM, or a KMS provider). That protects disk/backups of etcd — it does **not** mean every `kubectl get` is blind; authorized API users still receive decrypted data.',
          '**In transit:** Clients talk to the API server over **TLS**. That protects Secrets on the wire to the API — separate from at-rest encryption.',
          '**On the node:** When a Pod mounts a Secret, kubelet materializes it for the container (tmpfs volume or env). Treat node access and RBAC as part of the threat model.',
        ],
        tableAfter: {
          headers: ['Layer', 'What it does'],
          rows: [
            ['Base64 in `data:`', 'Encode for YAML — **not** confidentiality'],
            ['TLS to API server', 'Protect Secrets **in transit**'],
            [
              'EncryptionConfiguration / KMS',
              'Optional: encrypt Secrets **at rest** in etcd',
            ],
            [
              'RBAC + least privilege',
              'Limit who can `get`/`watch` Secrets',
            ],
          ],
        },
        callout: {
          kind: 'warn',
          title: 'stringData shortcut',
          body: [
            'You can write plaintext under `stringData:` in YAML; the API converts it to base64 `data` on save. Convenient for apply — still not encryption. Never commit real production secrets to git.',
          ],
        },
      },
      {
        id: 'secret-types',
        title: 'Secret types: Opaque and the built-in ones',
        body: [
          'Every Secret has a **`type`** field. The type does not encrypt anything by itself — it tells Kubernetes (and humans) **what shape of keys** to expect, and lets controllers/kubelet apply conventions.',
        ],
        figure: {
          image: secretTypesImg,
          imageAlt:
            'Hand-drawn four-panel sketch of Opaque, TLS, dockerconfigjson, and basic-auth Secret types',
          caption: 'Type = convention. Data is still key/value.',
        },
        table: {
          headers: ['Type', 'Meant for', 'Typical keys'],
          rows: [
            [
              '**Opaque** (default)',
              'Generic user secrets — API tokens, passwords, keys',
              'Whatever you choose (`DB_PASSWORD`, `API_TOKEN`, …)',
            ],
            [
              '**kubernetes.io/tls**',
              'TLS cert + private key for HTTPS / Ingress',
              '`tls.crt`, `tls.key`',
            ],
            [
              '**kubernetes.io/dockerconfigjson**',
              'Pull images from a private registry',
              '`.dockerconfigjson`',
            ],
            [
              '**kubernetes.io/basic-auth**',
              'Username / password pairs',
              '`username`, `password`',
            ],
            [
              '**kubernetes.io/ssh-auth**',
              'SSH private keys',
              '`ssh-privatekey`',
            ],
            [
              '**kubernetes.io/service-account-token**',
              'Tokens for ServiceAccounts (often auto-managed)',
              'token / ca.crt / namespace (legacy pattern)',
            ],
          ],
        },
        after: [
          'Most app credentials you create yourself use **`type: Opaque`** — a bag of keys you define. Prefer a typed Secret when you are feeding something that already expects that type (Ingress TLS, `imagePullSecrets`, etc.).',
          'You can invent custom type strings; built-in types are the ones kubelet and common controllers already understand.',
        ],
        code: {
          language: 'yaml',
          code: `apiVersion: v1
kind: Secret
metadata:
  name: api-secrets
type: Opaque
data:
  # echo -n 's3cr3t-token' | base64
  API_TOKEN: czNjcjN0LXRva2Vu`,
        },
      },
      {
        id: 'how-pods-consume',
        title: 'How Pods consume ConfigMaps and Secrets',
        body: [
          'Two common delivery paths — same objects, different shape inside the container:',
        ],
        bullets: [
          '**Environment variables** — `envFrom` (all keys) or `env[].valueFrom.configMapKeyRef` / `secretKeyRef` (one key)',
          '**Files on a volume** — mount the object; each key becomes a file (good for certs, large config, or apps that read files)',
        ],
        figure: {
          image: consumeConfigImg,
          imageAlt:
            'Hand-drawn sketch: ConfigMap and Secret injected into a Pod as env vars or mounted files',
          caption: 'Env for simple keys. Volumes when you need files.',
        },
        after: [
          'Beginners usually start with `envFrom` / `secretKeyRef`. Volume mounts matter when the app expects files (certs, config files on disk).',
        ],
        code: {
          language: 'yaml',
          code: `envFrom:
  - configMapRef:
      name: api-config
env:
  - name: API_TOKEN
    valueFrom:
      secretKeyRef:
        name: api-secrets
        key: API_TOKEN`,
        },
      },
    ],
    takeaways: [
      'Keep **settings beside** the app (ConfigMap / Secret) so you do not rebuild images for every config change.',
      '**ConfigMap** = non-sensitive config; **Secret** = credentials and other sensitive material.',
      'Secret `data` is **base64-encoded**, not encrypted. **Encryption at rest** in etcd is optional admin setup; TLS protects the API **in transit**.',
      '**Opaque** is the generic Secret type; other types (`kubernetes.io/tls`, `dockerconfigjson`, …) are conventions for known key shapes.',
      'Pods consume either object as **env** or as **mounted files**.',
    ],
    relatedLabs: [
      {
        challengeId: 'k8s-06-config-without-rebuilding-images',
        label: 'Config Without Rebuilding Images',
      },
      {
        challengeId: 'k8s-07-keep-credentials-in-a-secret',
        label: 'Keep Credentials in a Secret',
      },
    ],
  },
  {
    id: 'multi-container-pods',
    slug: 'multi-container-pods',
    trackId: 'B5',
    eyebrow: '',
    title: 'Multi-Container Pods',
    lede:
      'A Pod can run more than one container: helpers beside the app, setup jobs that finish first, and temporary debug containers. They share the Pod’s network — and often volumes.',
    sections: [
      {
        id: 'why-multi',
        title: 'Why more than one container in a Pod?',
        body: [
          'The smallest deployable unit is still a **Pod**. Often one container is enough. Sometimes you want a **helper** that must live next to the app: ship logs, proxy traffic, or warm a cache.',
          'Containers in the **same Pod** share a network namespace (one Pod IP; they can talk on `localhost`) and can mount the **same volumes**. That is the point of co-locating them — not “two unrelated apps glued together.”',
        ],
        figure: {
          image: multiContainerPodImg,
          imageAlt:
            'Hand-drawn sketch of a Pod with an app container, log-shipper sidecar, shared volume, and one Pod IP',
          caption: 'One IP. Shared volumes when you need them. Separate processes.',
        },
        callout: {
          kind: 'idea',
          title: 'Rule of thumb',
          body: [
            'Same Pod when processes must share fate, localhost, or a disk. Separate Deployments + a Service when they scale or fail independently.',
          ],
        },
      },
      {
        id: 'app-containers',
        title: 'App containers (the long-running ones)',
        body: [
          'Under `spec.containers` you list the containers that should stay up with the Pod. The main app is usually here. Extra long-running helpers in the same list are the classic **sidecar** pattern (log shipper, envoy, etc.).',
          'If any of these containers exits in a way that fails the Pod’s restart policy, the kubelet restarts according to that policy — they are meant to keep running.',
        ],
      },
      {
        id: 'init-containers',
        title: 'Init containers',
        body: [
          '**Init containers** run **before** the app containers. They run **one after another**, in order. Each must **exit successfully (0)** before the next starts. Only when all inits succeed do the regular containers start.',
          'Typical jobs: wait for a dependency, run a schema migration, fetch a config blob, set permissions on a volume.',
        ],
        figure: {
          image: initContainersImg,
          imageAlt:
            'Hand-drawn timeline: init containers run to completion in sequence, then app containers start',
          caption: 'Setup first. App second. Init failure blocks the Pod from becoming Ready.',
        },
        after: [
          'If an init container keeps failing, the Pod stays stuck in init — the app never starts. That is intentional: do not serve traffic before setup is done.',
        ],
        code: {
          language: 'yaml',
          code: `spec:
  initContainers:
    - name: migrate
      image: migrate:1.2
      command: ["migrate", "up"]
  containers:
    - name: api
      image: api:1.2`,
        },
      },
      {
        id: 'sidecars',
        title: 'Sidecars (helpers beside the app)',
        body: [
          'A **sidecar** is a container whose job is to assist the main app — not to be the product itself.',
          '**Classic pattern:** list the helper under `spec.containers` next to the app. They start together and share volumes/network for the Pod’s life.',
          '**Native sidecars** (newer Kubernetes): you can declare a sidecar as a special init container with `restartPolicy: Always` so it starts early and keeps running beside the app. Same idea — helper co-located with the workload — with clearer lifecycle semantics on modern clusters.',
        ],
        table: {
          headers: ['Pattern', 'Where it lives', 'Lifecycle'],
          rows: [
            [
              'Classic sidecar',
              '`spec.containers`',
              'Starts with app containers; runs for Pod lifetime',
            ],
            [
              'Native sidecar',
              '`initContainers` + `restartPolicy: Always`',
              'Starts before app; kept running as a helper',
            ],
            [
              'Init (setup)',
              '`initContainers` (default)',
              'Runs to completion, then exits',
            ],
          ],
        },
      },
      {
        id: 'ephemeral-debug',
        title: 'Ephemeral containers (debug)',
        body: [
          '**Ephemeral containers** are temporary containers you attach to an **already running** Pod for debugging — for example with `kubectl debug`.',
          'They are **not** part of your normal Deployment template. You do not declare them for production traffic. They exist so you can get a shell or tooling into a Pod that shipped without a shell, or inspect a broken shared namespace.',
        ],
        figure: {
          image: sidecarEphemeralImg,
          imageAlt:
            'Hand-drawn sketch comparing a long-running sidecar to a temporary ephemeral debugger container',
          caption: 'Sidecar = designed helper. Ephemeral = temporary debug attach.',
        },
        after: [
          'Other “secondary” ideas you may hear: **adapter** / **ambassador** patterns are just sidecar *roles* (transform data, or proxy outbound calls) — still ordinary containers in the Pod, not separate API kinds.',
        ],
        callout: {
          kind: 'tip',
          title: 'What is not a second app container',
          body: [
            'The node also runs infrastructure (kubelet, and historically a pause container holding the network namespace). You do not manage those in your Pod YAML. You manage **init**, **app/sidecar**, and occasionally **ephemeral** debug containers.',
          ],
        },
      },
    ],
    takeaways: [
      'Containers in one Pod share **network** (and can share **volumes**); use that for tightly coupled helpers.',
      '**Init containers** run first, in order, to completion — then app containers start.',
      '**Sidecars** are long-running helpers (classic `containers` or native sidecar init with `restartPolicy: Always`).',
      '**Ephemeral containers** are temporary debug attach points — not your steady-state template.',
      'Unrelated apps that scale apart belong in **separate Pods**, not stuffed into one.',
    ],
    relatedLabs: [
      {
        challengeId: 'k8s-08-audit-trail-with-a-sidecar',
        label: 'Audit Trail with a Sidecar',
      },
      {
        challengeId: 'k8s-09-migrate-schema-before-the-app-starts',
        label: 'Migrate Schema Before the App Starts',
      },
    ],
  },
  {
    id: 'pod-networking-and-policies',
    slug: 'pod-networking-and-policies',
    trackId: 'B6',
    eyebrow: '',
    title: 'Pod Networking and NetworkPolicies',
    lede:
      'Every Pod gets an IP on a flat cluster network. Services give stable names on top. NetworkPolicies act as a firewall so only the Pods you allow can talk.',
    sections: [
      {
        id: 'pod-ip-fabric',
        title: 'The cluster network model',
        body: [
          'In Kubernetes’ usual model, **every Pod gets its own IP**, reachable from other Pods without NAT between them. A **CNI** plugin (Container Network Interface) implements that fabric on the nodes.',
          'You rarely configure CNI by hand in app YAML — but you rely on it: Pod A can dial Pod B’s IP (and, more usefully, dial a **Service** DNS name in front of B).',
        ],
        figure: {
          image: podNetworkingImg,
          imageAlt:
            'Hand-drawn sketch of Pods with IPs on a flat network with CNI and a Service in front',
          caption: 'Pod IPs are real on the cluster network. Services sit in front for stability.',
        },
        after: [
          'Containers in the **same** Pod share one network namespace — `localhost` works between them. Containers in **different** Pods use Pod IPs or Services.',
        ],
      },
      {
        id: 'dns-and-services',
        title: 'DNS and Services (quick recap)',
        body: [
          'Pod IPs change. A **Service** gives a stable **DNS name** and **ClusterIP** in front of matching Pods (see the Services reading).',
          'In-cluster clients typically dial `http://api:8080` rather than a Pod IP. That is everyday “Kubernetes networking” for applications.',
        ],
      },
      {
        id: 'network-policies',
        title: 'NetworkPolicy: a firewall for Pods',
        body: [
          'By default, many clusters allow **all Pod-to-Pod traffic**. A **NetworkPolicy** lets you restrict who can connect to (or from) selected Pods.',
          'A policy **selects** Pods with labels, then lists allowed **ingress** (who may connect in) and/or **egress** (where those Pods may connect out), often by podSelector, namespaceSelector, and port.',
        ],
        figure: {
          image: networkPolicyImg,
          imageAlt:
            'Hand-drawn sketch: NetworkPolicy allowing web to api and blocking batch',
          caption: 'Once a policy selects a Pod, only the allowed paths should work (for that policy type).',
        },
        after: [
          'Important nuance: NetworkPolicy behavior depends on the CNI supporting it. The object is namespaced; it only affects Pods it selects in that namespace.',
          'A common beginner pattern: select the server Pods, `policyTypes: [Ingress]`, allow only from clients with a given label on a given port.',
        ],
        code: {
          language: 'yaml',
          code: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-allow-web
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: web
      ports:
        - protocol: TCP
          port: 8080`,
        },
        callout: {
          kind: 'warn',
          title: 'Allow-lists, not magic deny-all alone',
          body: [
            'Think in allow rules for selected Pods. If nothing selects a Pod, policies usually do not change its traffic. When a Pod is selected for ingress, traffic not matching an allow rule is denied (for supporting CNIs).',
          ],
        },
      },
    ],
    takeaways: [
      'Pods get IPs on a **flat cluster network** implemented by a **CNI**.',
      'Prefer **Service DNS** over raw Pod IPs for app-to-app calls.',
      '**NetworkPolicy** restricts who may talk to (or from) labeled Pods — a Pod-level firewall.',
      'Policies need a CNI that enforces them; always verify with real connect tests.',
    ],
    relatedLabs: [
      {
        challengeId: 'k8s-10-firewall-rules-between-order-and-payment',
        label: 'Firewall Rules Between Order and Payment',
      },
    ],
  },
  {
    id: 'requests-limits-quotas',
    slug: 'requests-limits-quotas',
    trackId: 'B7',
    eyebrow: '',
    title: 'Requests, Limits, and Quotas',
    lede:
      'CPU and memory are shared. Requests reserve capacity for scheduling; limits cap usage. Quotas and LimitRanges keep a namespace from eating the cluster.',
    sections: [
      {
        id: 'requests-vs-limits',
        title: 'Requests vs limits',
        body: [
          'On each container you can set **resources.requests** and **resources.limits** for CPU and memory.',
          '**Request** — what the scheduler **reserves** when placing the Pod. “I need at least this much to run well.”',
          '**Limit** — the **ceiling**. The container is not allowed to use more than this (CPU throttling; memory may OOM-kill if exceeded).',
        ],
        figure: {
          image: requestsLimitsImg,
          imageAlt:
            'Hand-drawn sketch of request as reservation and limit as ceiling for CPU and memory',
          caption: 'Request for scheduling. Limit as a hard cap.',
        },
        table: {
          headers: ['', 'CPU', 'Memory'],
          rows: [
            [
              'Units you will see',
              '`100m` = 0.1 core; `1` = one core',
              '`128Mi`, `1Gi` (binary units)',
            ],
            [
              'Over request',
              'May use more if the node is idle (until limit)',
              'Same idea until limit',
            ],
            [
              'Over limit',
              'Throttled',
              'Often killed (OOM)',
            ],
          ],
        },
        code: {
          language: 'yaml',
          code: `resources:
  requests:
    cpu: "100m"
    memory: "128Mi"
  limits:
    cpu: "500m"
    memory: "256Mi"`,
        },
      },
      {
        id: 'qos',
        title: 'QoS classes (how the kubelet prioritizes)',
        body: [
          'From requests/limits, Kubernetes assigns a **Quality of Service** class to the Pod:',
        ],
        bullets: [
          '**Guaranteed** — every container has request == limit for CPU and memory',
          '**Burstable** — at least one request set, but not Guaranteed',
          '**BestEffort** — no requests or limits',
        ],
        after: [
          'Under node memory pressure, BestEffort Pods are evicted first; Guaranteed last. Setting thoughtful requests is not only fairness — it affects who survives pressure.',
        ],
      },
      {
        id: 'quota-limitrange',
        title: 'ResourceQuota and LimitRange',
        body: [
          '**ResourceQuota** — a **namespace budget**. Caps totals (e.g. sum of CPU requests, object counts). New Pods that would break the budget are rejected.',
          '**LimitRange** — **per-object guardrails** in a namespace: default request/limit if omitted, or min/max allowed per container/Pod.',
        ],
        figure: {
          image: quotaLimitRangeImg,
          imageAlt:
            'Hand-drawn sketch of ResourceQuota as namespace budget and LimitRange as per-object defaults and caps',
          caption: 'Quota = how much the namespace may use. LimitRange = defaults and bounds per Pod.',
        },
        callout: {
          kind: 'tip',
          title: 'Why Pods suddenly fail to schedule',
          body: [
            '“Insufficient cpu” can mean the **node** is full — or the **namespace quota** is exhausted. Check both `kubectl describe pod` events and `kubectl describe quota`.',
          ],
        },
      },
    ],
    takeaways: [
      '**Request** = reservation for scheduling; **limit** = usage ceiling.',
      'CPU over limit → throttle; memory over limit → risk of **OOMKill**.',
      'Requests/limits drive **QoS** (Guaranteed / Burstable / BestEffort) and eviction order.',
      '**ResourceQuota** budgets a namespace; **LimitRange** sets defaults and min/max per Pod.',
    ],
    relatedLabs: [
      {
        challengeId: 'k8s-11-cap-order-processor-cpu-and-memory',
        label: 'Cap Order Processor CPU and Memory',
      },
    ],
  },
  {
    id: 'probes-liveness-readiness-startup',
    slug: 'probes-liveness-readiness-startup',
    trackId: 'B8',
    eyebrow: '',
    title: 'Probes: Startup, Readiness, and Liveness',
    lede:
      'Probes are health checks the kubelet runs against your containers. Startup covers slow boots; readiness controls traffic; liveness decides when to restart.',
    sections: [
      {
        id: 'three-probes',
        title: 'Three probes, three jobs',
        body: [
          'Kubernetes does not magically know your app is healthy. You configure **probes** — periodic checks — so the kubelet can act.',
        ],
        figure: {
          image: threeProbesImg,
          imageAlt:
            'Hand-drawn three-column sketch of startup, readiness, and liveness probes',
          caption: 'Boot gate, traffic gate, restart gate.',
        },
        table: {
          headers: ['Probe', 'Question', 'If it fails'],
          rows: [
            [
              '**Startup**',
              'Has the container finished starting?',
              'Restart (after failure threshold); other probes wait until startup succeeds',
            ],
            [
              '**Readiness**',
              'Should this Pod receive traffic?',
              'Removed from Service Endpoints (Pod may keep running)',
            ],
            [
              '**Liveness**',
              'Is the process still healthy?',
              'Container restarted',
            ],
          ],
        },
      },
      {
        id: 'startup',
        title: 'Startup probe',
        body: [
          'Use a **startup probe** for apps that are **slow to boot** (JVM warmup, large migrations already done, cache fill).',
          'While startup is not successful yet, **liveness and readiness do not run**. That stops a slow boot from being killed by an impatient liveness probe.',
        ],
      },
      {
        id: 'readiness',
        title: 'Readiness probe',
        body: [
          '**Readiness** controls whether the Pod is added to **Service Endpoints**. Fail readiness → no new traffic; the process can still be alive.',
          'Good for: dependencies temporarily down, warming up, draining before shutdown. Bad for: “restart me” — that is liveness.',
        ],
      },
      {
        id: 'liveness',
        title: 'Liveness probe',
        body: [
          '**Liveness** means “this container is wedged — restart it.” Fail enough times → kubelet restarts the container.',
          'Keep liveness **cheap and true**. A check that fails because a downstream DB is slow can restart healthy app containers in a loop — prefer readiness for dependency health when the app process itself is fine.',
        ],
        callout: {
          kind: 'warn',
          title: 'Common mistake',
          body: [
            'Do not point liveness at an external dependency unless a failure really means “kill and restart me.” Prefer readiness for “I cannot serve traffic right now.”',
          ],
        },
      },
      {
        id: 'probe-mechanisms',
        title: 'How probes check',
        body: [
          'Common mechanisms:',
        ],
        bullets: [
          '**httpGet** — HTTP status from a path (2xx/3xx usually success)',
          '**tcpSocket** — can we open a TCP port?',
          '**exec** — run a command in the container; exit 0 = success',
          '**grpc** — gRPC health check (when supported)',
        ],
        after: [
          'Tune `initialDelaySeconds`, `periodSeconds`, `timeoutSeconds`, `failureThreshold`, and `successThreshold` so checks match real startup and latency — not wishful thinking.',
        ],
        code: {
          language: 'yaml',
          code: `readinessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
livenessProbe:
  httpGet:
    path: /livez
    port: 8080
  periodSeconds: 15
startupProbe:
  httpGet:
    path: /startupz
    port: 8080
  failureThreshold: 30
  periodSeconds: 5`,
        },
      },
    ],
    takeaways: [
      '**Startup** = finished booting (protects slow starts from liveness).',
      '**Readiness** = in or out of **Service traffic**.',
      '**Liveness** = restart a stuck container.',
      'Use httpGet / tcpSocket / exec / grpc; tune thresholds to real behavior.',
      'Do not use liveness as a blunt substitute for readiness.',
    ],
    relatedLabs: [
      {
        challengeId: 'k8s-12-restart-dead-order-processor-pods',
        label: 'Restart Dead Order Processor Pods',
      },
      {
        challengeId: 'k8s-13-keep-broken-pods-out-of-the-service',
        label: 'Keep Broken Pods Out of the Service',
      },
      {
        challengeId: 'k8s-14-give-slow-starters-time-to-boot',
        label: 'Give Slow Starters Time to Boot',
      },
    ],
  },
  {
    id: 'security-context',
    slug: 'security-context',
    trackId: 'B9',
    eyebrow: '',
    title: 'SecurityContext',
    lede:
      'A SecurityContext controls how a process runs inside a Pod or container: which user, whether the filesystem is writable, and which Linux capabilities it keeps.',
    sections: [
      {
        id: 'what-is-security-context',
        title: 'What SecurityContext controls',
        body: [
          'By default, many container images historically ran as **root** inside the container. That is convenient for packaging — and risky if the process is compromised.',
          'A **SecurityContext** is the YAML you attach to a **Pod** and/or **container** to set process identity and privilege boundaries: UID/GID, non-root, capabilities, read-only root filesystem, privilege escalation, and related settings.',
        ],
        figure: {
          image: securityContextLayersImg,
          imageAlt:
            'Hand-drawn sketch of Pod-level and container-level SecurityContext settings',
          caption: 'Pod-level defaults (e.g. fsGroup). Container-level process rules.',
        },
        after: [
          '**Pod `securityContext`** — settings that apply to the Pod as a whole (common examples: `runAsUser`, `runAsGroup`, `fsGroup` for volume group ownership).',
          '**Container `securityContext`** — settings for that container’s process (capabilities, `readOnlyRootFilesystem`, `allowPrivilegeEscalation`, `runAsNonRoot`, …).',
          'When both are set, container fields override or refine for that container — check the docs for each field’s merge rules if you combine them.',
        ],
      },
      {
        id: 'hardening-fields',
        title: 'Common hardening fields',
        body: [
          'A practical hardening set you will see often:',
        ],
        figure: {
          image: hardeningChecklistImg,
          imageAlt:
            'Hand-drawn checklist: non-root, read-only rootfs, drop capabilities, no privilege escalation',
          caption: 'Least privilege for the process in the container.',
        },
        table: {
          headers: ['Field', 'Intent'],
          rows: [
            [
              '`runAsNonRoot: true`',
              'Refuse to start if the process would be root',
            ],
            [
              '`runAsUser` / `runAsGroup`',
              'Run as a specific numeric UID/GID',
            ],
            [
              '`readOnlyRootFilesystem: true`',
              'Root filesystem is read-only; mount emptyDir (e.g. `/tmp`) if the app needs to write',
            ],
            [
              '`allowPrivilegeEscalation: false`',
              'Block gaining extra privileges (e.g. setuid surprises)',
            ],
            [
              '`capabilities.drop: [ALL]`',
              'Drop Linux capabilities; add back only what you truly need',
            ],
            [
              '`fsGroup` (Pod)',
              'Volumes owned so the process group can read/write shared mounts',
            ],
          ],
        },
        callout: {
          kind: 'tip',
          title: 'Writable paths',
          body: [
            'Read-only root is great until the app needs `/tmp` or a cache dir. Mount an **emptyDir** (or other volume) at those paths instead of opening the whole root filesystem.',
          ],
        },
      },
      {
        id: 'security-context-yaml',
        title: 'YAML shape',
        body: [
          'A hardened container often looks like this:',
        ],
        code: {
          language: 'yaml',
          code: `spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    fsGroup: 1000
  containers:
    - name: api
      image: api:1.2
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
      volumeMounts:
        - name: tmp
          mountPath: /tmp
  volumes:
    - name: tmp
      emptyDir: {}`,
        },
        after: [
          'Related (broader) topics you may meet later: **Pod Security Standards** / admission policies that require these settings cluster-wide, and **seccomp** / **AppArmor** profiles. SecurityContext is the per-Pod/container starting point.',
        ],
      },
    ],
    takeaways: [
      '**SecurityContext** sets how the process runs (user, capabilities, filesystem, escalation).',
      'Use **Pod-level** and **container-level** contexts together for defaults + per-container rules.',
      'Common hardening: **non-root**, **read-only root**, **drop ALL capabilities**, **no privilege escalation**.',
      'Give writable **volumes** for paths the app must write — do not relax the whole rootfs casually.',
    ],
    relatedLabs: [
      {
        challengeId: 'k8s-15-lock-down-payment-handler-process',
        label: 'Lock Down Payment Handler Process',
      },
    ],
  },
  {
    id: 'serviceaccounts-rbac',
    slug: 'serviceaccounts-rbac',
    trackId: 'B10',
    eyebrow: '',
    title: 'ServiceAccounts, Roles, and RoleBindings',
    lede:
      'Pods that talk to the Kubernetes API need an identity and permissions. ServiceAccounts are the identity; Roles name the powers; RoleBindings connect the two.',
    sections: [
      {
        id: 'serviceaccount',
        title: 'ServiceAccount: who the Pod is',
        body: [
          'A **ServiceAccount** is a namespaced identity for processes in Pods (not a human user). When a Pod calls the API server — list Pods, create a Job, read a Secret — it authenticates as its ServiceAccount.',
          'Set `spec.serviceAccountName` on the Pod (or Pod template). If you omit it, the Pod uses the namespace’s **`default`** ServiceAccount — fine for demos, often too broad or too unclear for real automation.',
        ],
        figure: {
          image: serviceAccountImg,
          imageAlt:
            'Hand-drawn sketch of a Pod using a ServiceAccount to call the API server',
          caption: 'ServiceAccount = API identity for the Pod.',
        },
        after: [
          'Modern clusters mount a short-lived token for the ServiceAccount (projected volume). Older clusters mounted a long-lived secret token — same idea: credentials for the API as that SA.',
        ],
        callout: {
          kind: 'idea',
          title: 'Identity ≠ permissions',
          body: [
            'Creating a ServiceAccount alone does **not** grant API powers. RBAC bindings do. An SA with no RoleBinding usually cannot do much beyond what the API allows unauthenticated/anonymous (typically nothing useful).',
          ],
        },
      },
      {
        id: 'role',
        title: 'Role: what is allowed (in a namespace)',
        body: [
          'A **Role** lists **rules**: which API groups, resources, and verbs are allowed — scoped to **one namespace**.',
          'Example rule: in this namespace, `get` and `list` on `pods` (core API group `""`).',
        ],
        code: {
          language: 'yaml',
          code: `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]`,
        },
        after: [
          '**ClusterRole** is the same idea but **cluster-wide** (or usable across namespaces via binding). Use Roles for namespace-local least privilege; ClusterRoles when the power must span the cluster (nodes, all namespaces, etc.).',
        ],
      },
      {
        id: 'rolebinding',
        title: 'RoleBinding: connect identity to a Role',
        body: [
          'A **RoleBinding** says: these **subjects** (ServiceAccounts, users, or groups) get the permissions of this **Role** in this namespace.',
          'Without a binding, the Role is just a document. Without a Role, the binding has nothing useful to grant.',
        ],
        figure: {
          image: roleRoleBindingImg,
          imageAlt:
            'Hand-drawn sketch of ServiceAccount bound to a Role via RoleBinding inside a namespace',
          caption: 'Binding links who → what they may do.',
        },
        code: {
          language: 'yaml',
          code: `apiVersion: v1
kind: ServiceAccount
metadata:
  name: exporter
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: exporter-pod-reader
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: pod-reader
subjects:
  - kind: ServiceAccount
    name: exporter`,
        },
        tableAfter: {
          headers: ['Object', 'Job'],
          rows: [
            ['ServiceAccount', 'Identity for Pods'],
            ['Role / ClusterRole', 'Permission rules'],
            ['RoleBinding / ClusterRoleBinding', 'Attach rules to subjects'],
          ],
        },
      },
      {
        id: 'least-privilege',
        title: 'Least privilege in practice',
        body: [
          'Give each automation its **own** ServiceAccount and the **smallest** verb/resource set it needs.',
          'Prefer namespaced **Role** + **RoleBinding** when possible. Reach for ClusterRole only when the task truly needs cluster scope.',
          'Do not reuse `default` for privileged jobs — it makes audits and incidents harder.',
        ],
        callout: {
          kind: 'tip',
          title: 'Debug tip',
          body: [
            '`kubectl auth can-i list pods --as=system:serviceaccount:<ns>:<sa>` checks whether that SA is allowed a verb — useful when a controller or Job gets Forbidden.',
          ],
        },
      },
    ],
    takeaways: [
      '**ServiceAccount** = Pod’s identity at the API.',
      '**Role** (or ClusterRole) = permission rules (resources + verbs).',
      '**RoleBinding** (or ClusterRoleBinding) = attaches a Role to subjects.',
      'Identity alone is not access — you need the binding.',
      'Prefer dedicated SAs and **least privilege** over the namespace `default` SA.',
    ],
    relatedLabs: [
      {
        challengeId: 'k8s-16-identity-for-settlement-export',
        label: 'Identity for Settlement Export',
      },
    ],
  },
  {
    id: 'volumes-pvs-pvcs-storageclasses',
    slug: 'volumes-pvs-pvcs-storageclasses',
    trackId: 'B11',
    eyebrow: '',
    title: 'Volumes, PVs, PVCs, and StorageClasses',
    showBlogStamp: true,
    lede:
      'Containers are ephemeral. When a Pod dies, its writable layer is gone. Volumes attach storage to a Pod — from scratch pads to durable disks claimed via PVCs, backed by PVs or created dynamically through StorageClasses.',
    sections: [
      {
        id: 'why-storage',
        title: 'What problem are we solving?',
        body: [
          'Imagine an `api` container that writes uploaded files under `/data/uploads`.',
          'If that path lives only in the container filesystem, **delete the Pod and the files disappear**. If you run **two replicas**, each Pod has its **own** empty `/data/uploads` — they do not share disk by magic.',
          'You need a deliberate answer: *where do the bytes live, and how does the Pod see them?* That answer starts with a **Volume**.',
        ],
      },
      {
        id: 'what-is-a-volume',
        title: 'What is a Volume?',
        body: [
          'A **Volume** is storage attached to a **Pod** and mounted into one or more containers as a normal directory.',
          'You declare it under `spec.volumes`, then mount it with `volumeMounts` (`mountPath: /data/uploads`). The same volume `name` ties the two together. Several containers in one Pod can mount the **same** volume (for example app + log sidecar).',
        ],
        figure: {
          image: whatIsAVolumeImg,
          imageAlt:
            'Hand-drawn sketch of a Pod with a container mounting a volume at /data',
          caption: 'Image = app. Volume = extra folder plugged in at runtime.',
          flush: true,
        },
        code: {
          language: 'yaml',
          code: `spec:
  containers:
    - name: api
      image: api:1.2
      volumeMounts:
        - name: uploads
          mountPath: /data/uploads
  volumes:
    - name: uploads
      emptyDir: {}          # one kind of volume — see below`,
        },
        after: [
          'Mental model: the container image is the program; the Volume is storage attached beside it. Some volumes vanish when the Pod dies; others reach durable disks through a PVC.',
        ],
      },
      {
        id: 'volume-kinds',
        title: 'Volume kinds — how the Pod gets the bytes',
        body: [
          '“Volume” is the Pod attachment. The **kind** says what backs it.',
        ],
        figure: {
          image: volumeKindsImg,
          imageAlt:
            'Hand-drawn map of common volume kinds: emptyDir, configMap/secret, hostPath, PVC, projected',
          caption: 'Same mount mechanism. Different backends.',
          flush: true,
        },
        after: [
          '**emptyDir** — Scratch space created when the Pod is scheduled; **deleted when the Pod is removed**. Shared by containers in that Pod. Good for temp files, caches, shared logs. Not for data that must survive a restart.',
          '**configMap / secret** — Mount configuration or credentials as **files** (one key → one file). Same objects you can also inject as env.',
          '**hostPath** — A path from the **Node** filesystem. Powerful for demos and some node agents; risky for normal apps (Pods move nodes; security). Usually platform / privileged territory.',
          '**persistentVolumeClaim** — Mount durable storage by referencing a **PVC** by name. This is the main app path for data that must outlive a Pod.',
          '**projected** — Combine several sources (ServiceAccount token, CA cert, ConfigMap, …) into one directory. Common for in-cluster API auth.',
        ],
        tableAfter: {
          headers: ['Kind', 'Survives Pod delete?', 'Typical use'],
          rows: [
            ['emptyDir', 'No', 'Scratch, shared sidecar files'],
            ['configMap / secret', 'No (rebuilt from API object)', 'Config and credential files'],
            ['hostPath', 'On the node — not portable', 'Node agents / special cases'],
            ['persistentVolumeClaim', 'Yes (disk lives with PV)', 'App data, databases, uploads'],
            ['projected', 'No', 'Tokens + certs as one mount'],
          ],
        },
        callout: {
          kind: 'tip',
          title: 'Also in the docs',
          body: [
            'You will also see `nfs`, CSI volume types, `downwardAPI`, and ephemeral CSI volumes. Same idea: different backends, same Pod mount mechanism. Day-to-day app YAML is mostly **emptyDir**, **config/secret**, and **PVC**.',
          ],
        },
        codes: [
          {
            language: 'yaml',
            code: `# emptyDir
volumes:
  - name: scratch
    emptyDir: {}

# config as files
volumes:
  - name: cfg
    configMap:
      name: api-config

# durable storage via claim
volumes:
  - name: uploads
    persistentVolumeClaim:
      claimName: api-uploads`,
          },
        ],
      },
      {
        id: 'when-not-emptydir',
        title: 'When emptyDir is not enough',
        body: [
          'Use emptyDir when loss on Pod delete is fine. Reach for a PVC when the data must survive reschedule, restart, or redeploy.',
        ],
        table: {
          headers: ['Need', 'emptyDir enough?', 'Better answer'],
          rows: [
            ['Temp files while the Pod runs', 'Yes', 'emptyDir'],
            ['Config / credential files', 'No', 'configMap or secret volume'],
            ['Survive Pod restart / reschedule', 'No', 'PVC → PV'],
            ['Many writers across nodes', 'No', 'PVC with an RWX-capable backend'],
          ],
        },
      },
      {
        id: 'pv-vs-pvc',
        title: 'PV vs PVC — platform offer vs app request',
        body: [
          'Durable storage splits into two objects on purpose.',
          'A **PersistentVolume (PV)** is a piece of storage **known to the cluster**: capacity, access modes, how it is implemented (cloud disk, NFS, lab hostPath, …), often a storage class name. It is **cluster-scoped**. Usually created by **platform** or by a **CSI provisioner** — not by every app developer.',
          'A **PersistentVolumeClaim (PVC)** is a **namespaced** request: “I need this much storage, these access modes, this class.” App Pods **mount the PVC**, not the PV name.',
        ],
        figure: {
          image: pvVsPvcImg,
          imageAlt:
            'Hand-drawn sketch: cluster-scoped PV offered by platform, namespace PVC claim, Pod mounts the claim',
          caption: 'Platform offers. App claims. Pod mounts the claim.',
          flush: true,
        },
        table: {
          headers: ['', 'PersistentVolume (PV)', 'PersistentVolumeClaim (PVC)'],
          rows: [
            ['Scope', '**Cluster**', '**Namespace**'],
            ['Who usually creates it', 'Platform / provisioner', 'App team'],
            ['Meaning', '“Here is disk”', '“I need disk matching X”'],
            ['Pods reference', 'Almost never directly', 'Yes — `claimName`'],
          ],
        },
        after: [
          'Example PVC an app team writes:',
        ],
        code: {
          language: 'yaml',
          code: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: api-uploads
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  storageClassName: manual`,
        },
        callout: {
          kind: 'idea',
          title: 'Why the split?',
          body: [
            'App teams should not need cluster-admin rights to carve cloud disks. They **request** (PVC). Platform **supplies** (PV or StorageClass). Binding connects the two.',
          ],
        },
      },
      {
        id: 'binding',
        title: 'Binding — how a PVC finds a PV',
        body: [
          '1. You create a PVC.',
          '2. The control plane looks for a matching **Available** PV (enough capacity, compatible access modes, matching storage class / selectors).',
          '3. They **bind** — PVC and PV both show phase **Bound**.',
          '4. Your Pod mounts the PVC; kubelet attaches/mounts the real backend on the node.',
        ],
        bullets: [
          '**Static provisioning** — platform pre-creates PVs; PVCs bind to them.',
          '**Dynamic provisioning** — no hand-made PV; a StorageClass provisioner creates a PV when the PVC appears.',
        ],
        after: [
          'If nothing matches, the PVC stays **Pending** (wrong class, no capacity, missing provisioner, zone constraints, and so on). `kubectl describe pvc` is the first place to look.',
        ],
      },
      {
        id: 'storageclass',
        title: 'StorageClass — recipes for dynamic disks',
        body: [
          'A **StorageClass** is a cluster-wide recipe apps select by name:',
        ],
        bullets: [
          '**Name** — what you put on the PVC (`storageClassName: fast`)',
          '**Provisioner** — often a **CSI** driver that talks to cloud/disk APIs',
          '**Parameters** — disk type, encryption, zones, …',
          '**Defaults** — reclaim policy, volume binding mode, and related settings',
        ],
        figure: {
          image: storageClassDynamicImg,
          imageAlt:
            'Hand-drawn flow: PVC requests a class, provisioner creates a volume and PV, claim binds, Pod mounts',
          caption: 'No hand-made PV required — the provisioner creates it.',
          flush: true,
        },
        code: {
          language: 'yaml',
          code: `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast
provisioner: example.csi.driver
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer`,
        },
        after: [
          '**App developer:** choose `fast` vs `standard` (or whatever classes your cluster publishes) on the PVC.',
          '**Platform:** install CSI drivers and define the classes.',
          'Dynamic flow in one line: PVC asks for class → provisioner creates backend volume → PV object appears → bind → Pod mounts claim.',
        ],
      },
      {
        id: 'access-reclaim',
        title: 'Access modes and reclaim policies',
        body: [
          '**Access modes** describe how the volume may be mounted. What your StorageClass / plugin actually supports matters — not every cloud disk can do RWX.',
        ],
        figure: {
          image: accessReclaimImg,
          imageAlt:
            'Hand-drawn comparison of RWO, ROX, RWX access modes and Retain vs Delete reclaim policies',
          caption: 'Sharing rules and cleanup rules are separate knobs.',
          flush: true,
        },
        table: {
          headers: ['Access mode', 'Intent', 'Typical use'],
          rows: [
            [
              '**ReadWriteOnce (RWO)**',
              'One node may mount read-write',
              'Single writer Pod / Deployment at replicas 1',
            ],
            [
              '**ReadOnlyMany (ROX)**',
              'Many nodes, read-only',
              'Shared read-only content',
            ],
            [
              '**ReadWriteMany (RWX)**',
              'Many nodes, read-write',
              'Needs a backend that supports it (e.g. NFS-style)',
            ],
          ],
        },
        tableAfter: {
          headers: ['Reclaim policy', 'After the PVC is deleted'],
          rows: [
            ['**Retain**', 'PV and data kept — manual cleanup'],
            ['**Delete**', 'Backend volume deleted with the claim (common for dynamic disks)'],
          ],
        },
        callout: {
          kind: 'warn',
          title: 'RWO and replicas',
          body: [
            'A single RWO disk usually cannot be written by two Pods on different nodes. If one claim backs the app, keep **replicas: 1** (or use a different storage design). Scaling writers is not free.',
          ],
        },
        after: [
          '(*Recycle* reclaim is obsolete — ignore it for new learning.)',
        ],
      },
      {
        id: 'app-yaml',
        title: 'Putting it together — YAML the app team writes',
        body: [
          'Claim storage, then mount the claim. Platform already offered a matching PV **or** your class can provision one dynamically.',
        ],
        codes: [
          {
            language: 'yaml',
            code: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: api-uploads
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 1Gi
  storageClassName: manual   # or "fast" when using dynamic classes`,
          },
          {
            language: 'yaml',
            code: `spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: api
          image: api:1.2
          volumeMounts:
            - name: uploads
              mountPath: /data/uploads
      volumes:
        - name: uploads
          persistentVolumeClaim:
            claimName: api-uploads`,
          },
        ],
      },
      {
        id: 'more-storage',
        title: 'More of the storage map',
        body: [
          'A few related pieces round out the meal without needing their own full blog yet:',
        ],
        bullets: [
          '**StatefulSet `volumeClaimTemplates`** — each Pod identity (`api-0`, `api-1`) gets its **own** PVC automatically. Typical for databases that need stable per-instance disks.',
          '**CSI (Container Storage Interface)** — standard plugin API behind modern StorageClasses. App YAML usually only names the class; the driver does the rest.',
          '**VolumeSnapshot / VolumeSnapshotClass** — snapshot a PVC and restore — backup/DR territory; often platform-owned.',
          '**Ephemeral CSI volumes** — some drivers offer Pod-lifetime volumes without long-lived claims — advanced.',
        ],
        tableAfter: {
          headers: ['Task', 'Usually owned by'],
          rows: [
            ['Install CSI, define StorageClasses, static PVs', 'Platform'],
            ['Create PVC, mount into Deployment / StatefulSet', 'App developer'],
            ['emptyDir / ConfigMap / Secret volumes', 'App developer'],
            ['hostPath for ordinary apps', 'Avoid'],
            ['Snapshots, cluster storage policy', 'Often platform'],
          ],
        },
      },
    ],
    takeaways: [
      'A **Volume** mounts storage into a Pod; the **kind** decides scratch vs config vs durable.',
      '**emptyDir** dies with the Pod; durable data uses a **PVC**.',
      '**PV** = cluster disk offer (platform / provisioner); **PVC** = namespaced request (app).',
      'They **bind**; Pods mount the **claim**, not the PV name.',
      '**StorageClass** enables **dynamic** PVs via a provisioner (often CSI).',
      'Know **RWO / ROX / RWX** and **Retain / Delete** before you scale writers on one disk.',
    ],
    relatedLabs: [
      {
        challengeId: 'k8s-19-claim-disk-for-order-processor',
        label: 'Claim Disk for Order Processor',
      },
      {
        challengeId: 'k8s-20-stateful-orders-database',
        label: 'Stateful Orders Database',
      },
      {
        challengeId: 'k8s-22-dynamic-disks-via-storageclass',
        label: 'Dynamic Disks via StorageClass',
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
  'k8s-03-roll-forward-with-a-deployment': ['services'],
  'k8s-05-expose-order-processor-for-qa': ['configmaps-secrets'],
  'k8s-07-keep-credentials-in-a-secret': ['multi-container-pods'],
  'k8s-09-migrate-schema-before-the-app-starts': ['pod-networking-and-policies'],
  'k8s-10-firewall-rules-between-order-and-payment': ['requests-limits-quotas'],
  'k8s-11-cap-order-processor-cpu-and-memory': ['probes-liveness-readiness-startup'],
  'k8s-14-give-slow-starters-time-to-boot': ['security-context'],
  'k8s-15-lock-down-payment-handler-process': ['serviceaccounts-rbac'],
  'k8s-17-run-settlement-export-as-a-job': ['volumes-pvs-pvcs-storageclasses'],
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
