/**
 * Slot reservation for open K8s labs (deploy/eks/karpenter/balloons.yaml).
 *
 * Each open lab reserves the pods its challenge runs (platformSpec.reservePods, default
 * quota pods − 3 headroom). Reserved slots the lab is not using yet are held by balloon
 * pods in dl-system/dl-balloon-reserved:
 *
 *   replicas = Σ over open labs of max(0, reservePods − pods in use) × slotsPerPod
 *
 * Learner pods preempt balloons in ~1 s, so reserved pods never wait for a node boot,
 * and Pending balloons make Karpenter buy the next node as soon as a lab opens on a
 * full pool. Headroom pods beyond reservePods use the warm pool (dl-balloon) and may
 * wait ~30–40 s once it is exhausted; those waits get a pod Event and a UI notice.
 */
import type { K8sPlatformSpec } from '../types/domain';

const sessionStore = require('../db/sessionStore');
const loader = require('../challenges/loader');
const k8s = require('./k8sCluster');
const { isBoxLabType } = require('../challenges/labTypes');

const BALLOON_NS = 'dl-system';
const RESERVED_DEPLOY = 'dl-balloon-reserved';
const HEADROOM_PODS = 3;
const DEFAULT_QUOTA_PODS = 6;
const TICK_MS = Number(process.env.K8S_CAPACITY_TICK_MS || 3000);
/**
 * Exactly one backend per cluster may scale the reserved balloons: another one sees
 * none of the first one's labs and would scale them to 0. Others only watch for waits.
 */
const MANAGER = process.env.K8S_CAPACITY_MANAGER === '1';
/** Re-read the live replica count this often (someone may re-apply balloons.yaml). */
const REPLICAS_REFRESH_MS = 10_000;
/** The scheduler retries quickly after preemption; shorter waits are not worth a notice. */
const WAIT_GRACE_MS = 3000;
/** Scheduler reasons that a new node of the same shape would fix. */
const CAPACITY_REASON = /Too many pods|Insufficient (cpu|memory)/;

type PodCondition = { type?: string; status?: string; reason?: string; message?: string; lastTransitionTime?: string };
type PodLike = {
  metadata?: {
    name?: string; namespace?: string; uid?: string; creationTimestamp?: string;
    deletionTimestamp?: string; labels?: Record<string, string>;
  };
  spec?: { nodeName?: string };
  status?: { phase?: string; nominatedNodeName?: string; conditions?: PodCondition[] };
};
type QuotaLike = { metadata?: { name?: string; namespace?: string }; status?: { used?: Record<string, string> } };
type NodeLike = {
  metadata?: { labels?: Record<string, string> };
  spec?: { unschedulable?: boolean };
  status?: { conditions?: Array<{ type?: string; status?: string }> };
};
type NodePoolLike = {
  spec?: { limits?: { cpu?: string }; template?: { metadata?: { labels?: Record<string, string> } } };
};

/** devlabs.io/pool of the Kubernetes-lab learner nodes (deploy/eks/karpenter/nodepool.yaml). */
const K8S_LAB_POOL = 'labs';
const POOL_CHECK_TTL_MS = 15_000;
const poolChecks = new Map<string, { at: number; up: boolean }>();

type Waiting = { since: number; notified: boolean };

/** ns → pod → capacity wait */
const waiting = new Map<string, Map<string, Waiting>>();
/** ns → since: lab open held until its reservation has a node */
const reserving = new Map<string, number>();
let reservedReplicas: number | null = null;
let reservedReadAt = 0;
let timer: NodeJS.Timeout | null = null;
let inflight: Promise<void> | null = null;
let again = false;
let lastError = '';

function reservation(challengeId: string): { pods: number; slotsPerPod: number } {
  const spec = (loader.getChallenge(challengeId)?.k8sPlatform || {}) as K8sPlatformSpec;
  const quotaPods = Number(spec.quota?.pods) || DEFAULT_QUOTA_PODS;
  const pods = spec.reservePods != null
    ? Math.max(0, Number(spec.reservePods) || 0)
    : Math.max(0, quotaPods - HEADROOM_PODS);
  return { pods, slotsPerPod: Math.max(1, Number(spec.slotsPerPod) || 1) };
}

/** ns → challengeId for every active K8s session (one lab per namespace). */
function openLabs(): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of sessionStore.all() as Array<Record<string, unknown>>) {
    if (s.runtime !== 'kubernetes' || s.status !== 'active') continue;
    // Boxes run on their own pools (labs-linux, labs-docker), not in balloon-backed learner slots.
    if (isBoxLabType(loader.getChallenge(String(s.challengeId || ''))?.sandboxType)) continue;
    const ns = s.k8sNamespace || s.workspacePrefix;
    if (ns && s.challengeId) out.set(String(ns), String(s.challengeId));
  }
  return out;
}

async function kubectlJson<T>(args: string[]): Promise<{ items: T[] }> {
  const out = await k8s.kubectlOk([...args, '-o', 'json'], { timeoutMs: 15_000 });
  return JSON.parse(out) as { items: T[] };
}

function scheduledCondition(pod: PodLike): PodCondition | undefined {
  return pod.status?.conditions?.find((c) => c.type === 'PodScheduled');
}

/** Unschedulable only for lack of room (not a selector / taint / volume the learner set). */
function isCapacityWait(pod: PodLike): boolean {
  if (pod.status?.phase !== 'Pending' || pod.status?.nominatedNodeName) return false;
  const c = scheduledCondition(pod);
  return c?.status === 'False' && c.reason === 'Unschedulable' && CAPACITY_REASON.test(c.message || '');
}

async function scaleReserved(desired: number): Promise<void> {
  if (reservedReplicas === null || Date.now() - reservedReadAt > REPLICAS_REFRESH_MS) {
    const live = await k8s.kubectlOk(
      ['get', 'deploy', RESERVED_DEPLOY, '-n', BALLOON_NS, '-o', 'jsonpath={.spec.replicas}'],
      { timeoutMs: 15_000 },
    );
    reservedReplicas = Number(live) || 0;
    reservedReadAt = Date.now();
  }
  if (desired === reservedReplicas) return;
  await k8s.kubectlOk(
    ['scale', 'deploy', RESERVED_DEPLOY, '-n', BALLOON_NS, `--replicas=${desired}`],
    { timeoutMs: 15_000 },
  );
  console.log(`[k8s-capacity] reserved balloons ${reservedReplicas} → ${desired}`);
  reservedReplicas = desired;
}

async function emitWaitEvent(pod: PodLike): Promise<void> {
  const ns = pod.metadata?.namespace;
  const name = pod.metadata?.name;
  if (!ns || !name) return;
  const now = new Date().toISOString();
  const event = {
    apiVersion: 'v1',
    kind: 'Event',
    metadata: { generateName: `${name}.devsetu-`, namespace: ns },
    involvedObject: { apiVersion: 'v1', kind: 'Pod', name, namespace: ns, uid: pod.metadata?.uid },
    reason: 'DevSetuCapacity',
    message:
      "Your lab's reserved pods are in use and the cluster is full, so extra capacity is "
      + 'starting for this pod (about 30–40 s). It starts automatically; no action needed.',
    type: 'Normal',
    source: { component: 'devsetu' },
    firstTimestamp: now,
    lastTimestamp: now,
    count: 1,
  };
  await k8s.runKubectl(['create', '-f', '-'], { input: JSON.stringify(event), timeoutMs: 15_000 });
}

async function trackWaiting(labs: Map<string, string>, pending: PodLike[]): Promise<void> {
  const seen = new Set<string>();
  const now = Date.now();
  for (const pod of pending) {
    const ns = pod.metadata?.namespace || '';
    const name = pod.metadata?.name || '';
    if (!labs.has(ns) || !isCapacityWait(pod)) continue;
    seen.add(`${ns}/${name}`);
    let byPod = waiting.get(ns);
    if (!byPod) waiting.set(ns, (byPod = new Map()));
    let w = byPod.get(name);
    if (!w) {
      const since = Date.parse(scheduledCondition(pod)?.lastTransitionTime || '') || now;
      byPod.set(name, (w = { since, notified: false }));
    }
    if (!w.notified && now - w.since >= WAIT_GRACE_MS) {
      w.notified = true;
      await emitWaitEvent(pod).catch(() => {});
      console.log(`[k8s-capacity] ${ns}/${name} waiting for capacity`);
    }
  }
  for (const [ns, byPod] of waiting) {
    for (const name of byPod.keys()) {
      if (!seen.has(`${ns}/${name}`)) byPod.delete(name);
    }
    if (!byPod.size) waiting.delete(ns);
  }
}

async function tick(): Promise<void> {
  const labs = openLabs();
  const [quotas, pending] = labs.size
    ? await Promise.all([
      kubectlJson<QuotaLike>(['get', 'resourcequota', '-A', '-l', 'app.kubernetes.io/managed-by=devlabs']),
      kubectlJson<PodLike>(['get', 'pods', '-A', '--field-selector=status.phase=Pending']),
    ])
    : [{ items: [] as QuotaLike[] }, { items: [] as PodLike[] }];

  const used = new Map<string, number>();
  for (const q of quotas.items) {
    if (q.metadata?.name === 'dl-lab-quota' && q.metadata.namespace) {
      used.set(q.metadata.namespace, Number(q.status?.used?.pods) || 0);
    }
  }
  let desired = 0;
  for (const [ns, challengeId] of labs) {
    const r = reservation(challengeId);
    desired += Math.max(0, r.pods - (used.get(ns) || 0)) * r.slotsPerPod;
  }
  if (MANAGER) await scaleReserved(desired);
  await trackWaiting(labs, pending.items);
}

/** Run a reconcile now (coalesced with one already running). */
function nudge(): Promise<void> {
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = (async () => {
    do {
      again = false;
      try {
        await tick();
        if (lastError) console.log('[k8s-capacity] reconcile recovered');
        lastError = '';
      } catch (err) {
        const msg = (err as Error).message || String(err);
        if (msg !== lastError) console.warn(`[k8s-capacity] reconcile failed: ${msg}`);
        lastError = msg;
      }
    } while (again);
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

function start(): void {
  if (timer) return;
  timer = setInterval(() => void nudge(), TICK_MS);
  timer.unref();
  void nudge();
  console.log(MANAGER
    ? `[k8s-capacity] managing slot reservation every ${TICK_MS} ms`
    : '[k8s-capacity] watching capacity waits only (K8S_CAPACITY_MANAGER unset)');
}

/** Pods in `ns` waiting for a node, oldest first (only after the short grace). */
function waitingPods(ns: string): Array<{ pod: string; waitingSeconds: number }> {
  const now = Date.now();
  return [...(waiting.get(ns)?.entries() || [])]
    .filter(([, w]) => now - w.since >= WAIT_GRACE_MS)
    .sort((a, b) => a[1].since - b[1].since)
    .map(([pod, w]) => ({ pod, waitingSeconds: Math.round((now - w.since) / 1000) }));
}

/**
 * Block until every reserved balloon is backed by a node, or enough warm balloons are
 * running to absorb the difference. Setup pods preempt the lowest-priority balloons
 * anywhere; while a new lab's own balloons are still Pending (pool full), they would
 * otherwise take another lab's reserved slots. Returns false on timeout.
 */
async function waitForReservation(ns: string, timeoutMs = 90_000): Promise<boolean> {
  if (!MANAGER) return true;
  const deadline = Date.now() + timeoutMs;
  await nudge();
  try {
    return await pollReservation(ns, deadline, timeoutMs);
  } finally {
    reserving.delete(ns);
  }
}

async function pollReservation(ns: string, deadline: number, timeoutMs: number): Promise<boolean> {
  while (Date.now() < deadline) {
    const { items } = await kubectlJson<PodLike>(
      ['get', 'pods', '-n', BALLOON_NS, '-l', `app in (dl-balloon,${RESERVED_DEPLOY})`],
    ).catch(() => ({ items: [] as PodLike[] }));
    const live = items.filter((p) => !p.metadata?.deletionTimestamp);
    const reservedPods = live.filter((p) => p.metadata?.labels?.app === RESERVED_DEPLOY);
    const unplaced = reservedPods.filter((p) => !p.spec?.nodeName).length;
    const warm = live.filter((p) => p.metadata?.labels?.app === 'dl-balloon' && p.status?.phase === 'Running').length;
    // The ReplicaSet creates pods in batches after a scale-up; judge only once they all exist.
    if (reservedPods.length >= (reservedReplicas ?? 0) && unplaced <= warm) return true;
    if (!reserving.has(ns)) reserving.set(ns, Date.now());
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn(`[k8s-capacity] reserved balloons still unplaced after ${timeoutMs} ms, running setup anyway`);
  return false;
}

/**
 * Block until the lab's pods have a node, so the terminal only opens once setup
 * capacity is procured. Pods Pending for other reasons (a nodeSelector the lab asks the
 * learner to fix, say) do not block. Returns false on timeout; the lab opens anyway.
 */
async function waitForPodsScheduled(ns: string, timeoutMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let cleanPolls = 0;
  void nudge();
  while (Date.now() < deadline) {
    const { items } = await kubectlJson<PodLike>(['get', 'pods', '-n', ns]).catch(() => ({ items: [] as PodLike[] }));
    const now = Date.now();
    const blocking = items.filter((p) => {
      if (isCapacityWait(p)) return true;
      // Just created and not yet looked at by the scheduler.
      const age = now - (Date.parse(p.metadata?.creationTimestamp || '') || now);
      return p.status?.phase === 'Pending' && !scheduledCondition(p) && age < 10_000;
    });
    cleanPolls = blocking.length ? 0 : cleanPolls + 1;
    // Two clean polls: controllers create pods a moment after setup's kubectl apply returns.
    if (cleanPolls >= 2) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn(`[k8s-capacity] ${ns}: pods still waiting for capacity after ${timeoutMs} ms, opening anyway`);
  return false;
}

/**
 * False only when the pool cannot run anything: no Ready node carries
 * devlabs.io/pool=<pool> and every Karpenter NodePool that would add one is missing or
 * capped at cpu 0 (eks-labs-sleep.sh). Lookup errors count as up, so a flaky API never
 * blocks an open.
 */
async function poolUp(pool: string = K8S_LAB_POOL): Promise<boolean> {
  const hit = poolChecks.get(pool);
  if (hit && Date.now() - hit.at < POOL_CHECK_TTL_MS) return hit.up;
  let up = true;
  try {
    const nodes = await kubectlJson<NodeLike>(['get', 'nodes', '-l', `devlabs.io/pool=${pool}`]);
    const ready = nodes.items.some((n) => !n.spec?.unschedulable
      && Boolean(n.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True')));
    if (!ready) {
      const pools = await kubectlJson<NodePoolLike>(['get', 'nodepools.karpenter.sh']);
      up = pools.items.some((p) => {
        if (p.spec?.template?.metadata?.labels?.['devlabs.io/pool'] !== pool) return false;
        const cpu = p.spec?.limits?.cpu;
        return cpu == null || parseFloat(cpu) > 0;
      });
    }
  } catch (_e) {
    up = true;
  }
  poolChecks.set(pool, { at: Date.now(), up });
  return up;
}

/** Seconds this lab's open has been held for capacity, or null. */
function reservingSeconds(ns: string): number | null {
  const since = reserving.get(ns);
  return since ? Math.round((Date.now() - since) / 1000) : null;
}

module.exports = {
  start, nudge, waitingPods, reservingSeconds, waitForReservation, waitForPodsScheduled, reservation,
  poolUp,
};
