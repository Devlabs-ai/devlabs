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
import whySecurityContextImg from '../assets/k8s-readings/security-context/why-security-context.png';
import serviceAccountImg from '../assets/k8s-readings/rbac-serviceaccounts/serviceaccount.png';
import roleRoleBindingImg from '../assets/k8s-readings/rbac-serviceaccounts/role-rolebinding.png';
import whyRbacImg from '../assets/k8s-readings/rbac-serviceaccounts/why-rbac.png';
import whatIsAVolumeImg from '../assets/k8s-readings/storage/what-is-a-volume.png';
import volumeKindsImg from '../assets/k8s-readings/storage/volume-kinds.png';
import pvVsPvcImg from '../assets/k8s-readings/storage/pv-vs-pvc.png';
import storageClassDynamicImg from '../assets/k8s-readings/storage/storageclass-dynamic.png';
import accessReclaimImg from '../assets/k8s-readings/storage/access-reclaim.png';
import whyControlledReleasesImg from '../assets/k8s-readings/canary-blue-green/why-controlled-releases.png';
import whatIsCanaryImg from '../assets/k8s-readings/canary-blue-green/what-is-canary.png';
import whatIsBlueGreenImg from '../assets/k8s-readings/canary-blue-green/what-is-blue-green.png';
import canaryVsBlueGreenImg from '../assets/k8s-readings/canary-blue-green/canary-vs-blue-green.png';
import whyHelmImg from '../assets/k8s-readings/helm/why-helm.png';
import whatIsAChartImg from '../assets/k8s-readings/helm/what-is-a-chart.png';
import templatesAndValuesImg from '../assets/k8s-readings/helm/templates-and-values.png';
import oneChartManyValuesImg from '../assets/k8s-readings/helm/one-chart-many-values.png';
import devsetuBlogStampImg from '../assets/k8s-readings/devsetu-blog-stamp.png';

export const K8S_READINGS_BASE = `${K8S_LABS_PATH}/read`;

/** Shared stamp asset for readings that opt in via `showBlogStamp`. */
export const K8S_BLOG_STAMP_SRC = devsetuBlogStampImg;

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
  kind: 'idea' | 'tip' | 'warn' | 'takeaway' | 'scope';
  title: string;
  body: string[];
}

export interface K8sReadingCodeBlock {
  language: string;
  code: string;
}

export interface K8sReadingFlow {
  title: string;
  steps: string[];
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
  /** Pretty horizontal step path (instead of a plain text code fence). */
  flows?: K8sReadingFlow[];
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
  /** Optional top-right “The DevSetu Blog” stamp (trial on select readings). */
  showBlogStamp?: boolean;
  /** Hide from the track list unless this lab is visible to the viewer. */
  gatedByChallengeId?: string;
}

export type K8sTrackItem =
  | { type: 'reading'; id: string; readingId: string }
  | { type: 'challenge'; id: string; challengeId: string };

export function k8sReadingPath(slug: string): string {
  return `${K8S_READINGS_BASE}/${slug}`;
}

export const K8S_READINGS: K8sReading[] = [
  {
    id: 'kubectl-basics',
    slug: 'kubectl-basics',
    trackId: 'B0',
    eyebrow: '',
    title: 'kubectl: your remote control for the cluster',
    showBlogStamp: true,
    gatedByChallengeId: 'k8s-00-meet-kubectl',
    lede:
      'What **kubectl** actually is, how every command is built, and the dozen commands you will use on **every kind of Kubernetes resource**: to look around, debug, create, and clean up. The examples use Pods, but the commands work the same for everything else.',
    sections: [
      {
        id: 'why-kubectl',
        title: 'What problem are we solving?',
        body: [
          'A Kubernetes cluster is a group of machines (**nodes**) running your apps. You never log in to those machines one by one to start programs. Instead, you tell the cluster **what you want** ("run one copy of this image", "show me what is running") and the cluster makes it so.',
          'The cluster listens for those requests on one front door: the **API server**. **`kubectl`** (say "cube-control" or "cube-C-T-L") is the command-line tool that talks to that front door for you. Think of it as a remote control: the buttons are commands, the TV is the cluster.',
          'Everything you manage in Kubernetes is a **resource**: Pods, Deployments, Services, ConfigMaps, Secrets, Namespaces, Nodes and more. kubectl is the one tool for **all** of them. The same handful of commands (`get`, `describe`, `apply`, `delete`, …) work on every resource type; only the resource name changes.',
        ],
        callout: {
          kind: 'idea',
          title: 'Why the examples use Pods',
          body: [
            'To keep things concrete, this reading and the lab use one resource as the example: the **Pod**, the smallest thing Kubernetes runs (a wrapper around one or more running containers). "A Pod is a running app" is enough to follow along; the next reading goes deeper.',
            'Swap `pod` for `deployment`, `service` or `configmap` and the same commands still apply. You will do exactly that in the labs ahead, as each new resource is introduced.',
          ],
        },
      },
      {
        id: 'how-it-works',
        title: 'What happens when you press Enter',
        body: [
          'kubectl does not run anything itself. It turns your command into an HTTPS request, sends it to the API server, and prints the answer.',
        ],
        flows: [
          {
            title: 'kubectl run hello --image=nginx:1.25',
            steps: ['You type the command', 'kubectl builds a request', 'API server checks and stores it', 'Scheduler picks a node', 'Kubelet on that node starts the container'],
          },
        ],
        after: [
          'How does kubectl know **which** cluster to talk to, and who you are? A small file called a **kubeconfig** (usually `~/.kube/config`) holds the cluster address, your credentials, and a default namespace. In DevSetu labs it is already set up for you, which is why `kubectl` just works in the terminal.',
        ],
        code: {
          language: 'bash',
          code: `kubectl config current-context      # which cluster/user kubectl is using
kubectl config view --minify        # the settings for that context
kubectl version                     # client (and server) versions`,
        },
      },
      {
        id: 'anatomy',
        title: 'Every command has the same shape',
        body: ['Once you see the pattern, most commands read like a sentence:'],
        code: {
          language: 'bash',
          code: `kubectl <verb>    <resource>  [name]        [flags]
kubectl get       pods
kubectl get       pods        hello         -o wide
kubectl describe  pod         hello
kubectl delete    pod         hello`,
        },
        table: {
          headers: ['Part', 'What it means', 'Examples'],
          rows: [
            ['**verb**', 'What you want to do', '`get`, `describe`, `logs`, `exec`, `run`, `create`, `apply`, `label`, `delete`'],
            ['**resource**', 'What kind of object', '`pods` (`po`), `deployments` (`deploy`), `services` (`svc`), `configmaps` (`cm`), `nodes`'],
            ['**name**', 'Which one (leave it out to mean "all of them")', '`hello`, `mystery-pod`'],
            ['**flags**', 'Extra options', '`-o wide`, `-o yaml`, `-l app=web`, `-w`, `-n other-ns`'],
          ],
        },
        after: [
          'Singular or plural does not matter (`pod` = `pods`), and short names save typing: `kubectl get po` is the same as `kubectl get pods`. Run `kubectl api-resources` to see every resource type and its short name.',
        ],
      },
      {
        id: 'namespaces',
        title: 'Namespaces: your own room in a shared cluster',
        body: [
          'A **namespace** is a named folder inside the cluster. Objects in different namespaces do not clash, so many people can share one cluster without stepping on each other.',
          'In DevSetu, every lab gives you your **own namespace**, and kubectl already defaults to it. That is why the labs never ask you to type `-n`. Check which one is yours with `echo $LEARNER_NS`.',
        ],
        code: {
          language: 'bash',
          code: `echo $LEARNER_NS                 # your lab namespace
kubectl get pods                 # pods in your namespace (the default)
kubectl get pods -n kube-system  # -n picks a different namespace`,
        },
        callout: {
          kind: 'tip',
          title: 'Seeing "Forbidden"? That is expected',
          body: [
            'Some commands, like `kubectl get namespaces`, return **Forbidden** in the labs. That is **RBAC** (permissions) doing its job: you have full control of your own namespace, and read-only or no access elsewhere. It is not a mistake on your side.',
          ],
        },
      },
      {
        id: 'look-around',
        title: 'Looking around: get, describe, explain',
        body: [
          '**`get`** lists objects as a short table. It is the first thing you run in any cluster. Flags change what you see:',
        ],
        code: {
          language: 'bash',
          code: `kubectl get pods                   # name, ready, status, restarts, age
kubectl get pods -o wide           # + Pod IP and the node it runs on
kubectl get pods --show-labels     # + labels
kubectl get pods -l app=web        # only Pods with label app=web
kubectl get pods -w                # keep watching for changes (Ctrl+C to stop)
kubectl get pod hello -o yaml      # the full object, exactly as the cluster stores it
kubectl get nodes                  # the machines in the cluster`,
        },
        after: [
          '**`describe`** is "tell me everything about this one object" in a readable format: its labels, image, ports, conditions and, most usefully, the **Events** at the bottom. Events are the cluster’s diary: *scheduled onto node X, pulling image, started container*, or *failed to pull image*. When something is stuck, `describe` usually tells you why.',
          '**`explain`** is the built-in manual for YAML fields, so you do not have to memorise them.',
        ],
        codes: [
          {
            language: 'bash',
            code: `kubectl describe pod hello
kubectl explain pod.spec.containers          # what fields a container has
kubectl explain pod.spec.containers.ports    # drill down field by field`,
          },
        ],
      },
      {
        id: 'debug',
        title: 'Debugging: logs, exec, events',
        body: [
          '**`logs`** prints what the app wrote to its output (stdout/stderr). It is the first place to look when an app misbehaves.',
          '**`exec`** runs a command **inside** a running container, like opening a terminal in it. Everything after `--` runs in the container, not on your machine.',
        ],
        code: {
          language: 'bash',
          code: `kubectl logs hello                  # what the app printed
kubectl logs hello -f               # follow new lines live (Ctrl+C to stop)
kubectl logs hello --previous       # logs from before the last crash/restart

kubectl exec hello -- ls /tmp       # run one command inside the container
kubectl exec -it hello -- sh        # interactive shell (type exit to leave)

kubectl get events --sort-by=.lastTimestamp   # recent events in your namespace`,
        },
        callout: {
          kind: 'tip',
          title: 'A debugging routine that works',
          body: [
            '`get` (is it Running? Ready? restarting?) → `describe` (read the Events) → `logs` (what did the app say?) → `exec` (look around inside). Most lab problems are solved by the second step.',
          ],
        },
      },
      {
        id: 'create',
        title: 'Creating things: imperative vs declarative',
        body: [
          'There are two ways to ask for something.',
          '**Imperative**: you give an order with flags, right now. Quick for experiments, but nothing is written down.',
          '**Declarative**: you write the desired state in a **YAML file** and `apply` it. The file is the source of truth: edit it, apply again, and Kubernetes changes only what differs. This is how real teams work, and how every lab after this one works.',
        ],
        table: {
          headers: ['', 'Imperative', 'Declarative'],
          rows: [
            ['You say', '"Run this, now"', '"This is what I want to exist"'],
            ['Commands', '`run`, `create`, `label`, `scale`, `edit`', '`apply -f file.yaml`'],
            ['Written down?', 'No (only in your shell history)', 'Yes, in a file you can review and reuse'],
            ['Change it later', 'Another command', 'Edit the file, `apply` again'],
          ],
        },
        code: {
          language: 'bash',
          code: `# Imperative
kubectl run hello --image=nginx:1.25 --port=80
kubectl label pod hello stage=warmup

# Declarative
kubectl apply -f web-pod.yaml`,
        },
        callout: {
          kind: 'takeaway',
          title: 'The trick you will use in every lab',
          body: [
            'Add `--dry-run=client -o yaml` to an imperative command and kubectl **prints the YAML instead of creating anything**. Save it to a file, tweak it, then `apply` it. No more writing manifests from a blank page.',
            '`kubectl run web --image=nginx:1.25 --dry-run=client -o yaml > web-pod.yaml`',
          ],
        },
      },
      {
        id: 'cleanup',
        title: 'Cleaning up: delete',
        body: ['Delete by name, or delete everything a file created:'],
        code: {
          language: 'bash',
          code: `kubectl delete pod hello        # one object by name
kubectl delete -f web-pod.yaml  # whatever the file describes`,
        },
        callout: {
          kind: 'warn',
          title: 'Some Pods come back when you delete them',
          body: [
            'A Pod you created yourself stays deleted. But Pods created **by a controller** (a ReplicaSet or Deployment, coming up in the next labs) are recreated automatically: the controller notices one is missing and replaces it. To remove those, delete the controller.',
          ],
        },
      },
      {
        id: 'cheat-sheet',
        title: 'Cheat sheet',
        body: ['Keep this handy for the first few labs:'],
        table: {
          headers: ['Want to…', 'Command'],
          rows: [
            ['List things', '`kubectl get pods` · `-o wide` · `--show-labels` · `-l key=value` · `-w`'],
            ['See details and events', '`kubectl describe pod <name>`'],
            ['See the full object', '`kubectl get pod <name> -o yaml`'],
            ['Read app output', '`kubectl logs <pod>` · `-f` · `--previous`'],
            ['Run inside a container', '`kubectl exec <pod> -- <cmd>` · `kubectl exec -it <pod> -- sh`'],
            ['Create quickly', '`kubectl run <name> --image=<image>` · `kubectl create deployment|configmap|secret …`'],
            ['Get starter YAML', 'add `--dry-run=client -o yaml > file.yaml`'],
            ['Create or update from a file', '`kubectl apply -f file.yaml`'],
            ['Add a label', '`kubectl label pod <name> key=value`'],
            ['Delete', '`kubectl delete pod <name>` · `kubectl delete -f file.yaml`'],
            ['Look up a YAML field', '`kubectl explain pod.spec.containers`'],
            ['Get help for any command', '`kubectl <verb> --help`'],
          ],
        },
      },
    ],
    takeaways: [
      '**kubectl** is a client: every command is a request to the cluster’s **API server**, using the cluster and credentials in your **kubeconfig**.',
      'kubectl works on **every resource type** (Pods, Deployments, Services, ConfigMaps, …). Pods are just the example here; the same verbs apply everywhere.',
      'Commands read like sentences: `kubectl <verb> <resource> [name] [flags]`.',
      'Your lab namespace is the default, so you never need `-n` in the labs. "Forbidden" outside it is RBAC, not an error on your side.',
      'Look around with `get` / `describe` / `explain`; debug with `logs` / `exec` / events.',
      'Imperative commands are quick; **declarative** `apply -f` is how the labs (and real teams) work. `--dry-run=client -o yaml` bridges the two.',
    ],
    relatedLabs: [
      {
        challengeId: 'k8s-00-meet-kubectl',
        label: 'Meet kubectl',
      },
    ],
  },
  {
    id: 'containers-runtimes-pods',
    slug: 'containers-runtimes-pods',
    trackId: 'B1',
    eyebrow: '',
    title: 'Containers, Runtimes, and Pods',
    showBlogStamp: true,
    lede:
      'What a **container** is, how a **runtime** starts it on Docker Desktop vs Kubernetes, and why Kubernetes schedules a **Pod** — not a bare container.',
    sections: [
      {
        id: 'why-containers',
        title: 'What problem are we solving?',
        body: [
          'You build a **photo-booth** app that prints guest photos at events. On your laptop it works. On a volunteer’s machine, half the libraries are missing. On the venue kiosk, an older OS breaks the printer driver stack.',
          'You need a way to ship the app **plus** the filesystem view it needs — so the same **`print-kiosk`** image boots the same way on every machine. That packaging story is what containers (and, later, Pods) are for.',
        ],
      },
      {
        id: 'what-is-a-container',
        title: 'Let’s first understand what a container is',
        body: [
          'A **container** is a way to run a program so it brings its own files and libraries with it, and is lightly isolated from other programs on the same machine.',
          'Before containers, people already tried to keep projects from stepping on each other: language-local environments, project folders with pinned dependencies, “install everything in this directory only.” Those approaches help — but they usually stay tied to **one language** or **one host’s** idea of what is installed.',
          'A **container** packages the app **plus** a filesystem view (language runtime, system libraries, config files) so the process does not depend on “whatever happens to be on this machine.” You can move that package elsewhere and get the same shape of environment.',
          'You still *run* a process either way. The container’s win is **how much of the environment travels with the app**.',
        ],
        table: {
          headers: ['', 'Typical package / env isolation', 'Container'],
          rows: [
            [
              'Isolates',
              'Often one language’s libraries or a project folder',
              'App + OS-level files/libs it needs',
            ],
            [
              'Feels like',
              '“clean deps for this project on this machine”',
              '“a small portable machine view for this process”',
            ],
            [
              'Ships as',
              'Usually not one portable runnable unit',
              'An **image** you pull and run anywhere a compatible runtime exists',
            ],
          ],
        },
        after: [
          'An **image** is that package (e.g. `print-kiosk:v1.0`). A **container** is a running instance of that image — the live process.',
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
          flush: true,
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
          '**On Kubernetes (cluster)** — You do not usually “docker run” into the cluster. You declare a **Pod**. The **kubelet** on a node talks to a runtime through the **CRI** (Container Runtime Interface) and starts the container(s) *inside that Pod*.',
        ],
        flows: [
          {
            title: 'Docker path',
            steps: ['You', 'Docker Desktop / CLI', 'Engine', 'Runtime', 'Container'],
          },
          {
            title: 'Kubernetes path',
            steps: ['You', 'Pod YAML / kubectl', 'API server', 'Kubelet', 'CRI → runtime', 'Container(s) in Pod'],
          },
        ],
        callout: {
          kind: 'scope',
          title: 'OCI — why images are portable',
          body: [
            '**OCI** means **Open Container Initiative** — a shared industry standard for how container **images** are packaged and how **runtimes** start them. Docker popularized the idea; OCI made the format interoperable.',
            'So the same **OCI image** can run under Docker Desktop on a laptop or under **containerd** / **CRI-O** on a Kubernetes node. Different control path; same kind of image.',
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
          flush: true,
        },
        after: [
          'A Pod wraps one or more containers that always land on **one** node together, share a network namespace (same Pod IP; they can talk on `localhost`), and can share volumes.',
          'For most simple apps: **one Pod → one container** — for example a single `print-kiosk` container in its Pod.',
        ],
        callout: {
          kind: 'scope',
          title: 'Container vs Pod vs Node',
          body: [
            '**Container** = how the app runs. **Pod** = how Kubernetes names, places, and tracks that run. **Node** = which machine it landed on.',
          ],
        },
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
        - containerPort: ...   # port the process listens on`,
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
          ],
        },
      },
    ],
    takeaways: [
      'Everyday package isolation helps on one machine; a **container** ships a fuller filesystem view as an **image** you can run elsewhere.',
      'A **VM** gives a full guest OS; a **container** shares the host kernel and stays lighter.',
      'A **runtime** starts containers — via **Docker Desktop** on a laptop, or via **kubelet + CRI** on Kubernetes. **OCI** is why the same image format works across tools.',
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
    showBlogStamp: true,
    lede:
      'A single **Pod** is fine for learning. Real apps need several copies, replacements when a Pod dies, and a way to change the image without deleting everything by hand. That is what **controllers**, **ReplicaSets**, and **Deployments** are for.',
    sections: [
      {
        id: 'why-controllers',
        title: 'What problem are we solving?',
        body: [
          'A campus **library** runs a `catalog` search app. One Pod is fine for a demo. At exam week, traffic spikes — you want three copies, and if one dies, another should appear without someone SSHing in.',
          'Later you ship `catalog:v1.1`. You need a controlled roll forward (and a way back) — not “delete every Pod by hand and hope.” Controllers, ReplicaSets, and Deployments are how Kubernetes babysits that story.',
        ],
      },
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
          'Reads a **desired state** (from an object / YAML you created — e.g. “I want 3 Pods like this”)',
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
          flush: true,
        },
        callout: {
          kind: 'scope',
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
          'Example: the Pod template says *`app: catalog`*. The ReplicaSet selector says: match Pods with *`app: catalog`*. The controller counts and creates Pods that match that selector.',
          'If selector and template labels disagree, the ReplicaSet cannot manage the Pods correctly — a common beginner trap.',
        ],
        figure: {
          image: labelsSelectorsImg,
          imageAlt:
            'Hand-drawn sketch: ReplicaSet selector matching labeled Pods; unmatched Pod left outside',
          caption: 'The controller only owns Pods that match its selector.',
          flush: true,
        },
      },
      {
        id: 'what-is-a-replicaset',
        title: 'What is a ReplicaSet?',
        body: [
          'A **ReplicaSet** is a controller object whose job is simple: keep **N identical Pods** running from a **Pod template**.',
          'You set `replicas` (how many), `selector` (which Pods count), and `template` (the Pod recipe — same ideas as a bare Pod: containers, image, ports, …).',
          'If a Pod dies, the ReplicaSet creates a replacement. If you scale `replicas` from 3 → 5, it creates two more.',
          'A ReplicaSet does **not** by itself do *fancy rolling updates* when you change the image. You typically replace the whole ReplicaSet or hand-edit carefully — which is why Deployments exist.',
          'Here is that story as YAML — three `catalog` Pods kept alive by one ReplicaSet:',
        ],
        codes: [
          {
            language: 'yaml',
            code: `apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: catalog
spec:
  replicas: 3
  selector:
    matchLabels:
      app: catalog
  template:
    metadata:
      labels:
        app: catalog      # must match selector
    spec:
      containers:
        - name: catalog
          image: catalog:v1.0`,
          },
        ],
        figure: {
          image: replicaSetImg,
          imageAlt: 'Hand-drawn sketch: ReplicaSet with replicas 3 pointing at three identical Pods',
          caption: 'One desired count. Matching Pods. Automatic replace on failure.',
          flush: true,
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
          'A **Deployment** is a higher-level controller object for **stateless apps**. In its YAML you still declare `replicas` and a Pod `template` — but you are **not** hand-creating those ReplicaSets and Pods yourself. You apply one Deployment; it creates and manages the **ReplicaSet(s)** underneath, and those ReplicaSets create the **Pods**.',
          'You almost always edit the **Deployment**; you rarely create a ReplicaSet by hand in production. Learning tracks often create a ReplicaSet once so you see the middle layer.',
          'The Deployment’s job is broader than “keep N alive”:',
        ],
        bullets: [
          'Ensure the right number of Pods are up (by owning **ReplicaSet(s)** underneath)',
          '**Roll out** a new template (e.g. new image) gradually',
          'Keep history so you can **roll back**',
        ],
        flows: [
          {
            title: 'Who owns what',
            steps: ['Deployment', 'ReplicaSet(s)', 'Pods'],
          },
        ],
        codes: [
          {
            language: 'yaml',
            code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalog
spec:
  replicas: 3
  selector:
    matchLabels:
      app: catalog
  template:
    metadata:
      labels:
        app: catalog      # must match selector
    spec:
      containers:
        - name: catalog
          image: catalog:v1.0`,
          },
        ],
        figure: {
          image: deploymentLayersImg,
          imageAlt:
            'Hand-drawn sketch: Deployment containing a ReplicaSet containing Pods',
          caption: 'Deployment manages ReplicaSets; ReplicaSets manage Pods.',
          flush: true,
        },
      },
      {
        id: 'rs-vs-deployment',
        title: 'How Deployment differs from ReplicaSet — and why the abstraction appeared',
        body: [
          'A **ReplicaSet** answers one question well: keep **N** Pods that match **this exact template**. That is enough for **scale** and **self-heal** (replace a dead Pod). It is awkward for **change**.',
          'Suppose `catalog` runs under a ReplicaSet on image `v1.0` with `replicas: 3`, and you need `v1.1`. With only a ReplicaSet you typically create a **new** ReplicaSet with the new template, or edit/replace the old one carefully.',
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
          flush: true,
        },
        callout: {
          kind: 'scope',
          title: 'Rule of thumb',
          body: [
            'Use a **ReplicaSet** when you are learning “keep N alive.” Use a **Deployment** when the thing you care about is an **app that will be updated**. In real clusters, Deployments are the default for stateless services; bare ReplicaSets are the mechanism underneath.',
          ],
        },
      },
    ],
    takeaways: [
      'A **controller** reconciles desired vs current state in a loop — desired state comes from an object / YAML you apply.',
      'A **ReplicaSet** keeps **N** Pods of **one** template (scale + self-heal).',
      'A **Deployment** sits above ReplicaSets so **template changes** (roll out / roll back) are first-class — that is why the abstraction exists.',
      '**Labels + selectors** (e.g. *`app: catalog`*) define which Pods a controller owns.',
      'Day to day you declare a **Deployment**; it creates ReplicaSets and Pods for you — you rarely hand-make those layers.',
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
    showBlogStamp: true,
    lede:
      'Pods get new IPs when they restart. A **Service** gives your app a stable **name** and **virtual IP** so other Pods (and later, outside traffic) can dial without chasing addresses.',
    sections: [
      {
        id: 'why-services',
        title: 'What problem are we solving?',
        body: [
          'Your `booking` app runs as several Pods under a Deployment. Each Pod gets its **own cluster IP**. When a Pod restarts, is replaced in a rollout, or a new replica appears, that IP usually **changes**.',
          'Other workloads still need to reach `booking` reliably — a `web` frontend, another API, a cron Job. If they hard-code yesterday’s Pod IP, calls fail the moment that Pod is gone. They need one **stable address** that keeps pointing at whichever `booking` Pods are **Ready** right now. That stable address is a **Service**.',
        ],
      },
      {
        id: 'pod-ips-change',
        title: 'Why Pod IPs are awkward',
        body: [
          'You already know how to run several copies of an app with a **Deployment**. Each Pod still gets its **own IP** on the cluster network.',
          'That IP is not a permanent address. When a Pod is replaced — crash, scale-down, rollout — the new Pod usually gets a **different** IP. Hard-coding `http://10.0.1.7:8080` in another workload breaks the moment the first Pod dies.',
          'Clients need a **stable Service address**, not “whatever Pod IP exists this minute.”',
        ],
        figure: {
          image: podIpProblemImg,
          imageAlt:
            'Hand-drawn sketch: Pods with changing IPs and a client unsure which address to dial',
          caption: 'Replicas come and go. Their IPs are not a contract.',
          flush: true,
        },
      },
      {
        id: 'what-is-a-service',
        title: 'What is a Service?',
        body: [
          'A **Service** is a Kubernetes object that exposes a set of Pods under one **stable DNS name** and (usually) one **stable virtual IP** (ClusterIP for the default type).',
          'Callers dial the Service. Kubernetes forwards traffic to a **Ready** Pod that matches the Service’s selector. When Pods are replaced, the Service object stays; only the backend list updates.',
        ],
        quote: 'Dial a name (and ClusterIP) — not a Pod IP.',
        figure: {
          image: whatIsAServiceImg,
          imageAlt:
            'Hand-drawn sketch: client dials a Service which fans out to labeled Pods',
          caption: 'One name in. Many Pods behind it.',
          flush: true,
        },
        after: [
          'Inside the cluster, other Pods typically reach the Service via **DNS**: `http://booking:8080` (short name in the same namespace) or the longer `booking.<namespace>.svc.cluster.local`.',
          'Kubernetes also assigns a **ClusterIP** — a virtual IP that exists for the life of the Service object (until you delete it). Clients can use DNS or that IP; DNS is what you usually teach first.',
        ],
        callout: {
          kind: 'scope',
          title: 'Service ≠ Deployment',
          body: [
            'A **Deployment** keeps Pods alive and updated. A **Service** makes those Pods **reachable** under a stable address. You often create both for the same app — e.g. a `booking` Deployment plus a `booking` Service.',
          ],
        },
      },
      {
        id: 'selector-endpoints',
        title: 'Selectors and Endpoints',
        body: [
          'A Service does not list Pod names by hand. It uses a **selector** — the same label idea you saw on ReplicaSets and Deployments.',
          'Example: `selector: app: booking`. Every ready Pod with that label becomes a backend for the Service.',
          'Kubernetes tracks those backends as **Endpoints** (or EndpointSlices in newer clusters): the live list of `PodIP:port` pairs the Service can send traffic to. When Pods appear or disappear, Endpoints update automatically.',
        ],
        figure: {
          image: selectorEndpointsImg,
          imageAlt:
            'Hand-drawn sketch: Service selector matching labeled Pods into an Endpoints list; unmatched Pod left out',
          caption: 'Selector picks Pods. Endpoints are the live address list.',
          flush: true,
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
          '**`port`** — what clients dial **on the Service** (e.g. `booking:8080`)',
          '**`targetPort`** — the port **on the Pod / container** that should receive the traffic',
        ],
        figure: {
          image: portTargetPortImg,
          imageAlt:
            'Hand-drawn sketch: client to Service port then to Pod targetPort, with optional different numbers',
          caption: 'Service `port` is what clients dial; `targetPort` is where the container listens.',
          flush: true,
        },
        after: [
          'They are often the **same** number (e.g. both `8080`). They can differ — classic pattern: Service `port: 80`, container listens on `8080` via `targetPort: 8080`.',
          'The container’s `containerPort` in the Pod template documents what the app listens on; `targetPort` should match that listening port.',
        ],
      },
      {
        id: 'service-types',
        title: 'Service types',
        body: [
          'Every Service type shares the same core: **selector**, **Endpoints**, **`port` / `targetPort`**, and (for most types) an in-cluster identity. The **type** mainly changes **who can reach** the Service and **from where**.',
        ],
        figure: {
          image: serviceTypesImg,
          imageAlt:
            'Hand-drawn three-panel sketch comparing ClusterIP, NodePort, and LoadBalancer',
          caption: 'Same Service idea. Different who can reach it.',
          flush: true,
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
          kind: 'scope',
          title: 'Learn ClusterIP first',
          body: [
            'Selector, Endpoints, `port` / `targetPort`, and DNS work the same way for every type. ClusterIP teaches the core; NodePort and LoadBalancer mainly change **how traffic enters** the cluster.',
          ],
        },
      },
      {
        id: 'type-clusterip',
        title: 'ClusterIP',
        body: [
          '**ClusterIP** is the **default** Service type. Kubernetes assigns a virtual IP that is reachable **only inside the cluster**. Other Pods dial it by **DNS** (`booking`) or by that ClusterIP.',
          'Use it for service-to-service traffic — for example a `web` Pod calling `http://booking:8080`. Nothing outside the cluster can reach a ClusterIP Service directly (unless you add another path later, such as Ingress).',
          'You often omit `type: ClusterIP` in YAML because it is the default; writing it explicitly is fine for clarity.',
        ],
        code: {
          language: 'yaml',
          code: `apiVersion: v1
kind: Service
metadata:
  name: booking
spec:
  type: ClusterIP          # optional — this is the default
  selector:
    app: booking
  ports:
    - port: 8080           # dial booking:8080 inside the cluster
      targetPort: 8080     # container listens here`,
        },
        after: [
          'After apply: `kubectl get svc booking` shows the ClusterIP; `kubectl get endpoints booking` shows whether any Pods are ready behind it.',
        ],
      },
      {
        id: 'type-nodeport',
        title: 'NodePort',
        body: [
          '**NodePort** builds on ClusterIP. You still get an in-cluster ClusterIP and DNS name, **and** Kubernetes opens the same high port on **every node** (by default in the 30000–32767 range, or a port you pick if allowed).',
          'From outside the cluster you can reach the Service at `NodeIP:nodePort` — any node’s IP works; kube-proxy forwards to a Ready backend Pod. Inside the cluster you can still use `booking:8080` as usual.',
          'Useful for demos, labs, or bare-metal clusters without a cloud load balancer. Tradeoffs: you expose a port on every node, you must know a node IP (or put something in front), and it is rarely the long-term production front door on its own.',
        ],
        code: {
          language: 'yaml',
          code: `apiVersion: v1
kind: Service
metadata:
  name: booking
spec:
  type: NodePort
  selector:
    app: booking
  ports:
    - port: 8080           # still used inside the cluster (ClusterIP)
      targetPort: 8080     # container listens here
      nodePort: 30080      # optional — else Kubernetes picks one`,
        },
        after: [
          'Check with `kubectl get svc booking` — you will see `PORT(S)` like `8080:30080/TCP`. Hit `http://<any-node-ip>:30080` from outside (network policy / firewall permitting).',
        ],
      },
      {
        id: 'type-loadbalancer',
        title: 'LoadBalancer',
        body: [
          '**LoadBalancer** builds on NodePort. On cloud clusters (and some on-prem setups with a provider integration), Kubernetes asks the platform to provision an **external load balancer** and a public (or routable) **external IP**.',
          'Outside clients dial that external IP (and port). The cloud LB forwards into the cluster onto the Service; you still get ClusterIP/DNS for in-cluster callers. On a laptop or kind/minikube without a real provider, the external IP may stay `<pending>` — that is expected without an LB implementation.',
          'This is the usual “give this Service a cloud VIP” type for production entry (often still behind DNS and sometimes combined with Ingress for HTTP routing).',
        ],
        code: {
          language: 'yaml',
          code: `apiVersion: v1
kind: Service
metadata:
  name: booking
spec:
  type: LoadBalancer
  selector:
    app: booking
  ports:
    - port: 80             # what the external LB / clients dial
      targetPort: 8080     # container listens here`,
        },
        after: [
          'Watch `kubectl get svc booking -w` until `EXTERNAL-IP` is populated (on a real cloud provider). In-cluster Pods can keep using `http://booking` / the ClusterIP.',
        ],
      },
    ],
    takeaways: [
      'Pod IPs change; a **Service** gives a **stable name** (and ClusterIP) in front of matching Pods.',
      'A Service finds Pods with a **selector**; **Endpoints** are the live backend list.',
      '**`port`** is what clients dial on the Service; **`targetPort`** is the Pod/container port.',
      '**ClusterIP** = in-cluster only (default). **NodePort** = also `NodeIP:nodePort` on every node. **LoadBalancer** = cloud (or provider) external VIP on top of the same core.',
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
    showBlogStamp: true,
    lede:
      'Apps need settings and credentials that change without rebuilding images. **ConfigMaps** hold non-sensitive config; **Secrets** hold sensitive data — with types like Opaque, and a clear story for what is (and is not) encrypted.',
    sections: [
      {
        id: 'why-config',
        title: 'What problem are we solving?',
        body: [
          'A neighborhood **café** ships one app image for the register tablet. The daily **menu** (drink names, prices, feature toggles) changes often. The Wi‑Fi password for the back-office `safe` does not belong in that same public list.',
          'If menu text and the safe combination are baked into the image, every tweak means a rebuild. Kubernetes’ answer: keep the **menu** in a ConfigMap and the **safe** credentials in a Secret — inject both at runtime without a new image.',
        ],
      },
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
          flush: true,
        },
      },
      {
        id: 'what-is-a-configmap',
        title: 'What is a ConfigMap?',
        body: [
          'A **ConfigMap** is a namespaced object that stores **non-sensitive** configuration as key/value pairs (or small config files).',
          'Typical contents: log levels, timeouts, public URLs, feature toggles, non-secret limits — think of it as the café **menu** posted for staff tablets.',
        ],
        code: {
          language: 'yaml',
          code: `apiVersion: v1
kind: ConfigMap
metadata:
  name: menu
data:
  LOG_LEVEL: "INFO"
  SPECIALS: "oat-latte,seasonal-pastry"
  FEATURE_FLAGS: "loyalty,qr-pay"`,
        },
        after: [
          'Keys under `data` are plain UTF-8 strings. Use `binaryData` (base64) only when you must store non-text bytes — uncommon for app env config.',
        ],
        callout: {
          kind: 'scope',
          title: 'Not for passwords',
          body: [
            'If a value would hurt you if it leaked in logs, git, or a screenshot — it does **not** belong in a ConfigMap. That is what Secrets are for (the café **safe**, not the menu board).',
          ],
        },
      },
      {
        id: 'what-is-a-secret',
        title: 'What is a Secret?',
        body: [
          'A **Secret** is a namespaced object for **sensitive** data: API tokens, passwords, TLS private keys, registry credentials.',
          'Same key/value idea as a ConfigMap, but a different kind — so RBAC, tooling, and humans can treat it more carefully (who can `get` it, whether it shows up in plain `kubectl describe`, and so on).',
          'Here is a minimal café **safe** Secret (Opaque — the default bag of keys). Prefer `stringData` when writing YAML by hand; the API stores it as base64 under `data` (next section).',
        ],
        code: {
          language: 'yaml',
          code: `apiVersion: v1
kind: Secret
metadata:
  name: safe
type: Opaque
stringData:
  WIFI_PASSWORD: "s3cr3t-token"
  REGISTER_API_TOKEN: "reg-tok-demo"`,
        },
        after: [
          'You wire Secrets into Pods the same ways as ConfigMaps (**env** or **volume**). The split is about **what the data is**, not a different delivery mechanism.',
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
          flush: true,
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
          kind: 'scope',
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
          flush: true,
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
          'Most app credentials you create yourself use **`type: Opaque`** — a bag of keys you define (like the `safe` Secret above). Prefer a typed Secret when you are feeding something that already expects that type (Ingress TLS, `imagePullSecrets`, etc.).',
          'You can invent custom type strings; built-in types are the ones kubelet and common controllers already understand. Example of writing Opaque with base64 `data` instead of `stringData`:',
        ],
        code: {
          language: 'yaml',
          code: `apiVersion: v1
kind: Secret
metadata:
  name: safe
type: Opaque
data:
  # echo -n 's3cr3t-token' | base64
  WIFI_PASSWORD: czNjcjN0LXRva2Vu`,
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
          flush: true,
        },
        after: [
          'Beginners usually start with `envFrom` / `secretKeyRef`. Volume mounts matter when the app expects files (certs, config files on disk).',
        ],
        code: {
          language: 'yaml',
          code: `envFrom:
  - configMapRef:
      name: menu
env:
  - name: WIFI_PASSWORD
    valueFrom:
      secretKeyRef:
        name: safe
        key: WIFI_PASSWORD`,
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
    showBlogStamp: true,
    lede:
      'A **Pod** can run more than one container: helpers beside the app, setup jobs that finish first, and temporary debug containers. They share the Pod’s **network** — and can share **volumes** when you need them.',
    sections: [
      {
        id: 'why-multi',
        title: 'What problem are we solving?',
        body: [
          'The smallest deployable unit is still a **Pod**, and often **one container is enough**. Sometimes it is not: a `log-shipper` must read the same files and share fate with your `api`, or a one-shot `migrate` must finish before the app accepts traffic. Those helpers need the same **Pod IP**, `localhost`, and lifecycle — not a second Deployment that scales and fails on its own schedule.',
          'Multi-container Pods are for that tight coupling. Unrelated apps that should scale or restart independently stay in **separate** Pods (usually separate Deployments) and talk over a Service.',
        ],
        figure: {
          image: multiContainerPodImg,
          imageAlt:
            'Hand-drawn sketch of a Pod with an app container and log-shipper sidecar sharing one Pod IP',
          caption: 'One Pod IP and localhost. Separate processes.',
          flush: true,
        },
        callout: {
          kind: 'scope',
          title: 'Rule of thumb',
          body: [
            'Same Pod when processes must share fate, `localhost`, or a disk — for example `api` + `log-shipper`. Separate Deployments + a Service when they scale or fail independently.',
          ],
        },
      },
      {
        id: 'app-containers',
        title: 'App containers (the long-running ones)',
        body: [
          'Under `spec.containers` you list the containers that should stay up with the Pod. The main app is usually here — for example **`api`**. Extra long-running helpers in the same list are the classic **sidecar** pattern (a **`log-shipper`**, a proxy, a metrics agent, and so on).',
          'If any of these containers exits in a way that fails the Pod’s restart policy, the kubelet restarts according to that policy — they are meant to keep running.',
        ],
      },
      {
        id: 'init-containers',
        title: 'Init containers',
        body: [
          '**Init containers** run **before** the app containers. They run **one after another**, in order. Each must **exit successfully (0)** before the next starts. Only when all inits succeed do the regular containers start.',
          'Typical jobs: wait for a dependency, run a schema **`migrate`**, fetch a config blob, set permissions on a volume — setup that must finish before `api` serves traffic.',
        ],
        figure: {
          image: initContainersImg,
          imageAlt:
            'Hand-drawn timeline: init containers run to completion in sequence, then app containers start',
          caption: 'Setup first. App second. Init failure blocks the Pod from becoming Ready.',
          flush: true,
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
      command: ["run-migrations"]
  containers:
    - name: api
      image: api:1.2
    - name: log-shipper
      image: log-shipper:1.2`,
        },
      },
      {
        id: 'sidecars',
        title: 'Sidecars (helpers beside the app)',
        body: [
          'A **sidecar** is a container whose job is to assist the main app — not to be the product itself. Classic example: **`log-shipper`** beside **`api`**.',
          '**Classic pattern:** list the helper under `spec.containers` next to the app. They start together and share the Pod network (and volumes if you mount them) for the Pod’s life.',
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
        id: 'shared-emptydir',
        title: 'Sharing files: the emptyDir volume',
        body: [
          'Containers in a Pod share the network automatically, but **not** each other’s filesystems. To hand files between them — `api` writes a log, `log-shipper` reads it — you give the Pod a **volume** and mount it into both containers.',
          'The simplest volume is **`emptyDir`**: a scratch directory the kubelet creates **empty** when the Pod starts on a node. Every container that mounts it sees the same files. When the Pod is deleted or rescheduled, the directory and everything in it is **gone**.',
        ],
        code: {
          language: 'yaml',
          code: `spec:
  volumes:
    - name: shared-logs
      emptyDir: {}
  containers:
    - name: api
      image: api:1.2
      volumeMounts:
        - name: shared-logs
          mountPath: /var/log/app
    - name: log-shipper
      image: log-shipper:1.2
      volumeMounts:
        - name: shared-logs
          mountPath: /var/log/app`,
        },
        after: [
          'Two parts: declare the volume once under `spec.volumes`, then list it under each container’s `volumeMounts` with the path where it should appear. The `name` ties them together; the `mountPath` can differ per container.',
          '`emptyDir` is also handy as a writable `/tmp` when a container runs with a read-only root filesystem.',
        ],
        callout: {
          kind: 'scope',
          title: 'Scratch space, not storage',
          body: [
            'Use `emptyDir` for data that only needs to live as long as the Pod: shared logs, caches, temp files. Data that must survive Pod restarts needs persistent volumes, which come later in the track.',
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
          flush: true,
        },
        after: [
          'Other “secondary” ideas you may hear: **adapter** / **ambassador** patterns are just sidecar *roles* (transform data, or proxy outbound calls) — still ordinary containers in the Pod, not separate API kinds.',
        ],
        callout: {
          kind: 'scope',
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
      'Share files between containers with an **`emptyDir`** volume: created empty with the Pod, deleted with the Pod.',
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
    showBlogStamp: true,
    lede:
      'Every Pod gets an IP on a flat cluster network. **Services** give stable names on top. **NetworkPolicies** act as a firewall so only the Pods you allow can talk. For HTTP from outside, you will also meet **Ingress** and **Gateway API**.',
    sections: [
      {
        id: 'why-network-policy',
        title: 'What problem are we solving?',
        body: [
          'You run three workloads in one namespace: a **`web`** frontend, an **`api`** backend, and a **`batch`** Job that reprocesses data overnight. By default, many clusters allow **all Pod-to-Pod traffic** — so `batch` can open connections to `api` just as easily as `web` can.',
          'That is convenient for demos and dangerous for real apps. You want `web → api` on port 8080, and you want `batch → api` blocked unless you explicitly allow it. A **NetworkPolicy** is how you write that allow-list on top of the cluster network.',
        ],
      },
      {
        id: 'nat-and-cni',
        title: 'NAT and CNI — before the cluster model',
        body: [
          'Two ideas show up constantly in cluster networking. Get them straight before the “every Pod gets an IP” story.',
        ],
        bullets: [
          '**NAT (Network Address Translation)** — rewriting source or destination addresses as packets cross a boundary. Classic example: many private IPs share one public IP outbound. Inside Kubernetes’ usual Pod model, **Pod-to-Pod traffic does not use NAT between Pods** — each Pod IP is supposed to be directly reachable from other Pods. NAT still appears at the **edge** (node → internet, LoadBalancer / Ingress paths, masquerading when Pods leave the cluster).',
          '**CNI (Container Network Interface)** — the plugin interface the kubelet uses to **plug a Pod into the network**: assign an IP, set up routes/bridges/overlays, attach interfaces. Calico, Cilium, Flannel, Amazon VPC CNI, and others are CNI implementations. App YAML almost never names the CNI; the cluster install does. **NetworkPolicy** enforcement also depends on the CNI (or a companion agent) supporting it.',
        ],
        after: [
          'Short version: **CNI builds the Pod network**; **NAT is mostly an edge concern**. The cluster model below assumes a CNI that gives every Pod a routable cluster IP without Pod-to-Pod NAT.',
        ],
      },
      {
        id: 'pod-ip-fabric',
        title: 'The cluster network model',
        body: [
          'In Kubernetes’ usual model, **every Pod gets its own IP**, reachable from other Pods **without NAT between them**. The **CNI** on each node implements that fabric so Pods on node A can reach Pods on node B by Pod IP.',
          'You rarely configure CNI in app YAML — but you rely on it. In practice apps dial a **Service** DNS name more often than a raw Pod IP, because Pod IPs change.',
        ],
        figure: {
          image: podNetworkingImg,
          imageAlt:
            'Hand-drawn sketch of Pods with IPs on a flat network with CNI across nodes',
          caption: 'Pod IPs are real on the cluster network. CNI stitches the nodes together.',
          flush: true,
        },
        after: [
          'Containers in the **same** Pod share one network namespace — `localhost` works between them. Containers in **different** Pods use Pod IPs or Services.',
        ],
        callout: {
          kind: 'scope',
          title: 'Flat network ≠ open trust',
          body: [
            'Pod IPs and Services make reachability easy. They do **not** mean every workload should talk to every other. **NetworkPolicies** add the allow-list on top of the fabric.',
          ],
        },
      },
      {
        id: 'dns-and-services',
        title: 'DNS and Services (quick recap)',
        body: [
          'Pod IPs change. A **Service** gives a stable **DNS name** and **ClusterIP** in front of matching Pods (see the Services reading).',
          'In-cluster clients typically dial `http://api:8080` rather than a Pod IP. That is everyday Kubernetes networking for applications — for example `web` calling the `api` Service.',
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
          flush: true,
        },
        after: [
          'Important nuance: NetworkPolicy behavior depends on the **CNI** supporting it. The object is namespaced; it only affects Pods it selects in that namespace.',
          'A common beginner pattern: select the `api` Pods, `policyTypes: [Ingress]`, allow only from clients with `app: web` on a given port — `batch` is not in the allow list, so it cannot reach `api`.',
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
          kind: 'scope',
          title: 'Allow-lists, not magic deny-all alone',
          body: [
            'Think in allow rules for selected Pods. If nothing selects a Pod, policies usually do not change its traffic. When a Pod is selected for ingress, traffic not matching an allow rule is denied (for supporting CNIs).',
          ],
        },
      },
      {
        id: 'ingress',
        title: 'Ingress (HTTP entry from outside)',
        body: [
          'A **ClusterIP** Service is in-cluster only. **NodePort** / **LoadBalancer** expose a Service, but HTTP apps often need **host/path routing** (many apps, one entry IP) and TLS termination.',
          'An **Ingress** is a Kubernetes API object that declares HTTP (and HTTPS) routing rules: “requests for `shop.example.com/api` go to Service `api:8080`.” It does **not** by itself open a port — something must implement those rules.',
        ],
        code: {
          language: 'yaml',
          code: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop
spec:
  ingressClassName: nginx
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 8080
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 80`,
        },
        after: [
          'Think of Ingress as the **routing wish list**. Without a controller that watches Ingress objects, the rules do nothing.',
        ],
      },
      {
        id: 'ingress-controller',
        title: 'Ingress controller',
        body: [
          'An **Ingress controller** is a cluster component (often a Deployment + Service of type LoadBalancer or NodePort) that **watches Ingress objects** and programs a reverse proxy or load balancer to match them — NGINX Ingress Controller, Traefik, HAProxy, cloud-specific controllers, and others.',
          'You install one (or more) controllers on the cluster. Your app teams create **Ingress** resources that select a class (`ingressClassName`) so the right controller picks them up.',
        ],
        bullets: [
          '**Ingress** = declarative HTTP routes (API object)',
          '**Ingress controller** = the software that makes those routes real',
          '**Service** = still the stable backend the controller forwards to',
        ],
        after: [
          'Different controllers support different annotations and features (rewrites, auth, rate limits). Stick to one controller’s docs for production knobs. Newer clusters may steer new work toward **Gateway API** instead of growing more Ingress annotations.',
        ],
      },
      {
        id: 'gateway-api',
        title: 'Gateway API (next-generation ingress)',
        body: [
          '**Gateway API** is the newer, more expressive set of Kubernetes APIs for traffic into (and across) the cluster. It splits roles more clearly than classic Ingress:',
        ],
        bullets: [
          '**GatewayClass** — which controller / implementation (cluster or infra owned)',
          '**Gateway** — listeners, ports, TLS — “the place traffic enters” (infra / platform)',
          '**HTTPRoute** (and siblings like TCPRoute, GRPCRoute) — host/path rules attaching to a Gateway (often app teams)',
        ],
        after: [
          'Same big idea as Ingress — declare how external HTTP reaches Services — with portable resources, richer matching, and clearer separation between platform and app. Controllers (Istio, Envoy Gateway, NGINX Gateway Fabric, cloud providers, …) implement Gateway API the way Ingress controllers implement Ingress.',
          'For now: know that **Ingress + Ingress controller** is still everywhere; **Gateway API** is the direction many clusters are moving. You do not need every detail on day one — know the names and how they relate to Services.',
        ],
        code: {
          language: 'yaml',
          code: `# Shape only — field sets vary by GatewayClass / controller
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: shop-api
spec:
  parentRefs:
    - name: shop-gateway
  hostnames:
    - shop.example.com
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api
      backendRefs:
        - name: api
          port: 8080`,
        },
      },
    ],
    takeaways: [
      '**CNI** builds the Pod network; **Pod-to-Pod** traffic is usually **without NAT** between Pods. NAT still shows up at the cluster edge.',
      'Pods get IPs on a **flat cluster network**; prefer **Service DNS** over raw Pod IPs.',
      '**NetworkPolicy** restricts who may talk to (or from) labeled Pods — needs a CNI that enforces it.',
      '**Ingress** declares HTTP routes; an **Ingress controller** implements them. **Gateway API** is the newer, role-split successor for the same job.',
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
    showBlogStamp: true,
    lede:
      'CPU and memory are shared on every node. **Requests** reserve capacity so the scheduler can place Pods fairly; **limits** cap how much a container may use. **ResourceQuota** and **LimitRange** keep one namespace from eating the cluster.',
    sections: [
      {
        id: 'why-resources',
        title: 'What problem are we solving?',
        body: [
          'Imagine a user-facing **`storefront`** Deployment and a noisy **`search`** indexer sharing the same nodes. At quiet times both look fine. Then a reindex spike hits — a backlog of documents, a retry storm, a heavy batch of embeddings — and `search` containers start chewing CPU and growing memory.',
          'Without **requests** and **limits**, the scheduler has no honest reservation to work from, and the runtime has no ceiling. `search` can soak the node: `storefront` latency climbs (CPU starvation), or the node runs out of memory and the kubelet starts **OOM-killing** Pods — sometimes the noisy one, sometimes an innocent neighbor. Resource settings are how you keep one workload from quietly eating the other.',
          '**Why eviction happens at all:** a node’s memory (and sometimes disk) is finite. Because the scheduler packs Pods by **requests**, several Burstable workloads can legally share a node and later **use more than they reserved**. When free memory drops too low, the **kubelet** must protect the node — it **evicts** Pods (terminates them to reclaim memory) so the machine does not lock up. That is not the scheduler “moving” a Pod; it is the node shedding load. Controllers may create replacements, which then schedule again elsewhere if capacity exists.',
          'Kubernetes needs two answers per container: **how much should we reserve when scheduling?** and **what is the hard ceiling at runtime?** Namespace-level objects then keep the whole team’s Pods inside a budget. QoS (later) answers a third question: **when the node must evict, who goes first?**',
        ],
      },
      {
        id: 'requests-vs-limits',
        title: 'Requests vs limits',
        body: [
          'On each container you set **resources.requests** and **resources.limits** for CPU and memory.',
          '**Request** — what the scheduler **reserves** when placing the Pod. “I need at least this much to run well.” Nodes that cannot meet the sum of requests will not get the Pod.',
          '**Limit** — the **ceiling**. The container is not allowed to use more than this. CPU over limit is **throttled**; memory over limit often ends in **OOMKill**. A limit is **not** a guarantee that you will get that much — only that you may not go above it.',
          '**What if the limit is bigger than what the node can spare?** That is normal for Burstable Pods. The scheduler places by **requests**, not by limits — so a Pod can land on a node even when its limit is higher than the free capacity left. At runtime it competes for whatever is actually available; it does **not** get moved just because the limit does not “fit.” If memory pressure builds, the kubelet may **OOM-kill** or **evict**; a controller can then create a new Pod, which is scheduled again by requests.',
        ],
        figure: {
          image: requestsLimitsImg,
          imageAlt:
            'Hand-drawn sketch of request as reservation and limit as ceiling for CPU and memory',
          caption: 'Request for scheduling. Limit as a hard cap.',
          flush: true,
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
        after: [
          '**Example — a modest `storefront` container:** reserve a little CPU/memory for scheduling, allow a higher burst ceiling at runtime:',
        ],
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
        callout: {
          kind: 'scope',
          title: 'Request ≠ limit',
          body: [
            '**Request** = reservation the scheduler uses to place the Pod. **Limit** = runtime ceiling. They can differ (Burstable) or match (Guaranteed).',
            'CPU over limit → **throttle**. Memory over limit → risk of **OOMKill**. Set memory limits from observed usage — a too-tight memory limit crashes the app under load.',
          ],
        },
      },
      {
        id: 'qos',
        title: 'QoS classes (how the kubelet prioritizes)',
        body: [
          'From requests/limits, Kubernetes assigns a **Quality of Service (QoS)** class to the Pod. You do not set QoS in YAML directly — it is derived. Remember why eviction exists (from the opening): the node is out of spare memory and the kubelet must reclaim some. QoS does not *cause* eviction — it ranks **who is sacrificed first** when that happens.',
          'Three classes, with examples using the same workloads from earlier:',
        ],
        bullets: [
          '**Guaranteed** — every container has **request == limit** for **both** CPU and memory. Example: a critical checkout helper beside `storefront` that must stay up — `cpu: 100m` / `memory: 128Mi` on both request and limit. The scheduler reserved that much; the ceiling matches. Evicted **last**.',
          '**Burstable** — at least one request is set, but the Pod is not Guaranteed (request below limit, or only some resources set). Example: the `storefront` above — request `100m`/`128Mi`, limit `500m`/`256Mi`. It may burst when the node is idle; under pressure it is safer than BestEffort but not as safe as Guaranteed. **Middle** of the eviction order.',
          '**BestEffort** — **no** requests and **no** limits on any container. Example: a throwaway debug Job with empty `resources`. Cheap to run, first to die when the node is hungry. Evicted **first**.',
        ],
        after: [
          '**Pressure story:** `search` (Burstable) spikes memory, the node runs low, and a BestEffort log-scraper Pod is evicted first. A Guaranteed checkout helper is kept longest. Burstable `storefront` sits in between — it can still be evicted if pressure continues, especially if it is using far above its request.',
          'Prefer **Burstable** or **Guaranteed** for anything user-facing. Leave **BestEffort** for true throwaways. Setting thoughtful requests is not only fairness — it is survival order when the node is hungry.',
        ],
        codes: [
          {
            language: 'yaml',
            code: `# Guaranteed — request == limit (both CPU and memory)
resources:
  requests: { cpu: "100m", memory: "128Mi" }
  limits:   { cpu: "100m", memory: "128Mi" }

# Burstable — can burst above request up to limit
resources:
  requests: { cpu: "100m", memory: "128Mi" }
  limits:   { cpu: "500m", memory: "256Mi" }

# BestEffort — omit resources entirely (or leave both unset)`,
          },
        ],
      },
      {
        id: 'quota-limitrange',
        title: 'ResourceQuota and LimitRange',
        body: [
          '**ResourceQuota** — a **namespace budget**. Caps totals (e.g. sum of CPU requests, memory limits, object counts). New Pods that would break the budget are rejected at create time.',
          '**LimitRange** — **per-object guardrails** in a namespace: default request/limit if the Pod YAML omits them, and/or min/max allowed per container or Pod.',
        ],
        figure: {
          image: quotaLimitRangeImg,
          imageAlt:
            'Hand-drawn sketch of ResourceQuota as namespace budget and LimitRange as per-object defaults and caps',
          caption: 'Quota = how much the namespace may use. LimitRange = defaults and bounds per Pod.',
          flush: true,
        },
        after: [
          '**Example mental model:** Quota says “this namespace may reserve at most 4 CPU and 8Gi memory across all Pods.” LimitRange says “if you omit resources on a container, default to 100m/128Mi request; never allow more than 2 CPU per container.”',
        ],
        callout: {
          kind: 'scope',
          title: 'Quota vs LimitRange',
          body: [
            '**ResourceQuota** = the namespace’s wallet (sum of usage across Pods). **LimitRange** = rules for each Pod/container (defaults, min, max).',
            '“Insufficient cpu” on a Pending Pod can mean the **node** is full — or the **namespace quota** is exhausted. Check both `kubectl describe pod` events and `kubectl describe quota`.',
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
    showBlogStamp: true,
    lede:
      'Probes are health checks the **kubelet** runs against your containers. **Startup** covers slow boots; **readiness** controls Service traffic; **liveness** decides when to restart a stuck process.',
    sections: [
      {
        id: 'why-probes',
        title: 'What problem are we solving?',
        body: [
          'Picture a small storefront stack: a **`search`** service that loads a big in-memory index on boot, a **`storefront`** HTTP app that talks to Redis and Postgres, and a **`thumbnail`** worker that resizes uploads in the background.',
          'A container can be **Running** and still be useless: `search` is still building its index, `storefront` has lost Redis, or `thumbnail`’s worker thread is deadlocked while the process stays up. Kubernetes does not magically know which case you are in.',
          '**Probes** are how you tell the kubelet what “healthy enough” means — and what to do when it is not: wait longer, pull the Pod out of a Service, or restart the container.',
        ],
      },
      {
        id: 'three-probes',
        title: 'Three probes, three jobs',
        body: [
          'You configure up to three probes on a container. Same idea every time — periodic checks — but each answers a different question and triggers a different action.',
        ],
        figure: {
          image: threeProbesImg,
          imageAlt:
            'Hand-drawn sketch: startup, readiness, and liveness probes with a timeline from boot to ready for traffic to restart on fail',
          caption: 'Boot gate → traffic gate → restart gate — along the container’s life.',
          flush: true,
        },
        table: {
          headers: ['Probe', 'Question', 'If it fails'],
          rows: [
            [
              '**Startup**',
              'Has the container finished starting?',
              'Restart after failure threshold; other probes wait until startup succeeds',
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
        callout: {
          kind: 'scope',
          title: 'Running ≠ ready ≠ healthy',
          body: [
            '**Running** only means the process exists. **Readiness** decides traffic. **Liveness** decides restarts. Mixing those jobs is the most common probe bug.',
          ],
        },
      },
      {
        id: 'startup',
        title: 'Startup probe',
        body: [
          'Use a **startup probe** for apps that are **slow to boot** — JVM warmup, loading a search index, warming a local cache, pulling a model into memory.',
          '**Example:** `search` needs up to ~90s before `/startupz` returns OK (index loaded). Set a startup probe with a high `failureThreshold` × `periodSeconds` window. While startup has not succeeded yet, **liveness and readiness do not run** — so an impatient liveness check cannot kill the Pod mid-boot.',
          'Once startup succeeds once, it stops; readiness and liveness take over for the rest of the container’s life.',
        ],
        code: {
          language: 'yaml',
          code: `startupProbe:
  httpGet:
    path: /startupz
    port: 8080
  failureThreshold: 30
  periodSeconds: 5
  # 30 × 5s ≈ 150s window before the kubelet gives up and restarts`,
        },
      },
      {
        id: 'readiness',
        title: 'Readiness probe',
        body: [
          '**Readiness** controls whether the Pod is on **Service Endpoints**. Fail readiness → kube-proxy / EndpointSlice stop sending new traffic; the process can still be alive and doing work.',
          '**Example:** `storefront` temporarily cannot reach Redis. Fail **readiness** so shoppers stop hitting this replica; do **not** fail liveness just because Redis is slow — restarting a healthy process usually makes an outage worse.',
          'Also useful while warming up, or during graceful drain before shutdown. Bad use: “restart me when anything is wrong” — that is liveness’s job.',
        ],
        code: {
          language: 'yaml',
          code: `readinessProbe:
  httpGet:
    path: /readyz
    port: 8080
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3`,
        },
      },
      {
        id: 'liveness',
        title: 'Liveness probe',
        body: [
          '**Liveness** means “this container is wedged — restart it.” After enough failures, the kubelet **restarts the container** (same Pod, new container instance).',
          '**Example:** `thumbnail`’s resize loop is deadlocked; `/livez` stops responding. Liveness fails → restart → often recovers. The process was the problem; killing it is the right hammer.',
          'Keep liveness **cheap and true** — a local check that the process itself is alive. A check that fails because a downstream dependency is slow can restart healthy containers in a loop.',
        ],
        code: {
          language: 'yaml',
          code: `livenessProbe:
  httpGet:
    path: /livez
    port: 8080
  periodSeconds: 15
  timeoutSeconds: 2
  failureThreshold: 3`,
        },
        callout: {
          kind: 'scope',
          title: 'Liveness vs readiness',
          body: [
            '**Readiness fail** = “do not send me traffic.” **Liveness fail** = “kill and restart me.” Point liveness at an external dependency only if failure truly means the process itself is hopeless — usually it does not.',
          ],
        },
      },
      {
        id: 'probe-mechanisms',
        title: 'How probes check',
        body: [
          'Common mechanisms (same for startup / readiness / liveness):',
        ],
        bullets: [
          '**httpGet** — HTTP status from a path (2xx/3xx usually success)',
          '**tcpSocket** — can we open a TCP port?',
          '**exec** — run a command in the container; exit 0 = success',
          '**grpc** — gRPC health check (when supported)',
        ],
        after: [
          'Tune `initialDelaySeconds`, `periodSeconds`, `timeoutSeconds`, `failureThreshold`, and `successThreshold` so checks match real startup and latency — not wishful thinking. For slow boots like `search` loading an index, prefer a **startupProbe** window over cranking `initialDelaySeconds` on liveness forever.',
        ],
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
    showBlogStamp: true,
    lede:
      'A SecurityContext controls how a process runs inside a Pod or container: which user, whether the filesystem is writable, and which Linux capabilities it keeps. It is the everyday YAML for least privilege at the process boundary.',
    sections: [
      {
        id: 'why-security-context',
        title: 'What problem are we solving?',
        body: [
          'Many container images historically started their main process as **root** inside the container. That was convenient for packaging — install packages, bind low ports, write anywhere — and risky if the process is compromised.',
          'Take a generic **`api`** service: it serves HTTP, writes temp files under `/tmp`, and should never need to rewrite its own image filesystem or gain extra Linux powers. If an attacker breaks into that process, you want the blast radius small: not root, not a writable rootfs, not a pile of leftover capabilities.',
          '**SecurityContext** is how you declare those limits on the Pod / container. (Cluster-wide policies like Pod Security Standards can *require* them later — this blog is the per-workload starting point.)',
        ],
        figure: {
          image: whySecurityContextImg,
          imageAlt:
            'Hand-drawn sketch: a container process that starts as root, if compromised, puts host and data at risk',
          caption: 'Limit who the process is and what it can do.',
          flush: true,
        },
        callout: {
          kind: 'scope',
          title: 'What “compromised” means here',
          body: [
            'The container’s process is no longer only doing what you intended — an attacker can run commands as that process. Typical paths: a remote code bug in `api`, a poisoned dependency, or a leaked credential used against a vulnerable endpoint.',
            'SecurityContext does not stop the break-in. It limits the blast radius afterward: not root, not a writable rootfs, not leftover Linux capabilities.',
          ],
        },
      },
      {
        id: 'what-is-security-context',
        title: 'What SecurityContext controls',
        body: [
          'A **SecurityContext** is YAML on a **Pod** and/or **container** that sets process identity and privilege boundaries: UID/GID, non-root, capabilities, read-only root filesystem, privilege escalation, and related settings.',
          'There are two layers you will combine:',
        ],
        bullets: [
          '**Pod `securityContext`** — defaults for the Pod as a whole (common: `runAsUser`, `runAsGroup`, `fsGroup` for volume group ownership)',
          '**Container `securityContext`** — rules for that container’s process (`runAsNonRoot`, `capabilities`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation`, …)',
        ],
        figure: {
          image: securityContextLayersImg,
          imageAlt:
            'Hand-drawn sketch of Pod-level and container-level SecurityContext settings',
          caption: 'Pod defaults + per-container rules.',
          flush: true,
        },
        after: [
          'When both are set, container fields refine that container — check the field docs if you combine them carefully. A sidecar (log shipper, proxy) can be stricter or looser than the main `api` container when needed.',
          '**Example mental model:** Pod says “run as UID 1000 and share volume group 1000.” Each container can still say “non-root, read-only root, drop ALL capabilities.”',
        ],
      },
      {
        id: 'hardening-fields',
        title: 'Common hardening fields',
        body: [
          'A practical set you will see on production-minded Deployments. Think of our `api` container again:',
        ],
        figure: {
          image: hardeningChecklistImg,
          imageAlt:
            'Hand-drawn checklist: non-root, read-only rootfs, drop capabilities, no privilege escalation',
          caption: 'Least privilege for the process inside the container.',
          flush: true,
        },
        table: {
          headers: ['Field', 'Intent', 'Generic example'],
          rows: [
            [
              '`runAsNonRoot: true`',
              'Refuse to start if the process would be root',
              '`api` must not be UID 0 — kubelet fails the container if the image tries',
            ],
            [
              '`runAsUser` / `runAsGroup`',
              'Run as a specific numeric UID/GID',
              '`runAsUser: 1000` matches a non-root user baked into the image',
            ],
            [
              '`readOnlyRootFilesystem: true`',
              'Container root filesystem is read-only',
              '`api` cannot overwrite `/app` binaries; write only where you mount volumes',
            ],
            [
              '`allowPrivilegeEscalation: false`',
              'Block gaining extra privileges (e.g. setuid surprises)',
              'Even if a binary is setuid, the container policy blocks escalation',
            ],
            [
              '`capabilities.drop: [ALL]`',
              'Drop Linux capabilities; add back only what you need',
              'Most HTTP APIs need none; add `NET_BIND_SERVICE` only if you must bind :80 as non-root',
            ],
            [
              '`fsGroup` (Pod)',
              'Volumes owned so the process group can read/write shared mounts',
              'Shared `emptyDir` or PVC readable/writable by GID 1000 across containers',
            ],
          ],
        },
        callout: {
          kind: 'tip',
          title: 'Writable paths',
          body: [
            'Read-only root is great until the app needs `/tmp`, a cache, or upload scratch space. Mount an **emptyDir** (or other volume) at those paths — do not open the whole root filesystem just for temp files.',
          ],
        },
      },
      {
        id: 'security-context-yaml',
        title: 'Putting it together — a hardened api Pod',
        body: [
          'Here is a generic shape: Pod-level identity + container hardening + an `emptyDir` for `/tmp` so the app can still write temp files.',
        ],
        codes: [
          {
            language: 'yaml',
            code: `spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
  containers:
    - name: api
      image: api:1.2
      ports:
        - containerPort: 8080
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
        ],
        after: [
          '**What this buys you:** the process is not root; it cannot rewrite the image filesystem; it has no Linux capabilities by default; it cannot escalate. It *can* write under `/tmp` via the volume.',
          '**What still breaks if misconfigured:** if the image *must* run as root and you set `runAsNonRoot: true`, the container will not start — fix the image (or the UID) rather than turning hardening off casually.',
          'Related topics you may meet later: **Pod Security Standards** / admission policies that require these settings cluster-wide, and **seccomp** / **AppArmor** profiles. SecurityContext is the per-Pod/container starting point.',
        ],
      },
      {
        id: 'when-to-relax',
        title: 'When teams relax a setting (carefully)',
        body: [
          'Hardening is the default goal — but real apps have exceptions. Treat each exception as a conscious trade:',
        ],
        bullets: [
          '**Need to bind port 80/443 as non-root?** Prefer listening on 8080 behind a Service, or add only `NET_BIND_SERVICE` — do not drop back to root.',
          '**Need a writable cache?** Mount a volume at that path; keep `readOnlyRootFilesystem: true`.',
          '**Legacy image only runs as root?** Rebuild or configure the image for a non-root user when you can; temporary exceptions should be tracked, not copied forever.',
          '**Sidecar needs different rules?** Give that container its own `securityContext` — do not weaken the main app to satisfy a helper.',
        ],
        callout: {
          kind: 'warn',
          title: 'Do not “fix” startup failures by deleting SecurityContext',
          body: [
            'If a Pod CrashLoops after hardening, read the events/logs. Common causes: wrong UID, app writing outside mounted volumes, or a capability the process actually needs. Adjust the *specific* field — do not strip the whole context.',
          ],
        },
      },
    ],
    takeaways: [
      '**SecurityContext** sets how the process runs (user, capabilities, filesystem, escalation).',
      'Use **Pod-level** and **container-level** contexts together for defaults + per-container rules.',
      'Common hardening: **non-root**, **read-only root**, **drop ALL capabilities**, **no privilege escalation**.',
      'Give writable **volumes** (e.g. `/tmp`) for paths the app must write — do not relax the whole rootfs casually.',
      'Exceptions should be narrow and intentional — fix images and mounts before turning hardening off.',
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
    showBlogStamp: true,
    lede:
      'A running Pod is not enough when the workload must talk to the Kubernetes API. The cluster needs to know **who** is calling and **what** they may do. ServiceAccounts are the identity; Roles name the powers; RoleBindings connect the two.',
    sections: [
      {
        id: 'why-rbac',
        title: 'What problem are we solving?',
        body: [
          'Ops wants a nightly health digest for Order Processor. A small Job — call it **order-digest** — should ask the cluster: “How many replicas did we want, and how many Pods are Ready?”',
          'That means API calls: **get** the Deployment `order-processor`, and **list** / **get** Pods labeled `app=order-processor`. The Job must **not** delete Deployments, create other Jobs, or read Payment Secrets.',
          'Every API call needs two answers: **who is this?** and **is that allowed?** Without that you get **Forbidden** — or an overly broad `default` identity that can do far more than a digest Job should.',
          'Kubernetes’ answer for Pods is **RBAC** wired through three objects:',
        ],
        bullets: [
          '**ServiceAccount** — identity for processes in Pods (not a human login)',
          '**Role** (or ClusterRole) — the permission rules (resources + verbs)',
          '**RoleBinding** (or ClusterRoleBinding) — attaches those rules to subjects',
        ],
        figure: {
          image: whyRbacImg,
          imageAlt:
            'Hand-drawn sketch: order-digest Job calling the API server and being allowed or Forbidden',
          caption: 'Running code is not enough — the API needs identity and permissions.',
          flush: true,
        },
      },
      {
        id: 'serviceaccount',
        title: 'ServiceAccount — who the Pod is',
        body: [
          'A **ServiceAccount** is a **namespaced** identity for processes in Pods. When `order-digest` calls the API server, it authenticates as its ServiceAccount — not as you, and not as “the node.”',
          'Give the digest its **own** SA and set it on the Job’s Pod template:',
        ],
        codes: [
          {
            language: 'yaml',
            code: `apiVersion: v1
kind: ServiceAccount
metadata:
  name: order-digest
---
# on the Job / Pod template:
spec:
  serviceAccountName: order-digest
  containers:
    - name: digest
      image: order-digest:1.0`,
          },
        ],
        after: [
          'If you omit `serviceAccountName`, the Pod uses the namespace’s **default** ServiceAccount. Fine for demos; unclear and often too broad for a scheduled digest.',
        ],
        figure: {
          image: serviceAccountImg,
          imageAlt:
            'Hand-drawn sketch of a Pod using the order-digest ServiceAccount token to call the API server',
          caption: 'ServiceAccount = API identity for the Pod. The token proves that identity.',
          flush: true,
        },
      },
      {
        id: 'sa-token',
        title: 'What is the token in that picture?',
        body: [
          'The ServiceAccount is the **identity object** in the API (a name in a namespace). The **token** is the **credential** the Pod actually sends when it calls the API — proof of “I am ServiceAccount `order-digest`.”',
          'You do **not** create the token by hand in normal app YAML. When a Pod runs as that ServiceAccount, the **kubelet** mounts a token into the container for you (today: a short-lived **projected** ServiceAccount token; older clusters used a long-lived token Secret). Client libraries (and `kubectl` in-cluster) read that file automatically.',
          'So: **SA = who you are. Token = the pass the process presents.** The token is a byproduct of using the ServiceAccount on the Pod — not a separate kind of “login” you invent beside the SA.',
        ],
        bullets: [
          '**Bound to one SA** — the token says which ServiceAccount this is',
          '**Mounted into the Pod** — usually under `/var/run/secrets/kubernetes.io/serviceaccount/`',
          '**Not the same as RBAC** — the token proves identity; **Role + RoleBinding** still decide what is allowed',
          '**Short-lived on modern clusters** — rotated automatically; treat it like a password file, not something to commit to git',
        ],
        callout: {
          kind: 'scope',
          title: 'Identity ≠ permissions',
          body: [
            'Creating ServiceAccount `order-digest` (and receiving its token) does **not** grant API powers. **Role + RoleBinding** do. An SA with a token but no binding usually cannot do anything useful at the API — it only proves *who* is calling.',
          ],
        },
      },
      {
        id: 'role',
        title: 'Role — what is allowed (in a namespace)',
        body: [
          'A **Role** lists **rules**: which API groups, resources, and verbs are allowed — scoped to **one namespace**.',
          'For the digest, allow only what the health check needs — read the Deployment and read Pods (not Secrets, not delete):',
        ],
        codes: [
          {
            language: 'yaml',
            code: `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: order-digest-reader
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]`,
          },
        ],
        after: [
          '**ClusterRole** is the same shape of rules but **cluster-scoped** (or reusable across namespaces via binding). Use a namespaced **Role** when the work stays in one namespace — like `order-digest` watching Order Processor in its app namespace. Reach for ClusterRole when the task truly needs cluster scope (nodes, all namespaces, and so on).',
          'A Role by itself is only a document. Nothing can use those permissions until a **binding** attaches it to a subject.',
        ],
        callout: {
          kind: 'scope',
          title: 'Role vs ClusterRole',
          body: [
            'Same rule shape. **Role** = one namespace. **ClusterRole** = cluster-wide rules (or a reusable rule set you bind into namespaces). For `order-digest`, a namespaced Role is enough — it only needs Deployment and Pod reads in its app namespace.',
          ],
        },
      },
      {
        id: 'rolebinding',
        title: 'RoleBinding — connect identity to a Role',
        body: [
          'A **RoleBinding** says: these **subjects** (ServiceAccounts, users, or groups) get the permissions of this **Role** in this namespace.',
          'Wire **order-digest** → **order-digest-reader**. Without a binding, the Role is unused. Without a Role, the binding has nothing useful to grant.',
        ],
        figure: {
          image: roleRoleBindingImg,
          imageAlt:
            'Hand-drawn sketch of order-digest ServiceAccount bound to order-digest-reader Role via RoleBinding',
          caption: 'Binding links who → what they may do.',
          flush: true,
        },
        after: [
          'Putting it together — SA + Role + RoleBinding in one apply:',
        ],
        codes: [
          {
            language: 'yaml',
            code: `apiVersion: v1
kind: ServiceAccount
metadata:
  name: order-digest
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: order-digest-reader
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: order-digest-reader
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: order-digest-reader
subjects:
  - kind: ServiceAccount
    name: order-digest
    # namespace: defaults to this RoleBinding's namespace`,
          },
        ],
        tableAfter: {
          headers: ['Object', 'In our story', 'Job'],
          rows: [
            ['ServiceAccount', '`order-digest`', 'Identity for the digest Pod'],
            ['Token (mounted)', '(auto for that SA)', 'Credential that proves the identity'],
            ['Role', '`order-digest-reader`', 'Permission rules'],
            ['RoleBinding', '`order-digest-reader`', 'Attach Role → SA'],
            ['ClusterRole', '(not needed here)', 'Cluster-scoped rules'],
            ['ClusterRoleBinding', '(not needed here)', 'Attach ClusterRole → subjects'],
          ],
        },
      },
      {
        id: 'least-privilege',
        title: 'Least privilege in practice',
        body: [
          'Give each automation its **own** ServiceAccount and the **smallest** verb/resource set it needs — exactly what `order-digest` does: read Deployment + Pods, nothing else.',
          'Prefer namespaced **Role** + **RoleBinding** when possible. Reach for ClusterRole / ClusterRoleBinding only when the task truly needs cluster scope.',
          'Do not reuse **default** for scheduled Jobs — audits and incidents become harder when every Pod shares one identity.',
        ],
        callout: {
          kind: 'scope',
          title: 'Avoid the default ServiceAccount',
          body: [
            'Do not park scheduled Jobs on the namespace **default** SA. Give each automation its own identity and the smallest verb set it needs — audits stay readable when every Pod is not “just default.”',
            'Debug tip: `kubectl auth can-i get deployments.apps --as=system:serviceaccount:<ns>:order-digest` checks whether that SA may read Deployments when the Job gets Forbidden.',
          ],
        },
      },
    ],
    takeaways: [
      'API calls need **who** (ServiceAccount + token) and **what is allowed** (Role + binding) — a running Pod alone is not enough.',
      'The **token** is the credential mounted for that SA — a byproduct of using the ServiceAccount, not a separate login you invent.',
      'Story: **order-digest** reads Order Processor status; it should not hold Payment Secrets or delete Deployments.',
      '**ServiceAccount** = Pod’s identity at the API; omit it and you get namespace **default**.',
      '**Role** / **ClusterRole** = permission rules; **RoleBinding** / **ClusterRoleBinding** attach them to subjects.',
      'Prefer dedicated SAs and **least privilege** over a shared **default** SA.',
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
          'You need a deliberate answer: *where should the bytes live, and how does the Pod see them?* That answer starts with a **Volume**.',
        ],
      },
      {
        id: 'what-is-a-volume',
        title: 'What is a Volume?',
        body: [
          'Containers are ephemeral. Their writable layer is tied to that container’s life. To keep (or deliberately place) bytes somewhere the app can use, Kubernetes lets you attach **storage to the Pod** and mount it into containers.',
          'A **Volume** is that storage attachment on a **Pod**. You mount it into one or more containers at a path on the container filesystem — for example `/data/uploads`. From the app’s point of view it is just a normal directory.',
          'Two pieces of YAML wire this up:',
        ],
        bullets: [
          '**`spec.volumes`** — name the storage on the Pod (e.g. `uploads`)',
          '**`volumeMounts`** — mount that named storage into a container at a **mount path** (e.g. `/data/uploads`)',
        ],
        codes: [
          {
            language: 'yaml',
            code: `spec:
  containers:
    - name: api
      image: api:1.2
      volumeMounts:
        - name: uploads
          mountPath: /data/uploads   # path inside the container
  volumes:
    - name: uploads
      # backend goes here — emptyDir, PVC, … (next section)`,
          },
        ],
        figure: {
          image: whatIsAVolumeImg,
          imageAlt:
            'Hand-drawn sketch of a Pod with a container mounting a volume at /data',
          caption: 'Image = app. Volume = storage block on the Pod, mounted at a path.',
          flush: true,
        },
        after: [
          'The same `name` ties them together. Several containers in **one** Pod can mount the **same** Volume (for example the app and a log sidecar) and see the same files.',
          '**Where the bytes live (in general):** the container always sees a directory at the mount path. The Volume kind decides the **backend** behind that directory — scratch space on the node, files from a ConfigMap, a path on the host, a durable disk via a PVC, and so on. The kubelet on the node performs the mount into the container. What actually stores the data depends on the kind (next section).',
        ],
      },
      {
        id: 'volume-kinds',
        title: 'Volume kinds — how the Pod gets the bytes',
        body: [
          'The mount story is always the same: Volume on the Pod → `volumeMounts` → path inside the container. The **kind** under `spec.volumes` says what backs that path — where the bytes really live, and who manages them.',
        ],
        figure: {
          image: volumeKindsImg,
          imageAlt:
            'Hand-drawn map of common volume kinds: emptyDir, configMap/secret, hostPath, PVC, projected',
          caption: 'Same mount mechanism. Different backends.',
          flush: true,
        },
        after: [
          '**emptyDir** — Scratch space for **this Pod only**. **Where it lives:** a directory on the **node’s local disk** (or tmpfs in RAM if `medium: Memory`), under the kubelet’s Pod directories. **Who manages it:** the **kubelet** creates it when the Pod is scheduled and deletes it when the Pod is removed. Shared by containers in that Pod; **not** shared across replicas. Good for temp files, caches, shared sidecar logs — not for data that must survive Pod delete.',
          '**configMap / secret** — Mount configuration or credentials as **files** (one key → one file). **Where it lives:** data is stored as a **ConfigMap or Secret API object** in the cluster (etcd); kubelet materializes it as files in the mount. Same object can be mounted by many Pods. You can also inject these as env — volume mounts matter when the app expects files.',
          '**hostPath** — A path from the **Node** filesystem. **Where it lives:** whatever directory you name on that machine’s disk. **Who manages it:** you (or the platform) own that host path; kubelet only bind-mounts it in. Powerful for demos and some node agents; risky for normal apps (Pods move nodes; security). Usually platform / privileged territory.',
          '**persistentVolumeClaim** — Mount durable storage by referencing a **PVC** by name. **Where it lives:** the storage behind the bound **PV** (cloud disk, NFS, lab disk, …) — not the container layer and not “just a scratch folder.” **Who manages it:** platform / CSI provisioner supplies the PV; the app team creates the PVC; kubelet attaches/mounts it for the Pod. This is the main app path for data that must outlive a Pod. Across replicas, sharing depends on access mode (and is covered with PVs / PVCs below).',
          '**projected** — Combine several sources (ServiceAccount token, CA cert, ConfigMap, …) into **one** directory. **Where it lives:** each source keeps its own home (API objects / projected token files); kubelet assembles them into a single mount. Common for in-cluster API auth.',
        ],
        tableAfter: {
          headers: ['Kind', 'Where the bytes live', 'Survives Pod delete?', 'Typical use'],
          rows: [
            ['emptyDir', 'Node local disk (or RAM) via kubelet', 'No', 'Scratch, shared sidecar files'],
            [
              'configMap / secret',
              'API object in the cluster → files in the mount',
              'No (rebuilt from API object)',
              'Config and credential files',
            ],
            ['hostPath', 'A path on that Node’s filesystem', 'On the node — not portable', 'Node agents / special cases'],
            [
              'persistentVolumeClaim',
              'Disk/backend behind the bound PV',
              'Yes (disk lives with PV)',
              'App data, databases, uploads',
            ],
            ['projected', 'Mixed sources, one assembled mount', 'No', 'Tokens + certs as one mount'],
          ],
        },
        callout: {
          kind: 'scope',
          title: 'NFS and other persistent backends',
          body: [
            'A PVC does not invent disk by itself — something **behind** the PV stores the bytes. Common backends: **cloud disks** (EBS, Azure Disk, PD) via a **CSI** driver, **NFS** / other network filesystems, or lab-only host paths.',
            '**NFS-style** storage is what you usually need for **ReadWriteMany (RWX)** — many Pods on many nodes sharing one filesystem. A typical cloud disk is **RWO** (one node at a time). Same PVC mount story; different backend capabilities.',
          ],
        },
        codes: [
          {
            language: 'yaml',
            code: `# Same mountPath idea every time — only the backend changes.

# emptyDir — kubelet scratch on the node (dies with the Pod)
volumes:
  - name: scratch
    emptyDir: {}

# config as files — bytes live in the ConfigMap API object
volumes:
  - name: cfg
    configMap:
      name: api-config

# hostPath — bytes live at a path on this Node
volumes:
  - name: agent-data
    hostPath:
      path: /var/lib/my-agent

# durable storage — bytes live on the PV behind this claim
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
          kind: 'scope',
          title: 'Why the split?',
          body: [
            'App teams should not need cluster-admin rights to carve cloud disks. They **request** (PVC). Platform **supplies** (PV or StorageClass + CSI). Binding connects the two — that is the whole point of the PV / PVC split.',
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
          '**StatefulSets** — stable Pod identity + per-replica disks (`volumeClaimTemplates`). Covered in the next reading.',
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
      'Containers are ephemeral — attach a **Volume** to the Pod and **mount** it at a path (e.g. `/data/uploads`).',
      'The mount path is always a directory in the container; the **kind** decides where bytes really live (node scratch, API object, host path, PV behind a PVC, …).',
      '**emptyDir** is kubelet-managed node scratch and dies with the Pod; durable data uses a **PVC**.',
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
        challengeId: 'k8s-22-dynamic-disks-via-storageclass',
        label: 'Dynamic Disks via StorageClass',
      },
    ],
  },
  {
    id: 'statefulsets',
    slug: 'statefulsets',
    trackId: 'B12',
    eyebrow: '',
    title: 'StatefulSets',
    showBlogStamp: true,
    lede:
      'Deployments treat Pods as interchangeable copies. Databases and other sticky workloads need **stable names**, **stable DNS**, and **their own disks**. That is what a **StatefulSet** is for — and why you do not run Postgres behind a plain Deployment.',
    sections: [
      {
        id: 'why-statefulsets',
        title: 'What problem are we solving?',
        body: [
          'QuickByte’s **Order Processor** can run as three Deployment Pods. Any healthy copy can take the next request. If one dies, a replacement with a **new random name** is fine — there is no “which Order Processor am I?” story that matters.',
          'Now add **orders-db**: a small Postgres for order history. Copies are **not** interchangeable:',
        ],
        bullets: [
          'Each copy needs a **stable identity** — ops and peers must always know which is `orders-db-0` vs `orders-db-1`',
          'Each copy needs **its own disk** — so one replacement Pod does not wipe or collide with another’s data',
          'Peers often talk to a **specific** member by name (replication, failover, admin)',
        ],
        after: [
          'A Deployment gives throwaway Pod names (`orders-db-7f9c…`) and shares one PVC awkwardly across replicas (or worse, each Pod mounts nothing durable). You need a workload type built for **identity + sticky storage**.',
        ],
        callout: {
          kind: 'idea',
          title: 'Stateless vs sticky',
          body: [
            '**Stateless** (typical Deployment): any replica can serve the request; losing a Pod loses in-flight work, not a named role.',
            '**Sticky / stateful** (StatefulSet): the Pod’s **ordinal** and **disk** are part of the app’s design — replace `orders-db-0` and you still want the *same* identity and volume back.',
          ],
        },
      },
      {
        id: 'deployment-gap',
        title: 'Why a Deployment is a poor fit',
        body: [
          'A **Deployment** answers: keep **N** identical Pods of this template, and roll the template forward safely.',
          'It does **not** promise:',
        ],
        bullets: [
          'Stable Pod names across restarts',
          'A predictable DNS name per Pod',
          'A dedicated PVC that follows each ordinal',
          'Ordered start / scale (0 before 1 before 2)',
        ],
        after: [
          'You *can* bolt storage onto a Deployment with one shared PVC — but RWO disks and “who owns the data?” fight you the moment you scale. For databases, message brokers, and similar systems, teams reach for a **StatefulSet**.',
        ],
      },
      {
        id: 'what-is-a-statefulset',
        title: 'What is a StatefulSet?',
        body: [
          'A **StatefulSet** is a controller for Pods that need **stable identity**. Like a Deployment, you declare `replicas`, a `selector`, and a Pod `template`. Unlike a Deployment, each Pod gets a **fixed ordinal** in its name and (usually) its **own** storage from a claim template.',
        ],
        flows: [
          {
            title: 'Who owns what',
            steps: ['StatefulSet', 'Pods (…-0, …-1, …)', 'PVCs per ordinal'],
          },
        ],
        tableAfter: {
          headers: ['Piece', 'Role'],
          rows: [
            ['`spec.replicas`', 'How many sticky members (e.g. 2)'],
            ['`spec.serviceName`', 'Governing Service name used for stable per-Pod DNS'],
            ['`spec.selector` + `template`', 'Same label idea as Deployments'],
            [
              '`spec.volumeClaimTemplates`',
              'Recipe: create one PVC per Pod ordinal automatically',
            ],
          ],
        },
        callout: {
          kind: 'scope',
          title: 'Still a controller',
          body: [
            'StatefulSet reconciles desired vs current count like other controllers. The difference is **how** replacements are named and **which disk** they remount — identity is first-class, not an accident of scheduling.',
          ],
        },
      },
      {
        id: 'stable-identity',
        title: 'Stable Pod identity',
        body: [
          'If the StatefulSet is named `orders-db` with `replicas: 2`, Kubernetes creates Pods named **`orders-db-0`** and **`orders-db-1`** — not random suffixes.',
          'Delete `orders-db-0` and the controller recreates **`orders-db-0`** again (same name). That ordinal is the sticky handle apps and humans use.',
        ],
        table: {
          headers: ['Workload', 'Example Pod names'],
          rows: [
            ['Deployment `order-processor`', '`order-processor-6cb64d76df-5rz5c` (random)'],
            ['StatefulSet `orders-db`', '`orders-db-0`, `orders-db-1` (ordinals)'],
          ],
        },
        after: [
          'Ordinals also drive **order**: by default members come up `0`, then `1`, then `2`, and scale down in reverse. That matters for clustered software that elects a primary or expects peers in sequence.',
        ],
      },
      {
        id: 'stable-network',
        title: 'Stable network identity (`serviceName`)',
        body: [
          'A StatefulSet’s ordinal names (`orders-db-0`, `orders-db-1`) are only half of discoverability. Clients need **DNS** that points at a **specific** member — not a random healthy one.',
          'That is why the StatefulSet declares `spec.serviceName` (e.g. `orders-db`). It names the **governing Service** that will be the DNS parent for each Pod. The Service object itself is **not** created by the StatefulSet — you (or a later lab) must apply it with that exact name.',
        ],
        after: [
          'Until that Service exists and selects the Pods, the sticky **Pod names** still work for `kubectl`, but the stable **per-Pod DNS** story is incomplete.',
        ],
      },
      {
        id: 'headless-service',
        title: 'Why a headless Service (not a normal ClusterIP)',
        body: [
          'For **Order Processor**, a normal **ClusterIP** Service is perfect: clients call one name, kube-proxy **load-balances** across any healthy Pod, and you do not care which replica answers.',
          'For **orders-db**, that pattern is often wrong. Ops and apps frequently need one specific member:',
        ],
        bullets: [
          'Always talk to `orders-db-0` for a primary / bootstrap role',
          'Point a backup job at `orders-db-1`',
          'Debug or migrate **one** copy without bouncing across both',
        ],
        after: [
          'A ClusterIP Service hides Pod identity behind a single VIP. You get a **random** healthy backend — not “the Pod named `orders-db-0`.”',
          'A **headless** Service sets `clusterIP: None`. Kubernetes does **not** allocate a ClusterIP. Together with the StatefulSet, cluster DNS publishes **stable names per Pod**:',
        ],
        table: {
          headers: ['Service type', '`clusterIP`', 'Client sees'],
          rows: [
            [
              'Normal ClusterIP',
              'A real VIP',
              'One name → random healthy Pod',
            ],
            [
              'Headless',
              '`None`',
              'Per-Pod DNS (with StatefulSet)',
            ],
          ],
        },
        tableAfter: {
          headers: ['Pod', 'Example DNS (same namespace)'],
          rows: [
            [
              '`orders-db-0`',
              '`orders-db-0.orders-db.<namespace>.svc.cluster.local`',
            ],
            [
              '`orders-db-1`',
              '`orders-db-1.orders-db.<namespace>.svc.cluster.local`',
            ],
          ],
        },
        codes: [
          {
            language: 'yaml',
            code: `apiVersion: v1
kind: Service
metadata:
  name: orders-db          # must match StatefulSet serviceName
spec:
  clusterIP: None          # headless
  selector:
    app: orders-db
  ports:
    - name: postgres
      port: 5432
      targetPort: 5432`,
          },
        ],
        callout: {
          kind: 'tip',
          title: 'Name must match',
          body: [
            'Service `metadata.name` must equal the StatefulSet’s `spec.serviceName`. Selector labels must match the Pod template labels — otherwise Endpoints stay empty and DNS has nothing to point at.',
          ],
        },
      },
      {
        id: 'volume-claim-templates',
        title: 'Per-replica disks: `volumeClaimTemplates`',
        body: [
          'You already know **PVC = namespaced request** and **PV = disk offer**. A StatefulSet can declare a **template** for claims instead of one shared PVC:',
          'For each ordinal, the controller creates a PVC (commonly named like `data-orders-db-0`, `data-orders-db-1`) and mounts it into that Pod. When `orders-db-0` is recreated, it remounts **the same** claim — the data stays with the identity.',
        ],
        bullets: [
          '**One disk per member** — no “three writers on one RWO PVC” fight',
          '**Disk follows the ordinal** — replace the Pod, keep the volume',
          'StorageClass / size / access mode live on the **template** (same ideas as a hand-written PVC)',
        ],
        after: [
          'This is the storage half of “why StatefulSet exists.” Identity without sticky disks is only half the story for a database.',
        ],
      },
      {
        id: 'vs-deployment',
        title: 'Deployment vs StatefulSet',
        body: [
          'Same family of ideas (replicas, labels, Pod template). Different promise.',
        ],
        table: {
          headers: ['', 'Deployment', 'StatefulSet'],
          rows: [
            [
              'Pod names',
              'Random suffixes',
              'Stable ordinals (`name-0`, `name-1`)',
            ],
            [
              'Best for',
              'Stateless APIs, workers, web frontends',
              'Databases, brokers, anything with sticky members',
            ],
            [
              'Storage',
              'Optional shared / one PVC (scale carefully)',
              '`volumeClaimTemplates` → one PVC per ordinal',
            ],
            [
              'DNS story',
              'Usually one Service → any Pod',
              'Per-Pod DNS via governing Service',
            ],
            [
              'Rollouts',
              'Rolling update of interchangeable Pods',
              'Ordered updates (identity-aware)',
            ],
            [
              'Default choice?',
              'Yes for most apps',
              'Only when identity + sticky disks matter',
            ],
          ],
        },
        callout: {
          kind: 'warn',
          title: 'Do not “upgrade” everything to StatefulSet',
          body: [
            'StatefulSets are heavier to operate (ordered changes, per-Pod claims, careful scale-down). If Pods are truly interchangeable, keep a **Deployment**.',
          ],
        },
      },
      {
        id: 'yaml-sketch',
        title: 'YAML sketch — orders-db',
        body: [
          'Shape you will use in the lab: StatefulSet + `serviceName` + `volumeClaimTemplates`. The matching headless Service comes next in the track.',
        ],
        codes: [
          {
            language: 'yaml',
            code: `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: orders-db
spec:
  serviceName: orders-db          # governing Service name
  replicas: 2
  selector:
    matchLabels:
      app: orders-db
      tier: data
  template:
    metadata:
      labels:
        app: orders-db
        tier: data
    spec:
      securityContext:
        fsGroup: 70               # alpine postgres
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          env:
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: gp2
        resources:
          requests:
            storage: 500Mi`,
          },
        ],
        after: [
          'After apply you should see Pods `orders-db-0` / `orders-db-1` and PVCs for each — not one shared claim for both. Pin `storageClassName` (e.g. `gp2` on EKS) when the cluster has no default class. Use `PGDATA` under a subdirectory so the volume root is not the data directory.',
        ],
      },
      {
        id: 'when-to-use',
        title: 'When to use a StatefulSet',
        body: ['Reach for a StatefulSet when most of these are true:'],
        bullets: [
          'Members are **not** interchangeable (roles, replication, quorum)',
          'You need **stable network identity** per member',
          'Each member needs **its own durable disk**',
          'Ordered deploy / scale matters to the software',
        ],
        after: [
          'Stay on a **Deployment** for request-serving APIs, batch workers, and anything where a random new Pod is a perfect substitute.',
          'Managed database services outside the cluster are also fine — StatefulSet is the in-cluster pattern when *you* run the sticky software.',
        ],
      },
    ],
    takeaways: [
      '**Deployments** assume interchangeable Pods; **StatefulSets** assume sticky **identity**.',
      'Pods get stable ordinal names (`orders-db-0`, `orders-db-1`) that survive recreation.',
      '`serviceName` names the **governing Service**; you still create that Service yourself.',
      'Use a **headless** Service (`clusterIP: None`) so DNS resolves to **each Pod**, not a load-balanced VIP.',
      '`volumeClaimTemplates` give **one PVC per ordinal** — disk follows the member.',
      'Use StatefulSets for databases and similar sticky systems — not as a default for every app.',
    ],
    relatedLabs: [
      {
        challengeId: 'k8s-20-stateful-orders-database',
        label: 'Stateful Orders Database',
      },
      {
        challengeId: 'k8s-21-discover-each-database-pod-by-name',
        label: 'Discover Each Database Pod by Name',
      },
    ],
  },
  {
    id: 'scheduling-affinity-taints',
    slug: 'scheduling-affinity-taints',
    trackId: 'B13',
    eyebrow: '',
    title: 'Where Pods Land: Selectors, Affinity, and Taints',
    showBlogStamp: true,
    lede:
      'By default the scheduler places Pods wherever capacity fits. Production often needs more: pin payments to a pool, prefer notification nodes without risking Pending, colocate chatty services, spread replicas, or reserve PCI machines. That toolbox is **nodeSelector**, **affinity**, and **taints / tolerations**.',
    sections: [
      {
        id: 'why-scheduling',
        title: 'What problem are we solving?',
        body: [
          'Kubernetes already decides *whether* a Pod fits a node (CPU/memory requests, ports, …). It does **not** know your org rules unless you declare them:',
        ],
        bullets: [
          'Payment Handler must stay on **payment** workers (PCI / dedicated NICs)',
          'Notification prefers a tuned pool, but must still run if that pool is full',
          'Under a lunch rush, Notification should sit **near** Order Processor when possible',
          'Payment replicas should not all die when **one** node reboots',
          'Ordinary apps must **not** land on tainted PCI machines',
        ],
        after: [
          'Those rules live on the **Pod template** (and sometimes on the **node**). Soft rules score preferences; hard rules reject nodes. Mixing them carefully is the whole game.',
        ],
        callout: {
          kind: 'idea',
          title: 'Two directions of control',
          body: [
            '**Pod → node** — “I only / prefer nodes with these labels” (`nodeSelector`, node affinity) or “I prefer / avoid nodes that already run Pods like *that*” (pod affinity / anti-affinity).',
            '**Node → Pod** — “I repel ordinary workloads; only Pods with a matching pass may land” (**taints** + **tolerations**).',
          ],
        },
      },
      {
        id: 'pci-pool',
        title: 'QuickByte side note: what “PCI nodes” means',
        body: [
          'In these labs **PCI** is story language for **Payment Card Industry** rules — how card-handling systems are expected to be isolated. It is **not** a Kubernetes API object.',
          'QuickByte’s platform keeps a **payment / PCI pool** of workers (tighter reviews, dedicated networking). Two complementary rules show up in the track:',
        ],
        bullets: [
          '**Pin Payment on** that pool — hard `nodeSelector` / affinity on labels like `workload=payments` (Pods choose the pool)',
          '**Keep everyone else off** — taint the pool (`pci=true:NoSchedule`) and give Payment a **toleration** (nodes repel; Payment opts in)',
        ],
        after: [
          'Labels and taints are what the scheduler actually reads. “PCI” is why ops marked those machines that way.',
        ],
      },
      {
        id: 'node-labels',
        title: 'Node labels — the shared vocabulary',
        body: [
          'Nodes carry **labels** the platform (or you) sets — e.g. `workload=payments`, `workload=notifications`, `pci=true`. Pods do not invent pools; they **select** or **prefer** those labels.',
          'Inspect before you write YAML:',
        ],
        codes: [
          {
            language: 'bash',
            code: `kubectl get nodes --show-labels
kubectl get nodes -L workload,pci
kubectl get pods -o wide`,
          },
        ],
        after: [
          'Without honest labels, every selector and affinity rule is guessing. Labeling nodes is usually a **platform** job; app YAML only consumes them.',
        ],
      },
      {
        id: 'nodeselector',
        title: 'nodeSelector — the hard pin',
        body: [
          '`nodeSelector` is the simplest rule: the Pod may land **only** on nodes that have **all** listed labels. Miss the pool → Pending.',
          'QuickByte example: Payment Handler must run on `workload=payments` — not notifications, not general.',
        ],
        codes: [
          {
            language: 'yaml',
            code: `spec:
  template:
    spec:
      nodeSelector:
        workload: payments
      containers:
        - name: payment-handler
          image: payment-handler:v1.0`,
          },
        ],
        callout: {
          kind: 'warn',
          title: 'Hard means hard',
          body: [
            'If no payment-labeled node has capacity, replicas stay **Pending**. That is correct for PCI pinning — and wrong for a queue worker you would rather run “somewhere” during a festival rush.',
          ],
        },
        after: [
          '`nodeSelector` only supports simple equality (`key: value`). For operators (`In`, `NotIn`, `Exists`) or soft preferences, use **node affinity**.',
        ],
      },
      {
        id: 'node-affinity',
        title: 'Node affinity — hard or soft on node labels',
        body: [
          '**Node affinity** still talks about **node labels**, but with richer matchers and an explicit soft vs hard choice.',
        ],
        table: {
          headers: ['Mode', 'Field', 'If no match / no room'],
          rows: [
            [
              'Hard',
              '`requiredDuringSchedulingIgnoredDuringExecution`',
              'Pod stays Pending',
            ],
            [
              'Soft',
              '`preferredDuringSchedulingIgnoredDuringExecution`',
              'Scheduler scores preferred nodes higher, then places elsewhere',
            ],
          ],
        },
        after: [
          'Soft preferences carry a **weight** (1–100). Higher weight = stronger nudge among preferred rules. Soft never blocks scheduling by itself.',
          'QuickByte: Notification is happier on `workload=notifications`, but SMS must not sit Pending if that pool is full — use **preferred** node affinity and **remove** a hard `nodeSelector`.',
        ],
        codes: [
          {
            language: 'yaml',
            code: `spec:
  template:
    spec:
      # no nodeSelector — soft preference only
      affinity:
        nodeAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              preference:
                matchExpressions:
                  - key: workload
                    operator: In
                    values: ["notifications"]
      containers:
        - name: notification-service
          image: notification-service:v1.0`,
          },
        ],
        callout: {
          kind: 'tip',
          title: 'nodeSelector vs required nodeAffinity',
          body: [
            'For a single label equality, `nodeSelector: workload: payments` and required node affinity with `In: [payments]` do the same job. Prefer `nodeSelector` when that is enough; reach for affinity when you need soft rules, `NotIn`, or several expressions.',
          ],
        },
      },
      {
        id: 'pod-affinity',
        title: 'Pod affinity — prefer near other Pods',
        body: [
          'Sometimes the rule is not “which **node pool**?” but “where is **that other app** already running?”',
          '**Pod affinity** scores (or requires) nodes based on **other Pods’ labels** in a topology domain — usually the same machine (`topologyKey: kubernetes.io/hostname`).',
          'QuickByte Friday lunch rush: Order Processor is healthy, but confirmation SMS lags because Notification often lands on a **different** node. Soft **pod affinity** toward `app=order-processor` prefers the same hostname when capacity allows.',
        ],
        codes: [
          {
            language: 'yaml',
            code: `affinity:
  podAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          topologyKey: kubernetes.io/hostname
          labelSelector:
            matchLabels:
              app: order-processor`,
          },
        ],
        callout: {
          kind: 'idea',
          title: 'Node affinity ≠ pod affinity',
          body: [
            '**Node affinity** → match **node** labels (`workload=notifications`).',
            '**Pod affinity** → match **Pod** labels (`app=order-processor`) inside a topology (same node, same zone, …).',
            'Same soft/hard verbs (`preferred…` / `required…`). Different question.',
          ],
        },
      },
      {
        id: 'pod-anti-affinity',
        title: 'Pod anti-affinity — spread copies apart',
        body: [
          '**Anti-affinity** is the opposite nudge: prefer (or require) **not** sharing a topology with Pods that match a selector — often **yourself**.',
          'QuickByte outage: both Payment Handler replicas landed on one node; that node rebooted and payments died cluster-wide. Soft **pod anti-affinity** on `app=payment-handler` with `topologyKey: kubernetes.io/hostname` prefers one replica per node when capacity allows.',
        ],
        codes: [
          {
            language: 'yaml',
            code: `affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          topologyKey: kubernetes.io/hostname
          labelSelector:
            matchLabels:
              app: payment-handler`,
          },
        ],
        after: [
          'On a tiny or single-node cluster, **required** anti-affinity can leave replicas Pending. Labs (and many prod policies) start **soft** so the service still runs when spread is impossible.',
        ],
        callout: {
          kind: 'tip',
          title: '`topologyKey` in one line',
          body: [
            '`kubernetes.io/hostname` ≈ same / different **node**.',
            '`topology.kubernetes.io/zone` ≈ same / different **AZ**.',
            'Affinity and anti-affinity always answer “same topology domain as which Pods?” — the key picks the size of that domain.',
          ],
        },
      },
      {
        id: 'soft-vs-hard',
        title: 'Soft vs hard — pick deliberately',
        body: ['Use this as a gut check before you paste `required…`:'],
        table: {
          headers: ['Need', 'Prefer'],
          rows: [
            ['Must never leave the pool (PCI pin)', 'Hard: `nodeSelector` or required node affinity'],
            ['Happier on a pool, but must stay up', 'Soft: preferred node affinity'],
            ['Faster when near another app', 'Soft: preferred pod affinity'],
            ['Survive one node death', 'Soft: preferred pod anti-affinity (start soft)'],
            ['Absolutely never share a node', 'Hard anti-affinity — only if you have enough nodes'],
          ],
        },
        callout: {
          kind: 'warn',
          title: 'IgnoredDuringExecution',
          body: [
            'The long names end in `IgnoredDuringExecution`: if labels change **after** the Pod is running, Kubernetes does **not** evict it for affinity. The rule applies at **schedule** time. (Taints with `NoExecute` are a different story — next section.)',
          ],
        },
      },
      {
        id: 'taints-tolerations',
        title: 'Taints and tolerations — the node’s “keep out” sign',
        body: [
          'Selectors and affinity are the Pod **choosing** nodes. **Taints** are the node **repelling** Pods.',
          'A taint is `key=value:effect` on the node. A Pod needs a matching **toleration** to be allowed onto that node (for schedule-blocking effects). Without it, the scheduler skips the node — even if labels would otherwise match.',
        ],
        table: {
          headers: ['Effect', 'Meaning'],
          rows: [
            ['`NoSchedule`', 'New Pods without a matching toleration will not schedule here'],
            ['`PreferNoSchedule`', 'Soft “please avoid” — scheduler tries elsewhere first'],
            [
              '`NoExecute`',
              'Also evicts **running** Pods that do not tolerate (optional tolerationSeconds)',
            ],
          ],
        },
        after: [
          'QuickByte PCI pool: nodes are tainted `pci=true:NoSchedule` so Order Processor and Notification stay off. Payment Handler adds a **toleration** — the VIP pass — so only payments may join that pool.',
          'Toleration alone does **not** pull the Pod onto PCI nodes. It only **allows** them. To *prefer or require* those machines, combine with `nodeSelector` / affinity on a label such as `pci=true`.',
        ],
        codes: [
          {
            language: 'yaml',
            code: `# On the node (platform):
# kubectl taint nodes <node> pci=true:NoSchedule

# On payment-handler only:
spec:
  template:
    spec:
      tolerations:
        - key: pci
          operator: Equal
          value: "true"
          effect: NoSchedule
      # optional: also pin/prefer labeled PCI nodes
      nodeSelector:
        pci: "true"
      containers:
        - name: payment-handler
          image: payment-handler:v1.0`,
          },
        ],
        callout: {
          kind: 'scope',
          title: 'Who owns the taint?',
          body: [
            'Platform applies (and removes) taints on nodes. App teams add **tolerations** on the workloads that are allowed in. Do not “fix” Pending by tolerating every taint on every Deployment — that defeats the keep-out sign.',
          ],
        },
      },
      {
        id: 'cheatsheet',
        title: 'Cheatsheet — which tool when',
        body: ['One map for the QuickByte scheduling arc:'],
        table: {
          headers: ['Tool', 'Targets', 'Hard / soft', 'QuickByte use'],
          rows: [
            [
              '`nodeSelector`',
              'Node labels',
              'Hard only',
              'Pin Payment to `workload=payments`',
            ],
            [
              'Node affinity',
              'Node labels',
              'Both',
              'Prefer Notification on `workload=notifications`',
            ],
            [
              'Pod affinity',
              'Other Pod labels + topology',
              'Both',
              'Prefer Notification near Order Processor',
            ],
            [
              'Pod anti-affinity',
              'Other Pod labels + topology',
              'Both',
              'Spread Payment replicas across nodes',
            ],
            [
              'Taint + toleration',
              'Node repels; Pod opts in',
              'Effect-dependent',
              'PCI nodes: only Payment tolerates',
            ],
          ],
        },
        flows: [
          {
            title: 'Mental path',
            steps: [
              'Label / taint nodes (platform)',
              'Choose hard vs soft',
              'Write Pod rule',
              'Verify with get pods -o wide',
            ],
          },
        ],
      },
      {
        id: 'yaml-sketch',
        title: 'Putting pieces together (mental model)',
        body: [
          'You rarely need every knob on one Deployment. Compose intentionally: hard pin **or** soft prefer; affinity **or** anti-affinity for a given concern; toleration only when the node is tainted.',
        ],
        codes: [
          {
            language: 'yaml',
            code: `# Illustrative — not one lab’s required manifest
spec:
  template:
    metadata:
      labels:
        app: payment-handler
    spec:
      nodeSelector:
        workload: payments
      tolerations:
        - key: pci
          operator: Equal
          value: "true"
          effect: NoSchedule
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                topologyKey: kubernetes.io/hostname
                labelSelector:
                  matchLabels:
                    app: payment-handler
      containers:
        - name: payment-handler
          image: payment-handler:v1.0`,
          },
        ],
        after: [
          'Read this as: “Only payment (and PCI-tolerant) nodes; please spread my replicas.” Notification would use preferred **node** affinity or **pod** affinity instead — different story, same scheduling vocabulary.',
        ],
      },
    ],
    takeaways: [
      '**nodeSelector** = simple hard pin to node labels; miss the pool → Pending.',
      '**Node affinity** = richer node-label rules; **preferred** is soft, **required** is hard.',
      '**Pod affinity** prefers (or requires) topology near other Pods; **anti-affinity** spreads copies apart.',
      '`topologyKey` picks the domain — usually `kubernetes.io/hostname` for same/different node.',
      '**Taints** repel; **tolerations** opt in — tolerating does not attract; pair with selector/affinity when you must land on the protected pool.',
      'Default to **soft** when availability matters more than perfect placement; use **hard** when policy says never elsewhere.',
    ],
    relatedLabs: [
      {
        challengeId: 'k8s-25-pin-payment-handler-to-payment-nodes',
        label: 'Pin Payment Handler to Payment Nodes',
      },
      {
        challengeId: 'k8s-26-prefer-notification-nodes-softly',
        label: 'Prefer Notification Nodes Softly',
      },
      {
        challengeId: 'k8s-27-colocate-notifications-near-orders',
        label: 'Colocate Notifications Near Orders',
      },
      {
        challengeId: 'k8s-28-spread-payment-replicas-across-nodes',
        label: 'Spread Payment Replicas Across Nodes',
      },
      {
        challengeId: 'k8s-29-only-payments-on-tainted-pci-nodes',
        label: 'Only Payments on Tainted PCI Nodes',
      },
    ],
  },
  {
    id: 'canary-blue-green',
    slug: 'canary-blue-green',
    trackId: 'B14',
    eyebrow: '',
    title: 'Canary and Blue-Green Releases',
    showBlogStamp: true,
    lede:
      'A normal Deployment rolling update replaces Pods gradually under one controller. Sometimes you want a **small live experiment** (canary) or a **full parallel stack** you flip in one Service change (blue-green). Same Service front door — different ways to shift versions.',
    sections: [
      {
        id: 'why-controlled',
        title: 'What problem are we solving?',
        body: [
          'You already know a **Deployment** can roll `v1.0` → `v1.1` by creating new Pods and retiring old ones. That is great for many apps.',
          'But product sometimes asks for something sharper:',
        ],
        bullets: [
          'Send only a **small slice** of real traffic to `v1.1` first — watch errors, then grow or abort',
          'Or bring up a **complete** `v1.1` stack beside live traffic, test it privately, then **flip everyone** at once — with an instant path back',
        ],
        figure: {
          image: whyControlledReleasesImg,
          imageAlt:
            'Hand-drawn sketch: all-at-once flip vs controlled release that limits blast radius',
          caption: 'Same Service front door. Different how you shift versions.',
          flush: true,
        },
        after: [
          'Those patterns are **canary** and **blue-green**. They usually mean **more than one Deployment** (or track) sharing labels carefully with a **Service** — not only editing one Deployment’s image.',
        ],
      },
      {
        id: 'rolling-recap',
        title: 'Recap: what a rolling update already does',
        body: [
          'A single Deployment’s rolling update keeps **one** desired template. New ReplicaSets appear; old ones shrink. Clients hit the same Service the whole time; Endpoints drift from old Pods to new ones as replicas move.',
          'You do **not** get a long-lived “mostly v1.0 + one deliberate v1.1 Pod” side by side under separate names unless you design that. Canary and blue-green are that deliberate design.',
        ],
        callout: {
          kind: 'scope',
          title: 'Service still matters',
          body: [
            'Clients dial a **stable Service** name / ClusterIP. Which Pods receive traffic is whatever the Service **selector** matches right now. Canary and blue-green are mostly stories about **labels + selectors + replica counts**.',
          ],
        },
      },
      {
        id: 'what-is-canary',
        title: 'Let’s first understand what a canary is',
        body: [
          'A **canary** release runs the **new** version for a **small fraction** of traffic while the **stable** majority stays on the old version.',
          'Name comes from the old mining practice: a canary in the coal mine — if the small exposed part fails, you notice before everyone is hurt.',
        ],
        figure: {
          image: whatIsCanaryImg,
          imageAlt:
            'Hand-drawn sketch: Service sending most traffic to stable v1.0 Pods and a thin slice to canary v1.1',
          caption: 'Majority stable + small slice on new.',
          flush: true,
        },
        after: [
          'In Kubernetes at L1 shape: keep Deployment A on `v1.0` (many replicas) and add Deployment B on `v1.1` (few replicas). Both Pods share an `app=…` label the Service selects. Replica **ratio** ≈ traffic **ratio** under equal load-balancing (rough, not precise % routing).',
        ],
        table: {
          headers: ['Piece', 'Typical canary shape'],
          rows: [
            ['Stable Deployment', 'Many replicas, image `v1.0`, label `track=stable`'],
            ['Canary Deployment', 'Few replicas, image `v1.1`, label `track=canary`'],
            ['Service selector', '`app=<same>` — matches **both** tracks'],
            ['If canary looks bad', 'Delete / scale canary to 0; stable keeps serving'],
            ['If canary looks good', 'Grow canary or roll stable forward to `v1.1`'],
          ],
        },
      },
      {
        id: 'canary-yaml',
        title: 'Canary YAML sketch',
        body: [
          'Two Deployments, one Service. Shared `app` label; different `track` so you can scale them independently.',
        ],
        codes: [
          {
            language: 'yaml',
            code: `# Stable (majority)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: notification-service
      track: stable
  template:
    metadata:
      labels:
        app: notification-service
        track: stable
    spec:
      containers:
        - name: notification-service
          image: notification-service:v1.0
---
# Canary (small slice)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-service-canary
spec:
  replicas: 1
  selector:
    matchLabels:
      app: notification-service
      track: canary
  template:
    metadata:
      labels:
        app: notification-service
        track: canary
    spec:
      containers:
        - name: notification-service
          image: notification-service:v1.1
---
# Service selects both tracks via app=
apiVersion: v1
kind: Service
metadata:
  name: notification-service
spec:
  selector:
    app: notification-service
  ports:
    - port: 8080
      targetPort: 8080`,
          },
        ],
        callout: {
          kind: 'tip',
          title: 'Check Endpoints',
          body: [
            '`kubectl get endpoints <service>` (or EndpointSlices) should list addresses from **both** Deployments while the canary is live — that is how you know the Service actually mixes traffic.',
          ],
        },
      },
      {
        id: 'what-is-blue-green',
        title: 'What is blue-green?',
        body: [
          '**Blue-green** keeps two full environments: **blue** (current live) and **green** (new candidate). You bring green up to the **same capacity** as blue, validate it (smoke tests, private checks), then point the Service at green in **one** selector change.',
          'After cutover, users should **not** see a mixed blend of versions. Blue stays up idle for fast rollback — flip the selector back.',
        ],
        figure: {
          image: whatIsBlueGreenImg,
          imageAlt:
            'Hand-drawn sketch: Service pointing at green stack; blue stack idle for rollback',
          caption: 'Full new stack, then switch traffic.',
          flush: true,
        },
        tableAfter: {
          headers: ['Piece', 'Typical blue-green shape'],
          rows: [
            ['Blue Deployment', 'Live now: `color=blue`, image `v1.0`'],
            ['Green Deployment', 'Candidate: `color=green`, image `v1.1`, **same replica count**'],
            ['Service before cutover', 'Selects `color=blue`'],
            ['Service after cutover', 'Selects `color=green` (one change)'],
            ['Rollback', 'Point Service back at `color=blue` — do not delete blue on the happy path'],
          ],
        },
      },
      {
        id: 'blue-green-yaml',
        title: 'Blue-green YAML sketch',
        body: [
          'Green Deployment beside blue; cutover is editing the Service selector — not deleting blue.',
        ],
        codes: [
          {
            language: 'yaml',
            code: `# Green stack (full capacity)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-handler-green
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-handler
      color: green
  template:
    metadata:
      labels:
        app: payment-handler
        color: green
    spec:
      containers:
        - name: payment-handler
          image: payment-handler:v1.1
---
# Cutover — Service now selects green only
apiVersion: v1
kind: Service
metadata:
  name: payment-handler
spec:
  selector:
    app: payment-handler
    color: green
  ports:
    - port: 8000
      targetPort: 8000`,
          },
        ],
        after: [
          'Before cutover the Service selected `color=blue`. After apply, Endpoints should list **only** green Pods. Blue Pods remain Ready but receive no Service traffic until you flip back.',
        ],
      },
      {
        id: 'compare',
        title: 'Canary vs blue-green',
        body: ['Same goal — safer version shifts. Different traffic story.'],
        figure: {
          image: canaryVsBlueGreenImg,
          imageAlt:
            'Hand-drawn comparison: canary mixed traffic vs blue-green all-or-nothing flip',
          caption: 'Canary = gradual slice. Blue-green = full cutover.',
          flush: true,
        },
        tableAfter: {
          headers: ['', 'Canary', 'Blue-green'],
          rows: [
            ['Traffic during test', 'Mixed: mostly old + small new', 'Old only, until the flip'],
            ['After success path', 'Grow / promote canary', 'Everyone on green at once'],
            ['Capacity cost', 'Usually cheap (few extra Pods)', 'Roughly **2×** while both stacks run'],
            ['Rollback', 'Remove canary / scale to 0', 'Flip Service back to blue'],
            ['Best when', 'You want live signal on a slice', 'You want an instant all-or-nothing cut'],
          ],
        },
        callout: {
          kind: 'warn',
          title: 'Not a mesh / Ingress % router',
          body: [
            'These L1 patterns approximate share with **replica counts** and **selectors**. Fine-grained “exactly 5% of HTTP requests” usually needs Ingress, Gateway API, or a service mesh. Learn the Deployment + Service shape first.',
          ],
        },
      },
      {
        id: 'when-to-use',
        title: 'When to use which',
        body: ['Gut check before you pick a pattern:'],
        bullets: [
          '**Rolling update (one Deployment)** — default for most image bumps',
          '**Canary** — new code is risky; you want production signal on a small slice first',
          '**Blue-green** — you need a full parallel stack, clean cutover, and a one-line rollback',
        ],
        after: [
          'Cost and complexity go up from rolling → canary → blue-green. Prefer the simplest pattern that matches the risk.',
        ],
        callout: {
          kind: 'takeaway',
          title: 'Labels are the switch',
          body: [
            'Canary: Service selects a **shared** app label across tracks.',
            'Blue-green: Service selects a **color** (or version) label and you change that label at cutover.',
          ],
        },
      },
    ],
    takeaways: [
      '**Canary** = majority on stable + small live slice on the new version (often two Deployments, one Service).',
      '**Blue-green** = full new stack beside old; flip the Service selector once; keep blue for rollback.',
      'Both rely on **labels + Service selectors**; replica ratios approximate traffic share under simple load-balancing.',
      'Rolling updates on one Deployment are still the default — reach for canary / blue-green when the risk story needs them.',
      'Precise percentage routing is a later tool (Ingress / mesh); master the Pod + Service shape first.',
    ],
    relatedLabs: [
      {
        challengeId: 'k8s-30-canary-the-notification-service',
        label: 'Canary the Notification Service',
      },
      {
        challengeId: 'k8s-31-blue-green-cutover-for-payment-handler',
        label: 'Blue-Green Cutover for Payment Handler',
      },
    ],
  },
  {
    id: 'helm-charts',
    slug: 'helm-charts',
    trackId: 'B15',
    eyebrow: '',
    title: 'Helm: Packaging Kubernetes Apps',
    showBlogStamp: true,
    lede:
      'Raw YAML works until you install the same app in three places and every file drifts. **Helm** packages Kubernetes manifests into a versioned **chart**, fills blanks from **values**, and tracks each install as a **release**.',
    sections: [
      {
        id: 'why-helm',
        title: 'What problem are we solving?',
        body: [
          'Imagine a tiny bookstore inventory API called **`bookshelf`**. To run it you need at least a Deployment, a Service, and a ConfigMap for shelf labels. Easy on day one: three YAML files, `kubectl apply`.',
          'Then reality arrives:',
        ],
        bullets: [
          'Dev wants **1** replica and image tag `dev`',
          'Staging wants **1** replica and tag `1.2-rc`',
          'Prod wants **3** replicas, tag `1.2`, and a different ConfigMap theme',
        ],
        after: [
          'Teams often copy the folder three times — `bookshelf-dev/`, `bookshelf-stage/`, `bookshelf-prod/` — and edit by hand. Two weeks later prod still has last month’s probe settings and nobody knows which file is truth.',
        ],
        figure: {
          image: whyHelmImg,
          imageAlt:
            'Hand-drawn sketch: copy-paste YAML drifting across environments vs one Helm chart with many releases',
          caption: 'Package the app. Parameterize per environment.',
          flush: true,
        },
        callout: {
          kind: 'idea',
          title: 'What you want instead',
          body: [
            '**One** shared definition of “what bookshelf is” (Deployment + Service + ConfigMap shape).',
            '**Different numbers** (replicas, image tag, config) per environment — without forking the templates.',
            'A named **install** you can upgrade or roll back as a unit.',
          ],
        },
      },
      {
        id: 'what-is-helm',
        title: 'Let’s first understand what Helm is',
        body: [
          '**Helm** is the common package manager for Kubernetes. You ship an app as a **chart**; when you install it, Helm renders templates into plain manifests and applies them. That install is a **release** — a named instance Helm remembers (revision history, upgrade, rollback, uninstall).',
        ],
        table: {
          headers: ['Word', 'Means'],
          rows: [
            ['Chart', 'Versioned package: templates + default values + metadata'],
            ['Values', 'Knobs you override (replicas, image, ports, feature flags)'],
            ['Release', 'One install of a chart into a cluster/namespace'],
            ['Revision', 'A recorded upgrade/rollback step for that release'],
          ],
        },
        quote:
          'kubectl applies objects. Helm installs and upgrades a packaged app — and keeps the story of what changed.',
      },
      {
        id: 'what-is-a-chart',
        title: 'What is a chart?',
        body: [
          'A **chart** is a directory (or packaged archive) Kubernetes people share like a library package. For `bookshelf` it looks like this:',
        ],
        figure: {
          image: whatIsAChartImg,
          imageAlt:
            'Hand-drawn sketch of a bookshelf chart folder with Chart.yaml, values.yaml, and templates producing Deployment, Service, ConfigMap',
          caption: 'Versioned package of Kubernetes templates.',
          flush: true,
        },
        tableAfter: {
          headers: ['Path', 'Role'],
          rows: [
            ['`Chart.yaml`', 'Name, chart version, app version, description'],
            ['`values.yaml`', 'Default knobs (`replicaCount`, `image.tag`, …)'],
            ['`templates/`', 'YAML with `{{ … }}` placeholders Helm fills in'],
            ['`templates/deployment.yaml`', 'How the bookshelf Pods run'],
            ['`templates/service.yaml`', 'How clients reach bookshelf'],
            ['`templates/configmap.yaml`', 'Optional config mounted or injected'],
          ],
        },
        after: [
          'Chart **version** (`0.1.0`) is the package version. **appVersion** is often the app/image line you document beside it. They can move independently.',
        ],
      },
      {
        id: 'templates-values',
        title: 'Templates + values — how blanks get filled',
        body: [
          'Templates are almost normal Kubernetes YAML, except places you want to vary use Helm’s expression syntax — commonly `{{ .Values.… }}`.',
          'When you install or upgrade, Helm merges default `values.yaml` with any `-f` files / `--set` flags, renders templates to plain YAML, then talks to the API server.',
        ],
        figure: {
          image: templatesAndValuesImg,
          imageAlt:
            'Hand-drawn flow: templates with Values placeholders plus values.yaml rendered into plain Deployment and Service manifests',
          caption: 'Values fill the blanks; templates stay shared.',
          flush: true,
        },
        codes: [
          {
            language: 'yaml',
            code: `# values.yaml (defaults)
replicaCount: 2
image:
  repository: example/bookshelf
  tag: "1.0"
service:
  port: 8080
config:
  theme: wood`,
          },
          {
            language: 'yaml',
            code: `# templates/deployment.yaml (sketch)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bookshelf
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app: bookshelf
  template:
    metadata:
      labels:
        app: bookshelf
    spec:
      containers:
        - name: bookshelf
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          ports:
            - containerPort: {{ .Values.service.port }}
          env:
            - name: THEME
              value: {{ .Values.config.theme | quote }}`,
          },
        ],
        callout: {
          kind: 'tip',
          title: 'See the rendered YAML',
          body: [
            '`helm template bookshelf ./bookshelf` prints what would be applied — great for learning and code review before you touch a cluster.',
            '`helm upgrade --install bookshelf ./bookshelf -n library` installs or upgrades the **release** named `bookshelf`.',
          ],
        },
      },
      {
        id: 'release-lifecycle',
        title: 'Releases: install, upgrade, rollback',
        body: [
          'The chart is the recipe. A **release** is “bookshelf running in this namespace with these values.”',
        ],
        flows: [
          {
            title: 'Happy path',
            steps: [
              'helm install / upgrade',
              'render templates',
              'apply objects',
              'release revision recorded',
            ],
          },
        ],
        tableAfter: {
          headers: ['Command (sketch)', 'Intent'],
          rows: [
            [
              '`helm upgrade --install bookshelf ./bookshelf -n library`',
              'Create or update the release',
            ],
            ['`helm list -n library`', 'See releases in the namespace'],
            ['`helm history bookshelf -n library`', 'Revision list'],
            ['`helm rollback bookshelf 1 -n library`', 'Return to an earlier revision'],
            ['`helm uninstall bookshelf -n library`', 'Remove the release’s objects'],
          ],
        },
        after: [
          'That history is a big reason people adopt Helm: upgrades are not “hope we applied the right four files.”',
        ],
        callout: {
          kind: 'scope',
          title: 'Helm does not replace Kubernetes',
          body: [
            'After render, you still have Deployments, Services, ConfigMaps — the same objects you already know. Helm is packaging + parameterization + release bookkeeping on top.',
          ],
        },
      },
      {
        id: 'one-chart-many-values',
        title: 'One chart, many values files',
        body: [
          'Keep **one** `bookshelf` chart. Put environment differences in files you pass with `-f` — do not fork `templates/` per cluster.',
        ],
        figure: {
          image: oneChartManyValuesImg,
          imageAlt:
            'Hand-drawn sketch: one bookshelf chart branching to staging and prod with different replica and tag values',
          caption: 'Same templates — different values files.',
          flush: true,
        },
        codes: [
          {
            language: 'yaml',
            code: `# values-staging.yaml
replicaCount: 1
image:
  tag: "1.2-rc"
config:
  theme: draft`,
          },
          {
            language: 'yaml',
            code: `# values-prod.yaml
replicaCount: 3
image:
  tag: "1.2"
config:
  theme: wood`,
          },
        ],
        after: [
          'Install staging with `-f values-staging.yaml`, prod with `-f values-prod.yaml`. Same templates; different knobs. Reviewers can see environment intent in small files instead of hunting diffs inside Deployment YAML.',
        ],
      },
      {
        id: 'chart-yaml-sketch',
        title: 'Minimal Chart.yaml + layout',
        body: ['Enough metadata to call it a chart:'],
        codes: [
          {
            language: 'yaml',
            code: `# Chart.yaml
apiVersion: v2
name: bookshelf
description: Tiny bookstore inventory API
type: application
version: 0.1.0
appVersion: "1.0"`,
          },
          {
            language: 'text',
            code: `bookshelf/
  Chart.yaml
  values.yaml
  values-staging.yaml      # optional overlays
  values-prod.yaml
  templates/
    deployment.yaml
    service.yaml
    configmap.yaml`,
          },
        ],
      },
      {
        id: 'when-helm',
        title: 'When Helm helps (and when plain YAML is fine)',
        body: ['Reach for a chart when most of these are true:'],
        bullets: [
          'The app is **more than one manifest** you always ship together',
          'You install it in **more than one** environment or tenant',
          'You want **upgrade / rollback** history as a named release',
          'Others will consume your app as a **package** (team chart, OCI registry, …)',
        ],
        after: [
          'A single Pod YAML in a personal sandbox? Plain `kubectl apply` is still fine. Helm earns its keep when packaging and parameterization start to hurt.',
        ],
        callout: {
          kind: 'warn',
          title: 'Values are not secrets by magic',
          body: [
            'Putting passwords in `values.yaml` and committing them is still leaking secrets. Use Sealed Secrets, external secret stores, or `--set` from a secure pipeline — Helm does not encrypt your values for you.',
          ],
        },
      },
    ],
    takeaways: [
      '**Helm** packages Kubernetes YAML into a **chart**, fills **values**, and tracks each install as a **release**.',
      '**Templates** stay shared; **values files** carry environment differences (replicas, image tag, config).',
      '`helm upgrade --install` creates or updates; `history` / `rollback` are why releases beat loose file piles.',
      'Helm still produces normal Deployments, Services, ConfigMaps — it does not replace those concepts.',
      'Use Helm when an app is a multi-manifest package across environments; keep plain YAML for tiny one-off experiments.',
    ],
    relatedLabs: [
      {
        challengeId: 'k8s-32-package-notification-service-with-helm',
        label: 'Package Notification Service with Helm',
      },
      {
        challengeId: 'k8s-33-one-chart-staging-and-prod-values',
        label: 'One Chart, Staging and Prod Values',
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

/** Readings inserted at the start of the Kubernetes track (before L0). */
const K8S_READINGS_BEFORE_LABS = ['kubectl-basics'] as const;

/** Readings inserted immediately after a given challenge id. */
const K8S_READINGS_AFTER_CHALLENGE: Record<string, string[]> = {
  'k8s-00-meet-kubectl': ['containers-runtimes-pods'],
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
  'k8s-19-claim-disk-for-order-processor': ['statefulsets'],
  'k8s-24-snapshot-and-restore-order-archives': ['scheduling-affinity-taints'],
  'k8s-29-only-payments-on-tainted-pci-nodes': ['canary-blue-green'],
  'k8s-31-blue-green-cutover-for-payment-handler': ['helm-charts'],
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
