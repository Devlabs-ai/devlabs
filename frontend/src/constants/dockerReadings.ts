/** Docker track readings (blogs) interleaved with labs. Same shape as the Kubernetes readings. */

import { PLAY_DOMAINS } from './playCatalog';
import type { K8sReading, K8sTrackItem } from './k8sReadings';

export const DOCKER_LABS_PATH = '/track/devops-engineer/docker';
export const DOCKER_READINGS_BASE = `${DOCKER_LABS_PATH}/read`;

export function dockerReadingPath(slug: string): string {
  return `${DOCKER_READINGS_BASE}/${slug}`;
}

export const DOCKER_READINGS: K8sReading[] = [
  {
    id: 'what-a-container-really-is',
    slug: 'what-a-container-really-is',
    trackId: 'B1',
    eyebrow: '',
    title: 'What a Container Really Is',
    showBlogStamp: true,
    gatedByChallengeId: 'docker-00-first-container-on-the-order-box',
    lede:
      'A container is not a small virtual machine. It is an ordinary Linux process that the kernel lies to about what it can see, fenced in by limits. Learn the three pieces (image, container, engine), the handful of commands that drive them, and the lifecycle every container goes through.',
    sections: [
      {
        id: 'why-containers',
        title: 'What problem are we solving?',
        body: [
          'Imagine a small food-delivery startup. The order service runs on one server, set up by hand two years ago: Python 3.9 from the distro, a few packages installed with `pip` as root, a systemd unit, and a config file someone edited in vim. It works. Nobody dares touch it.',
          'Now the team wants a second copy for testing, a newer Python for a new service, and a clean way to roll back a bad release. Every one of those means repeating the hand setup, perfectly, on another machine, and hoping nothing on the server conflicts.',
          'Containers fix this by packaging the app **together with everything it needs** (runtime, libraries, files) into one artifact, the **image**, and running it in its own fenced-off space. The same image runs the same way on a laptop, a test box and production.',
        ],
      },
      {
        id: 'three-pieces',
        title: 'Three pieces: image, container, engine',
        body: [
          'Everything in Docker comes back to three things:',
        ],
        bullets: [
          '**Image**: a read-only bundle of files (a mini root filesystem) plus metadata such as the default command, environment and exposed ports. Think of it as a class, or a frozen template. Images have names and tags: `python:3.12-slim`, `devsetu/order-processor:v1.1`.',
          '**Container**: a running (or stopped) instance of an image. Docker adds a thin writable layer on top of the image, starts the image’s command as a process, and keeps track of its state and logs. Many containers can run from one image.',
          '**Engine (`dockerd`)**: the background service that pulls images, creates containers and wires up their networks. The `docker` command you type is only a client that sends requests to it over `/var/run/docker.sock`.',
        ],
        callout: {
          kind: 'idea',
          title: 'Client and server',
          body: [
            '`docker version` prints two sections, Client and Server. They are separate programs that can even live on different machines. Being in the `docker` group is what lets you talk to the socket without `sudo`, which also means it is as powerful as root on that machine.',
          ],
        },
      },
      {
        id: 'not-a-vm',
        title: 'Not a virtual machine',
        body: [
          'A virtual machine emulates hardware and boots its own kernel. A container does neither. It is a normal process on the host’s kernel, with two kernel features wrapped around it:',
        ],
        table: {
          headers: ['Feature', 'What it does', 'What you notice'],
          rows: [
            ['**Namespaces**', 'Give the process its own view of PIDs, network, mounts, hostname and users', 'Inside, the app is PID 1, has its own `eth0`, and sees only the image’s files'],
            ['**cgroups**', 'Limit and account CPU, memory and process counts', '`docker run --memory 64m`: go over it and the kernel kills the process (OOM)'],
            ['**Layered filesystem** (overlay2)', 'Stacks the image’s read-only layers with a writable layer on top', 'Starting a container takes milliseconds; changes vanish when you remove it'],
          ],
        },
        after: [
          'That is why containers start in well under a second and why dozens fit on one machine: there is no second operating system to boot. It is also why a container needs a Linux kernel underneath. On a Mac, Docker Desktop quietly runs a small Linux VM for you.',
        ],
      },
      {
        id: 'core-commands',
        title: 'The commands you will use every day',
        body: [
          'A dozen commands cover almost everything. They all follow the shape `docker <object> <verb>` (with short aliases for the common ones):',
        ],
        codes: [
          {
            language: 'bash',
            code: [
              'docker run -d --name web -p 8080:80 nginx:alpine   # create + start, in the background',
              'docker ps            # running containers      (docker ps -a: include stopped)',
              'docker logs web      # what it printed         (-f to follow)',
              'docker exec -it web sh   # a shell inside the running container',
              'docker stop web      # SIGTERM, then SIGKILL after 10 s',
              'docker start web     # start it again, same container, same writable layer',
              'docker rm web        # remove it               (rm -f: stop + remove)',
              '',
              'docker images        # images on this machine',
              'docker pull alpine:3.20',
              'docker inspect web   # everything Docker knows, as JSON',
            ].join('\n'),
          },
        ],
        after: [
          'The flags on `docker run` are where most of the decisions live: `-d` (detached), `--name`, `-p HOST:CONTAINER` (publish a port), `-e KEY=value` (environment), `-v` (mount storage), `--rm` (delete on exit). Anything after the image name replaces the image’s default command.',
        ],
      },
      {
        id: 'lifecycle',
        title: 'The lifecycle of a container',
        body: [
          'A container lives exactly as long as its **main process**. When that process exits, the container stops; it does not "idle". This trips up almost everyone once: `docker run alpine:3.20` appears to do nothing, because the default command (`/bin/sh`) has no input and exits immediately.',
        ],
        flows: [
          {
            title: 'States',
            steps: ['created', 'running', 'exited', 'removed'],
          },
        ],
        after: [
          '`docker run` = `create` + `start`. A stopped container keeps its logs, its writable layer and its name until you `docker rm` it, which is why names "stay taken". Data you care about must not live only in a container’s writable layer; volumes, later in the track, are for that.',
        ],
        callout: {
          kind: 'tip',
          title: 'Read before you remove',
          body: [
            '`docker logs` works on stopped containers. When something crashed, read its logs and `docker inspect` its exit code before cleaning up.',
          ],
        },
      },
      {
        id: 'where-images-come-from',
        title: 'Where images come from',
        body: [
          'Images live in **registries**. Docker Hub is the default: `nginx:alpine` really means `docker.io/library/nginx:alpine`, and `devsetu/order-processor:v1.1` means the `devsetu` account on Docker Hub. Companies run private registries, and often a **mirror** that caches Docker Hub inside their network, which is exactly what your lab machine uses.',
          'The part after the colon is the **tag**, a movable label chosen by whoever published the image. `latest` is just the default tag name, not a promise of the newest version. Pin real versions (`python:3.12-slim`, `v1.1`) so the same command gives the same result next month.',
        ],
      },
    ],
    takeaways: [
      'An image is a read-only template; a container is a running instance of it with a thin writable layer.',
      'A container is a normal Linux process wrapped in namespaces (what it sees) and cgroups (what it may use), not a VM.',
      'The `docker` CLI is a client; `dockerd` does the work.',
      'A container lives as long as its main process; stopped containers keep logs and names until `docker rm`.',
      'Pin image tags; `latest` is only a default label.',
    ],
    relatedLabs: [
      {
        challengeId: 'docker-00-first-container-on-the-order-box',
        label: 'First Container on the Order Box',
      },
      {
        challengeId: 'docker-01-run-order-processor-in-a-container',
        label: 'Run Order Processor in a Container',
      },
    ],
  },
  {
    id: 'images-and-dockerfiles',
    slug: 'images-and-dockerfiles',
    trackId: 'B2',
    eyebrow: '',
    title: 'Images and Dockerfiles',
    showBlogStamp: true,
    gatedByChallengeId: 'docker-03-write-a-dockerfile-for-order-processor',
    lede:
      'A Dockerfile is a recipe that turns your source code into an image, one layer per step. Learn the instructions you will use in nearly every Dockerfile, how layers and the build cache decide whether a rebuild takes one second or five minutes, and the small choices (exec-form CMD, health checks, labels) that make an image pleasant to run.',
    sections: [
      {
        id: 'why-dockerfiles',
        title: 'What problem are we solving?',
        body: [
          'Running other people’s images is half the job. The other half is packaging **your** app: the order service, the payment worker, the nightly export. You could start a container, install things by hand and `docker commit` the result, but then nobody knows what is inside or how to rebuild it.',
          'A **Dockerfile** writes the packaging down as code. It lives next to the source, gets reviewed like code, and `docker build` produces the same image from it every time.',
        ],
      },
      {
        id: 'instructions',
        title: 'The instructions you will actually use',
        body: [
          'A typical Python service needs only a handful:',
        ],
        code: {
          language: 'dockerfile',
          code: [
            'FROM python:3.12-slim              # start from this image',
            'WORKDIR /app                       # cd into /app (created if missing)',
            'COPY requirements.txt .            # files from the build context into the image',
            'RUN pip install --no-cache-dir -r requirements.txt   # run a command at build time',
            'COPY app.py .',
            'ENV APP_VERSION=v1.3               # environment baked into the image',
            'EXPOSE 8000                        # documents the port (does not publish it)',
            'USER 1000                          # stop running as root',
            'CMD ["gunicorn", "--bind", "0.0.0.0:8000", "app:app"]   # default command',
          ].join('\n'),
        },
        table: {
          headers: ['Instruction', 'Runs at', 'Notes'],
          rows: [
            ['`FROM`', 'build', 'Every image starts from another one. `-slim` and `alpine` variants are much smaller'],
            ['`COPY`', 'build', 'Paths on the left are relative to the **build context**, the folder you pass to `docker build`'],
            ['`RUN`', 'build', 'Each `RUN` creates a layer. Chain related commands with `&&` and clean up in the same step'],
            ['`ENV`', 'build + run', 'Defaults that `docker run -e` can override'],
            ['`CMD` / `ENTRYPOINT`', 'run', 'What starts when a container starts. `docker run IMAGE cmd...` replaces `CMD`'],
          ],
        },
      },
      {
        id: 'layers-and-cache',
        title: 'Layers and the build cache',
        body: [
          'Each instruction produces a layer, and Docker caches it. On the next build, Docker reuses a cached layer as long as the instruction **and everything before it** are unchanged. The first changed step, and every step after it, runs again.',
          'That is why order matters. Copy the file that rarely changes (`requirements.txt`) and install dependencies **before** copying the code that changes all the time. Then editing `app.py` re-runs only the last `COPY`, and a rebuild takes a second instead of reinstalling every package.',
        ],
        flows: [
          {
            title: 'Edit app.py, rebuild',
            steps: ['FROM (cached)', 'COPY requirements.txt (cached)', 'RUN pip install (cached)', 'COPY app.py (runs)'],
          },
        ],
        callout: {
          kind: 'tip',
          title: 'Offline builds',
          body: [
            'Your lab machine has no internet: images come through a registry mirror, Python packages don’t. Building from a folder of pre-downloaded wheels (`pip install --no-index --find-links=wheels`) is how teams make builds reproducible and independent of PyPI being up.',
          ],
        },
      },
      {
        id: 'exec-form',
        title: 'Exec form vs shell form',
        body: [
          '`CMD ["gunicorn", "app:app"]` (exec form, a JSON list) starts gunicorn directly as PID 1. `CMD gunicorn app:app` (shell form) starts `/bin/sh -c "gunicorn app:app"`, so the shell is PID 1 and gunicorn is its child.',
          'The difference shows up on `docker stop`: Docker sends SIGTERM to PID 1. With exec form, gunicorn receives it and shuts down cleanly. With shell form, `sh` usually ignores it, Docker waits 10 seconds, then SIGKILLs everything, mid-request. Use exec form for `CMD` and `ENTRYPOINT`.',
        ],
      },
      {
        id: 'healthchecks-and-labels',
        title: 'Health checks and labels',
        body: [
          'Docker knows whether the main process is alive, not whether the app works. A `HEALTHCHECK` runs a small command inside the container on a schedule; exit code 0 means healthy. `docker ps` then shows `(healthy)` or `(unhealthy)`, and Compose can wait for a dependency to be healthy before starting the next service.',
        ],
        code: {
          language: 'dockerfile',
          code: [
            'HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \\',
            '  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen(\'http://127.0.0.1:8000/health\', timeout=2)"]',
            '',
            'LABEL org.opencontainers.image.title="order-processor" \\',
            '      org.opencontainers.image.version="1.4"',
          ].join('\n'),
        },
        after: [
          'Slim images often lack `curl`, so probe with what the image already has. **Labels** are free-form metadata (owner, version, source repo); the `org.opencontainers.image.*` keys are the standard ones that registries and scanners understand.',
        ],
      },
      {
        id: 'build-run-replace',
        title: 'Build, run, replace',
        body: [
          'Images are immutable, and a container keeps the image it was started from. Shipping a change is always the same loop:',
        ],
        code: {
          language: 'bash',
          code: [
            'docker build -t quickbyte/order-processor:1.3 ~/order-processor',
            'docker rm -f op-13',
            'docker run -d --name op-13 -p 8081:8000 quickbyte/order-processor:1.3',
            'docker history quickbyte/order-processor:1.3    # one line per layer',
          ].join('\n'),
        },
      },
    ],
    takeaways: [
      'A Dockerfile is the reviewed, repeatable recipe for an image; every instruction adds a layer.',
      'Order steps from least to most frequently changed so the build cache does the work.',
      'Use exec-form `CMD` so the app receives signals and stops cleanly.',
      'A `HEALTHCHECK` tells Docker whether the app works, not just whether the process runs.',
      'Rebuilding doesn’t change running containers; replace them.',
    ],
    relatedLabs: [
      {
        challengeId: 'docker-03-write-a-dockerfile-for-order-processor',
        label: 'Write a Dockerfile for Order Processor',
      },
      {
        challengeId: 'docker-07-health-check-for-order-processor',
        label: 'Health Check for Order Processor',
      },
    ],
  },
];

export function getDockerReading(slug: string | null | undefined): K8sReading | null {
  if (!slug) return null;
  return DOCKER_READINGS.find((r) => r.slug === slug || r.id === slug) || null;
}

/** Readings inserted at the start of the Docker track (before lab 0). */
const DOCKER_READINGS_BEFORE_LABS = ['what-a-container-really-is'] as const;

/** Readings inserted immediately after a given challenge id. */
const DOCKER_READINGS_AFTER_CHALLENGE: Record<string, string[]> = {
  'docker-01-run-order-processor-in-a-container': ['images-and-dockerfiles'],
};

/** Ordered mixed roadmap for the DevOps Docker panel: readings + challenges. */
export function listDockerTrackItems(): K8sTrackItem[] {
  const panel = PLAY_DOMAINS.find((d) => d.id === 'devops-engineer')?.panels.find(
    (p) => p.id === 'docker',
  );
  const items: K8sTrackItem[] = DOCKER_READINGS_BEFORE_LABS.map((readingId) => ({
    type: 'reading',
    id: `reading:${readingId}`,
    readingId,
  }));
  for (const challengeId of panel?.challengeIds ?? []) {
    items.push({ type: 'challenge', id: `challenge:${challengeId}`, challengeId });
    for (const readingId of DOCKER_READINGS_AFTER_CHALLENGE[challengeId] ?? []) {
      items.push({ type: 'reading', id: `reading:${readingId}`, readingId });
    }
  }
  return items;
}
