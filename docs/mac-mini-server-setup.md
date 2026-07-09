# Mac Mini M4 home-lab server setup

Guide for running Devlabs managed platforms (Kafka, Spark, Airflow, Postgres) on a dedicated **Mac Mini M4** as an always-on home server, controlled remotely from a MacBook over SSH.

This documents the setup path we validated: **Colima + k3s** (CLI-only, headless). OrbStack was attempted but abandoned due to headless/GUI helper issues on macOS 26.

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
| LAN IP | `192.168.1.3` (DHCP reservation on router preferred) |
| Hostname | `devlabs-mini.local` (mDNS) |
| SSH | System Settings → Sharing → Remote Login → ON |

From MacBook:

```bash
ssh devlabs@192.168.1.3
```

Optional `~/.ssh/config` on MacBook:

```sshconfig
Host devlabs-mini
  HostName 192.168.1.3
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

### Auto-start on boot (deferred)

LaunchAgent via `launchctl bootstrap gui/$UID` often fails over pure SSH (error 5 — no GUI session). Options for later:

| Method | Notes |
| ------ | ----- |
| **LaunchDaemon** (`/Library/LaunchDaemons/`) | Best for headless; needs sudo |
| **crontab `@reboot`** | Simple; `sleep 60 && colima start ...` |
| **LaunchAgent from Screen Sharing** | Load plist from GUI Terminal while logged in as `devlabs` |

Manual start after reboot until auto-start is configured:

```bash
colima start --cpu 4 --memory 8 --kubernetes
```

---

## Remote kubectl from MacBook

The Kubernetes API listens on **localhost on the Mac Mini**, not on the LAN. Use an SSH tunnel.

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
  HostName 192.168.1.3
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
scp devlabs@192.168.1.3:~/.kube/config ~/.kube/devlabs-mini-config
```

Edit `~/.kube/devlabs-mini-config` — set:

```yaml
server: https://127.0.0.1:53067
```

Keep `certificate-authority-data` and other auth fields unchanged.

### 4. Two-terminal workflow

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

Test tunnel:

```bash
curl -k https://127.0.0.1:53067/version
```

### Alternative: kubectl only over SSH

No MacBook install or tunnel — run on the Mac Mini:

```bash
ssh devlabs@192.168.1.3
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
    │ SSH (22) + kubectl tunnel (e.g. 53067)
    ▼
Mac Mini M4 — devlabs@192.168.1.3
    │
    ├── macOS 26.x
    ├── Colima VM (4 CPU, 8 GB RAM)
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

### Done (reference setup)

- [x] `devlabs` user + SSH from MacBook
- [x] Disk cleaned (~80 GB free)
- [x] Resource audit (16 GB RAM, M4, 10 cores)
- [x] OrbStack abandoned; Colima chosen
- [x] Kubernetes cluster up on Mac Mini
- [x] Remote kubectl via SSH tunnel (port 53067)
- [x] `kubectl` alias `k` on MacBook

### Next steps

- [ ] Auto-start Colima on boot (LaunchDaemon or crontab)
- [ ] UPS + graceful shutdown
- [ ] DHCP reservation for `192.168.1.3`
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
