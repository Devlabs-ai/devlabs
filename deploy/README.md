# Devlabs — AWS EC2 deployment (single host)

Target: one **Amazon Linux 2023** EC2 instance running **Play** with **Postgres + Redis in Docker**, **no custom domain** (access via Elastic IP over HTTP).

## Architecture

```
Internet :80
    └── nginx (static frontend + /api + /ws proxy)
            └── backend:4000 (Node, docker.sock mounted)
                    ├── postgres (pgvector)
                    ├── redis
                    └── per-session challenge stacks (host ports 6000–7999)
```

- **Invite / candidate URLs** use `window.location.origin` — share `http://<PUBLIC_IP>/?candidate=<token>`.
- **WebSockets** are rewritten in the browser to the same host as the page (works behind nginx).
- **Sandbox HTTP links** in the metrics panel use the page hostname (works when you open the app via the EC2 public IP).

## 1. EC2 instance


| Setting    | Recommendation                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| AMI        | **Amazon Linux 2023**                                                                                                               |
| Type       | **m7i-flex.large** (2 vCPU, 8 GiB) — one concurrent sandbox; heavier challenges (Spark/ES) need patience or a larger instance later |
| Disk       | **40–80 GB** gp3 root volume (8 GB default is too small for Docker images + sessions)                                               |
| Elastic IP | Allocate and associate so the public IP stays stable across stop/start                                                              |
| SSH user   | `**ec2-user`** (default on Amazon Linux)                                                                                            |


### Install on the host (Amazon Linux 2023)

SSH in:

```bash
ssh -i /path/to/your-key.pem ec2-user@<YOUR_ELASTIC_IP>
```

Install Docker, Git, Node (for frontend build), and kernel tuning:

```bash
# Docker Engine (Compose plugin is NOT in default AL2023 repos — install manually below)
sudo dnf update -y
sudo dnf install -y docker git

sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user

# Docker Compose v2 CLI plugin (required for `docker compose`)
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL "https://github.com/docker/compose/releases/download/v2.24.5/docker-compose-linux-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Node.js 20 for one-time frontend build (NodeSource — AL2023 default node is often too old)
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs

# Host kernel limit for Elasticsearch / OpenSearch (see docs/host-requirements.md)
echo 'vm.max_map_count=262144' | sudo tee /etc/sysctl.d/99-devlabs.conf
sudo sysctl --system
```

**Log out and SSH back in** so group membership applies and `docker` works without `sudo`:

```bash
exit
ssh -i /path/to/your-key.pem ec2-user@<YOUR_ELASTIC_IP>
docker ps   # should work without sudo
```

Verify Compose:

```bash
docker compose version
```

## 2. Security group


| Port      | Source                     | Purpose                      |
| --------- | -------------------------- | ---------------------------- |
| 22        | Your IP only               | SSH                          |
| 80        | `0.0.0.0/0` (or office IP) | App (nginx)                  |
| 6000–6999 | Same as 80                 | Build pipeline sandbox ports |
| 7000–7999 | Same as 80                 | Live interview sandbox ports |


The EC2 launch wizard only adds SSH/HTTP checkboxes — **add 6000–6999 and 7000–7999 manually** under **EC2 → Security groups → Edit inbound rules**.

Do **not** expose Postgres (5432) or Redis (6379) to the internet; they stay on the Docker internal network.

Restrict 6000–7999 to your IP if you can; opening them worldwide is convenient for demos but widens the attack surface.

## 3. Backend image (GitHub Actions → Docker Hub)

The **backend** is built in CI and published to a **public** Docker Hub repo:

**[rithvikreddyalkanti/devlabs-backend](https://hub.docker.com/r/rithvikreddyalkanti/devlabs-backend)**

Workflow: [.github/workflows/build-and-deploy.yml](../.github/workflows/build-and-deploy.yml)

1. **CI** — build `deploy/Dockerfile.backend` and push to Docker Hub  
2. **CD** — SSH to EC2, `git pull`, rebuild frontend, `docker compose pull` + `up -d`

Runs on every push to **`main`**, and via **workflow_dispatch**.

Verified challenges ship in git under `sandbox/verified/` and are mounted into the backend container at runtime.

### One-time GitHub setup

In **GitHub → Settings → Secrets and variables → Actions**, add:

| Secret | Required | Value |
| ------ | -------- | ----- |
| `DOCKERHUB_USERNAME` | yes | `rithvikreddyalkanti` |
| `DOCKERHUB_TOKEN` | yes | Docker Hub access token (read/write) |
| `EC2_HOST` | yes (for CD) | Elastic IP, e.g. `54.x.x.x` |
| `EC2_USER` | yes (for CD) | `ec2-user` |
| `EC2_SSH_KEY` | yes (for CD) | Full PEM private key used to SSH into the instance |
| `EC2_APP_DIR` | no | Default `/home/ec2-user/Devlabs` |
| `EC2_DEPLOY_BRANCH` | no | Unused by CI; deploy always checks out **`main`** on EC2 |

**EC2 prerequisites for CD:** Node.js 20+ (`npm ci` / `npm run build` for frontend), git clone of this repo, `.env` configured, security group allows **SSH (22)** from GitHub Actions IPs (or use a self-hosted runner on the VPC).

EC2 pulls the backend image over the public internet — **no `docker login` required** for a public Hub repo.

## 4. Deploy on the server

```bash
git clone https://github.com/Rithvik89/Devlabs.git
cd Devlabs
git checkout main

# Secrets
cp deploy/env.production.example .env
nano .env   # set PGPASSWORD, JWT_SECRET, PUBLIC_HOST=<elastic-ip>

# Frontend static build (still built on the VM — not in Docker Hub)
cd frontend && npm ci && npm run build && cd ..

# Pull platform images (backend from Docker Hub; postgres/redis/nginx from Hub)
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Pin a specific backend build (optional):

```bash
export DEVLABS_BACKEND_TAG=<git-sha-from-github-actions>
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Open **http://YOUR_ELASTIC_IP/** (no TLS until you add a domain).

Default MVP login (`admin` / `admin123`) — **change before sharing the URL**.

Quick check:

```bash
docker compose -f docker-compose.prod.yml ps
curl -s http://localhost/health
```

## 5. Operations

```bash
cd ~/Devlabs   # or wherever you cloned
```

### Install `make` on Amazon Linux (optional)

```bash
sudo dnf install -y make
```

### Deploy / restart on EC2

**Full deploy** (git pull + frontend build + image pull + up) — same as GitHub CD:

```bash
make prod-deploy
# or: DEPLOY_BRANCH=main ./scripts/prod-deploy.sh
```

**Restart only** (new Docker image, no git/frontend changes):

```bash
make prod-restart
# or: ./scripts/prod-restart.sh
```

### Logs

```bash
docker compose -f docker-compose.prod.yml logs -f backend nginx

# Backup Postgres
docker exec devlabs-postgres pg_dump -U postgres devlabs > devlabs-$(date +%F).sql
```

### Disk hygiene

Ephemeral session dirs accumulate under the `devlabs_sandbox_sessions` volume. Periodically prune stopped containers and dangling images:

```bash
docker system prune -f
```

## 6. When you add a domain later

1. Point DNS A record → Elastic IP.
2. Terminate TLS at nginx (Certbot on the instance, or ACM + ALB in front).
3. Switch bookmarks to `https://your.domain`.
4. Browser WS rewrite already follows page scheme (`ws` / `wss`).

## Host tuning

Elasticsearch and OpenSearch challenges require `vm.max_map_count=262144` on the Linux host. Why, which challenges are affected, and how to verify: **[docs/host-requirements.md](../docs/host-requirements.md)**.

## Mac Mini Kubernetes platforms

Managed platform deploy trees live in separate repos under the `devlabs-ai` org folder (sibling to this repo). See **[../platforms/README.md](../platforms/README.md)** and **[docs/mac-mini-server-setup.md](../docs/mac-mini-server-setup.md)**.

## Known gaps (before go-live)

1. **Default admin password** (`admin` / `admin123`) — rotate before sharing the public IP.
2. **No TLS** without a domain — fine for private demos; add HTTPS when DNS is ready.
3. **Play session ports (7000–7999)** must be reachable if browsers hit compose sandbox HTTP endpoints remotely.

## Smoke test (after deploy)

- `curl http://<PUBLIC_HOST>/health` → `{"ok":true,...}`
- Login → Challenge Library loads
- Start a Spark (or compose) challenge → workspace / terminal works
- End session → containers / workspace torn down

---

### Appendix: Ubuntu 22.04 (optional)

If you use Ubuntu instead of Amazon Linux, SSH as `**ubuntu@<elastic-ip>`** and install Docker via apt — see [Docker’s Ubuntu install guide](https://docs.docker.com/engine/install/ubuntu/). Use `sudo usermod -aG docker ubuntu` instead of `ec2-user`.