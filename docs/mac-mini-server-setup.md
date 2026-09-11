# Mac Mini M4 home-lab server setup

Guide for running Devlabs managed platforms (Kafka, Spark, Airflow, Postgres) on a dedicated **Mac Mini M4** as an always-on home server, controlled remotely from a MacBook over SSH.

This documents the setup path we validated: **Colima + k3s** (CLI-only, headless). OrbStack was attempted but abandoned due to headless/GUI helper issues on macOS 26.

---

## Current status

| Item | Status |
| ---- | ------ |
| `devlabs` user + SSH from MacBook | Done |
| Disk cleaned (~80 GB free) | Done |
| Colima + k3s on Mac Mini (manual start) | Done |
| **Remote kubectl from MacBook (SSH tunnel)** | **Not yet achieved** |
| **Colima auto-start after Mac Mini reboot** | **Not yet achieved** |
| Devlabs platforms deployed | Spark + MinIO + Airflow + Postgres Platform deployed |
| UPS / DHCP reservation | Not started |

Until remote kubectl works, run `kubectl` over SSH on the Mac Mini. After every reboot, run `colima start --cpu 6 --memory 12 --kubernetes` manually until auto-start is configured.

**Flaky browser URLs (“can’t be reached”)?** See [Platform reliability on Mac Mini](../platforms/devlabs-dashboard/docs/mac-mini-platform-reliability.md) — this is usually **host OOM / pod restarts**, not internet or DNS.

---

## Goals

| Goal | Notes |
| ---- | ----- |
| Always-on Mac Mini server | Headless, SSH from MacBook |
| Container runtime | Docker-compatible (Compose + images) |
| Kubernetes | Single-node k3s via Colima |
| Devlabs platforms | Kafka, Spark, Airflow, Postgres (see `sandbox/platforms/`) |
| Remote control | SSH + optional `kubectl` tunnel from MacBook |

---

## Hardware profile (reference)

| Resource | Value | Implication |
| -------- | ----- | ----------- |
| CPU | Apple M4, 10 cores | Sufficient for lab workloads |
| RAM | **16 GB** | Tight — cap VM at 8 GB; limit Spark workers |
| Disk | 228 GB internal | Target **≥ 80 GB free** before k8s + images |
| OS | macOS 26.x (Tahoe) | OrbStack has known issues; prefer Colima |

### RAM budget (16 GB Mac Mini)

| Layer | Allocation |
| ----- | ---------- |
| macOS | ~4 GB headroom |
| Colima VM | **8 GB** (10 GB max if needed) |
| Always-on platforms | Kafka + Postgres + Airflow ≈ 4–5 GB |
| Spark | **2 workers on demand** (not 4 workers 24/7) |

Devlabs dev Compose profile caps platforms at ~8 GB total (`sandbox/platforms/docker-compose.dev-*.yml`). Spark images are **linux/amd64** and run under emulation on Apple Silicon — slower and more RAM-hungry than on x86.

---

## Server foundation

### 1. Dedicated user

Create a server account (e.g. `devlabs`) — not your daily Mac account.

```bash
sudo sysadminctl -addUser devlabs -fullName "Devlabs Server" -password "STRONG_PASSWORD" -admin
```

Log in once as `devlabs` to create `/Users/devlabs`.

**Administrator** is recommended for Homebrew, LaunchDaemons, and Docker/Colima.

### 2. Network

| Setting | Example |
| ------- | ------- |
| LAN IP | `192.168.1.2` (DHCP reservation on router preferred) |
| Hostname | `devlabs-mini.local` (mDNS) |
| SSH | System Settings → Sharing → Remote Login → ON |

From MacBook:

```bash
ssh devlabs@192.168.1.2
```

Optional `~/.ssh/config` on MacBook:

```sshconfig
Host devlabs-mini
  HostName 192.168.1.2
  User devlabs
  IdentityFile ~/.ssh/id_ed25519
```

### 3. Always-on (headless)

| Setting | Where |
| ------- | ----- |
| Prevent sleep on power adapter | System Settings → Energy |
| Start up after power failure | Energy → Options |
| Auto-login as `devlabs` | Users & Groups (for services at boot) |
| HDMI dummy plug | Optional — prevents aggressive sleep without a display |

Terminal check:

```bash
sudo pmset -a sleep 0 disksleep 0 displaysleep 0 autorestart 1
```

### 4. Disk hygiene

Before heavy deploys, ensure **≥ 80 GB free**:

```bash
df -h /System/Volumes/Data
du -sh * 2>/dev/null | sort -hr | head -10
```

Common space hogs on a shared Mac: `~/.ollama`, Android AVDs, npm/gradle/uv caches, Docker/OrbStack data, iMovie.

Cleanup caches (safe to delete; tools re-download as needed):

```bash
npm cache clean --force
rm -rf ~/.npm/_cacache ~/.gradle/caches ~/.cache/uv
```

Files under another user's home require that user or `sudo`.

### 5. UPS (recommended)

Power loss causes hard shutdown. A UPS with graceful shutdown (`sudo shutdown -h now` on low battery) protects Postgres/Kafka data.

---

## Container runtime: Colima (chosen path)

### Why Colima over OrbStack

| Issue with OrbStack | Colima |
| ------------------- | ------ |
| Requires GUI approval for privileged helper on first run | CLI-only over SSH |
| `orb start` / `docker.sock` hangs headless | Works on headless Mac Mini |
| macOS 26 + M4 zombie/vmgr reports | Stable for home-lab use |

### Remove OrbStack (if installed)

```bash
killall OrbStack 2>/dev/null
killall "OrbStack Helper" 2>/dev/null
brew uninstall --cask orbstack 2>/dev/null
rm -rf ~/.orbstack
docker context use default 2>/dev/null || true
unset DOCKER_HOST
```

Quit Docker Desktop if present — use **one** runtime only.

### Install Colima

On Mac Mini as `devlabs`:

```bash
brew install colima kubectl helm
```

### Start with Kubernetes

For 16 GB RAM:

```bash
colima start --cpu 4 --memory 8 --kubernetes
```

Verify:

```bash
colima status
docker ps
kubectl get nodes
kubectl get pods -A
```

Kubeconfig: `~/.kube/config` on the Mac Mini.

Check API server port (Colima may use a non-default port):

```bash
grep server ~/.kube/config
# Example: server: https://127.0.0.1:53067
```

### Auto-start on boot — **not yet configured**

**Status:** Colima does **not** start automatically when the Mac Mini reboots. You must run `colima start` manually after each restart until one of the options below is implemented.

LaunchAgent via `launchctl bootstrap gui/$UID` failed over pure SSH (`Bootstrap failed: 5: Input/output error`) — LaunchAgents need an active GUI session.

| Method | Notes | Status |
| ------ | ----- | ------ |
| **LaunchDaemon** (`/Library/LaunchDaemons/`) | Best for headless; needs sudo | Recommended next |
| **crontab `@reboot`** | Simple; no sudo | Good fallback |
| **LaunchAgent from Screen Sharing** | Load plist from GUI Terminal as `devlabs` | Optional |

**Manual start after every reboot (current workaround):**

```bash
ssh devlabs@192.168.1.2
colima start --cpu 4 --memory 8 --kubernetes
colima status
kubectl get nodes
```

#### Option A — LaunchDaemon (headless, needs admin)

On Mac Mini as `devlabs` (with sudo):

```bash
COLIMA_PATH=$(which colima)

sudo tee /Library/LaunchDaemons/dev.colima.start.plist > /dev/null << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.colima.start</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>${COLIMA_PATH} start --cpu 4 --memory 8 --kubernetes || ${COLIMA_PATH} start --cpu 4 --memory 8 --kubernetes</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>UserName</key>
  <string>devlabs</string>
  <key>StandardOutPath</key>
  <string>/Users/devlabs/Library/Logs/colima-start.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/devlabs/Library/Logs/colima-start.err</string>
</dict>
</plist>
EOF

sudo chown root:wheel /Library/LaunchDaemons/dev.colima.start.plist
sudo chmod 644 /Library/LaunchDaemons/dev.colima.start.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/dev.colima.start.plist
```

Verify after reboot: `tail ~/Library/Logs/colima-start.log` and `colima status`.

#### Option B — crontab (no sudo)

```bash
crontab -e
```

Add (adjust path from `which colima`):

```cron
@reboot sleep 60 && /opt/homebrew/bin/colima start --cpu 4 --memory 8 --kubernetes
```

---

## Remote kubectl from MacBook — **not yet achieved**

**Status:** Documented below as the **target setup**. Cluster works locally on the Mac Mini (`ssh devlabs@192.168.1.2` → `kubectl get nodes`), but remote control from the MacBook via SSH tunnel is not verified yet.

**Workaround until tunnel works:** run all `kubectl` commands over SSH on the Mac Mini:

```bash
ssh devlabs@192.168.1.2
kubectl get nodes
kubectl get pods -A
```

The Kubernetes API listens on **localhost on the Mac Mini**, not on the LAN. Remote access requires an SSH tunnel.

### 1. Install kubectl on MacBook

```bash
brew install kubectl
```

Optional alias:

```bash
# ~/.zshrc
alias k='kubectl --kubeconfig=$HOME/.kube/devlabs-mini-config'
```

### 2. SSH config with port forward

Use the port from `grep server ~/.kube/config` on the Mac Mini (example: **53067**):

```sshconfig
Host devlabs-mini
  HostName 192.168.1.2
  User devlabs
  IdentityFile ~/.ssh/id_ed25519
  LocalForward 53067 127.0.0.1:53067
```

Create config if missing:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
chmod 600 ~/.ssh/config
```

### 3. Copy and edit kubeconfig

```bash
mkdir -p ~/.kube
scp devlabs@192.168.1.2:~/.kube/config ~/.kube/devlabs-mini-config
```

Edit `~/.kube/devlabs-mini-config` — set:

```yaml
server: https://127.0.0.1:53067
```

Keep `certificate-authority-data` and other auth fields unchanged.

### 4. Two-terminal workflow (verify when completing this step)

**Terminal 1 (MacBook)** — keep open:

```bash
ssh devlabs-mini
```

**Terminal 2 (MacBook)**:

```bash
export KUBECONFIG=~/.kube/devlabs-mini-config
kubectl get nodes
# or: k get nodes
```

**Verification checklist (mark done when all pass):**

- [ ] `ssh devlabs-mini` connects without error
- [ ] `curl -k https://127.0.0.1:53067/version` returns JSON (Terminal 2, tunnel open)
- [ ] `kubectl get nodes` shows `Ready` (Terminal 2)
- [ ] `alias k='kubectl --kubeconfig=~/.kube/devlabs-mini-config'` in `~/.zshrc` (optional)

Test tunnel:

```bash
curl -k https://127.0.0.1:53067/version
```

### Alternative: kubectl only over SSH (current approach)

No MacBook tunnel required — run on the Mac Mini:

```bash
ssh devlabs@192.168.1.2
kubectl get nodes
```

---

## Inspecting cluster resources

```bash
# Overview
kubectl get nodes -o wide
kubectl get pods -A
kubectl get all -A

# Capacity vs allocated
kubectl describe node
# See "Allocatable" and "Allocated resources" at the bottom

# Live usage (requires metrics-server)
kubectl top nodes
kubectl top pods -A
```

If `kubectl top` fails, install metrics-server:

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch deployment metrics-server -n kube-system --type='json' -p='[
  {"op": "add", "path": "/spec/template/spec/containers/0/args/-", "value": "--kubelet-insecure-tls"}
]'
```

Optional terminal UI: `brew install k9s`

---

## Devlabs platforms

Platform Kubernetes deploy trees live in **separate git repos** under the `devlabs-ai` org folder (sibling to `devlabs/`). This repo keeps Compose stacks under `sandbox/platforms/` for local dev.

```text
~/Documents/devlabs-ai/          # org folder — not a git repo
├── devlabs/                     # this repo
└── platforms/
    ├── spark-platform/
    ├── airflow-platform/
    ├── minio-platform/
    ├── postgres-platform/
    └── devlabs-dashboard/
```

**Deploy from MacBook** (example — Spark):

```bash
cd ~/Documents/devlabs-ai
rsync -az platforms/spark-platform/ devlabs-mini:~/spark-platform/
ssh devlabs-mini 'bash -lc "MAC_MINI_IP=192.168.1.2 ~/spark-platform/scripts/deploy.sh"'
```

### Compose path (matches repo today)

Platforms live under `sandbox/platforms/`. Start all four stacks on a shared Docker network:

```bash
make platforms-up
make platforms-ps
make platforms-down
```

| Service | Host port (`platforms.env`) |
| ------- | --------------------------- |
| Spark cluster UI | 8080 |
| Spark History | 18080 |
| Kafka | 9092 |
| Airflow UI | 8081 (admin / admin) |
| Postgres warehouse | 5433 |

Requires Colima running (`colima start` without `--kubernetes` is enough for Compose-only).

### Kubernetes path (planned layout)

```text
Namespaces: kafka | spark | airflow | postgres

Deploy order:
  1. Postgres
  2. Kafka
  3. Airflow (Helm)
  4. Spark (2 workers on 16 GB; 4 workers on demand only)
```

Platform contracts: `sandbox/platforms/*/platform.json`

---

## OrbStack reference (abandoned path)

Documented for troubleshooting if OrbStack is retried later.

**Correct CLI (not `orbctl k8s enable`):**

```bash
orb start
orb config set k8s.enabled true
orb config set k8s.expose_services true
orb start k8s
orb logs -a k8s
```

**Wrong keys/commands:**

| Wrong | Correct |
| ----- | ------- |
| `orbctl k8s enable` | `orb start k8s` |
| `kubernetes.enabled` | `k8s.enabled` |

**Headless recovery:**

```bash
killall OrbStack "OrbStack Helper" vmgr 2>/dev/null
rm -f ~/.orbstack/run/status/running
open -a OrbStack   # often needs Screen Sharing once
```

---

## Power loss behavior

| Event | Behavior |
| ----- | -------- |
| Power cut | All containers/k8s stops immediately; in-flight jobs lost |
| Power returns | Mac may stay off unless "Start up after power failure" is enabled |
| After boot | Colima/k8s does **not** auto-start until LaunchDaemon/cron configured |
| Persistent data | PVCs / Docker volumes usually survive if disk intact |
| Postgres/Kafka | Repeated hard power-off increases corruption risk — use UPS |

---

## Architecture (target)

```text
MacBook (dev machine)
    │
    │ SSH (22) — working
    │ kubectl tunnel (53067) — not yet configured
    ▼
Mac Mini M4 — devlabs@192.168.1.2
    │
    ├── macOS 26.x
    ├── Colima VM (4 CPU, 8 GB RAM) — manual start after reboot
    │     ├── Docker / Compose  →  make platforms-up
    │     └── k3s (Kubernetes)
    │
    └── Platform namespaces (k8s path)
          ├── kafka
          ├── airflow
          ├── spark (on demand)
          └── postgres
```

---

## Checklist

### Done

- [x] `devlabs` user + SSH from MacBook
- [x] Disk cleaned (~80 GB free)
- [x] Resource audit (16 GB RAM, M4, 10 cores)
- [x] OrbStack abandoned; Colima chosen
- [x] Kubernetes cluster up on Mac Mini (manual `colima start`)
- [x] `kubectl` works locally on Mac Mini over SSH

### Not yet done

- [ ] **Remote kubectl from MacBook** (SSH tunnel + kubeconfig on MacBook; port 53067)
- [ ] **`kubectl` alias `k` on MacBook** (optional, after remote kubectl works)
- [ ] **Colima auto-start on Mac Mini reboot** (LaunchDaemon or crontab)

### Next steps

- [ ] Complete remote kubectl verification checklist (see above)
- [ ] Configure Colima auto-start (LaunchDaemon recommended)
- [ ] UPS + graceful shutdown
- [ ] DHCP reservation for `192.168.1.2`
- [ ] Deploy platforms: Compose (`make platforms-up`) or k8s Helm
- [ ] Create namespaces: `kafka`, `spark`, `airflow`, `postgres`

---

## Useful commands

```bash
# Mac Mini — system
sysctl -n hw.memsize hw.ncpu machdep.cpu.brand_string
df -h /System/Volumes/Data

# Mac Mini — Colima
colima status
colima stop
colima delete
colima start --cpu 4 --memory 8 --kubernetes

# Mac Mini — Devlabs Compose
make platforms-up
make platforms-ps
make platforms-down

# MacBook — remote k8s
ssh devlabs-mini
export KUBECONFIG=~/.kube/devlabs-mini-config
kubectl get nodes
kubectl top nodes
```

---

## Related docs

- [Host requirements (Linux / EC2)](host-requirements.md) — production EC2 tuning
- [Platforms README](../sandbox/platforms/README.md) — Compose layout and RAM caps
- [Spark Platform on k8s](../platforms/spark-platform/docs/spark-platform-kubernetes.md) — full implementation guide (Operator, API, UI, History Server)
- [Spark Platform README](../platforms/spark-platform/README.md) — quick deploy commands
- [MinIO Platform on k8s](../platforms/minio-platform/docs/minio-platform-kubernetes.md) — S3-compatible object storage
- [MinIO Platform README](../platforms/minio-platform/README.md) — quick deploy commands
- [Airflow Platform on k8s](../platforms/airflow-platform/docs/airflow-platform-kubernetes.md) — Airflow as a service (portal + scheduler)
- [Airflow Platform README](../platforms/airflow-platform/README.md) — quick deploy commands
- [PostgreSQL Platform on k8s](../platforms/postgres-platform/docs/postgres-platform-kubernetes.md) — shared Postgres (official image, no Bitnami)
- [PostgreSQL Platform README](../platforms/postgres-platform/README.md) — quick deploy commands
- [Platform reliability (flaky URLs, OOM)](../platforms/devlabs-dashboard/docs/mac-mini-platform-reliability.md) — why LAN URLs fail intermittently on 16 GB

---

## Spark Platform (deployed)

| URL | Purpose |
|-----|---------|
| http://192.168.1.2:30088 | Job portal (submit, status, logs) |
| http://192.168.1.2:30080 | Spark History Server (completed jobs) |

Deploy or upgrade on the Mac Mini (after `rsync` to `~/spark-platform/`):

```bash
MAC_MINI_IP=192.168.1.2 ~/spark-platform/scripts/deploy.sh
```

---

## MinIO Platform (deployed)

| URL | Purpose |
|-----|---------|
| http://192.168.1.2:30900 | S3 API |
| http://192.168.1.2:30901 | MinIO web console |

Deploy or upgrade on the Mac Mini:

```bash
MAC_MINI_IP=192.168.1.2 ~/minio-platform/scripts/deploy.sh
```

Default buckets: `spark-logs`, `devlabs-data`. See [MinIO guide](../platforms/minio-platform/docs/minio-platform-kubernetes.md) for credentials and `mc` examples.

---

## Airflow Platform (deployed)

| URL | Purpose |
|-----|---------|
| http://192.168.1.2:30089 | Job portal (trigger DAGs, runs, task logs) |
| http://192.168.1.2:30081 | Native Airflow UI (`admin` / `admin`) |

Deploy or upgrade on the Mac Mini:

```bash
MAC_MINI_IP=192.168.1.2 ~/airflow-platform/scripts/deploy.sh
```

Sample DAGs: `hello_platform`, `etl_orders_sample`. First install takes 10–15 minutes.

---

## PostgreSQL Platform

| URL / connection | Purpose |
|------------------|---------|
| `postgresql://devlabs@192.168.1.2:30432/devlabs` | LAN access (NodePort **30432**) |
| `postgres.postgres.svc.cluster.local:5432` | In-cluster |

Deploy or upgrade on the Mac Mini:

```bash
MAC_MINI_IP=192.168.1.2 ~/postgres-platform/scripts/deploy.sh
```

Uses official **`postgres:16-alpine`** — no Bitnami. Default password: `devlabs-postgres-change-me`. See [PostgreSQL guide](../platforms/postgres-platform/docs/postgres-platform-kubernetes.md) for bootstrap databases and `psql` examples.

---

## Devlabs Platform Dashboard

| URL | Purpose |
|-----|---------|
| http://192.168.1.2:30090 | Unified platform status, component health, CPU/RAM allocations |

Deploy or upgrade:

```bash
MAC_MINI_IP=192.168.1.2 ~/devlabs-dashboard/scripts/deploy.sh
```

Monitors Spark, Airflow, MinIO, and PostgreSQL platforms. See [dashboard README](../platforms/devlabs-dashboard/README.md).
