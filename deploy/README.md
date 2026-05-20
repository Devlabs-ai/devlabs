# Devlabs — AWS EC2 deployment (single host)

Target: one **Amazon Linux 2023** EC2 instance running the **full platform** (Play, Authoring, Pipeline, Review, Memories) with **Postgres + Redis in Docker**, **no custom domain** (access via Elastic IP over HTTP).

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

Workflow: [.github/workflows/docker-backend.yml](../.github/workflows/docker-backend.yml) — runs on push to `main` / `ft/deploy` when backend or `deploy/Dockerfile.backend` changes.

Verified challenges ship in git under `sandbox/verified/` and are mounted into the backend container at runtime.

### One-time GitHub setup

In **GitHub → Settings → Secrets and variables → Actions**, add:

| Secret | Value |
| ------ | ----- |
| `DOCKERHUB_USERNAME` | `rithvikreddyalkanti` |
| `DOCKERHUB_TOKEN` | Docker Hub **Access Token** (Account → Security → New Access Token) |

Push to `ft/deploy` (or run the workflow manually) and confirm the image appears on Docker Hub before deploying EC2.

EC2 pulls this image over the public internet — **no `docker login` required** for a public repo.

## 4. Deploy on the server

```bash
git clone https://github.com/Rithvik89/Devlabs.git
cd Devlabs
git checkout ft/deploy   # or main once deploy is merged

# Secrets
cp deploy/env.production.example .env
nano .env   # set PGPASSWORD, JWT_SECRET, PUBLIC_HOST=<elastic-ip>, LLM keys

# Frontend static build (still built on the VM — not in Docker Hub)
cd frontend && npm ci && npm run build && cd ..

# Pull platform images (backend from Docker Hub; postgres/redis/nginx from Hub)
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

# Optional: seed specialists handbook (idempotent)
docker compose -f docker-compose.prod.yml exec backend node scripts/seedMemory.js
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

# Logs
docker compose -f docker-compose.prod.yml logs -f backend nginx

# Restart after a new backend image was pushed to Docker Hub
git pull
cd frontend && npm run build && cd ..
docker compose -f docker-compose.prod.yml pull backend
docker compose -f docker-compose.prod.yml up -d

# Backup Postgres
docker exec devlabs-postgres pg_dump -U postgres devlabs > devlabs-$(date +%F).sql
```

### Disk hygiene

Ephemeral session dirs accumulate under the `devlabs_sandbox_sessions` volume. Periodically prune stopped containers and dangling images:

```bash
docker system prune -f
```

## 6. Full platform env

Set in `.env` on the server:


| Variable                                                 | Required for                        |
| -------------------------------------------------------- | ----------------------------------- |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` + `LLM_PROVIDER` | Problem Setter chat, build pipeline |
| `OPENAI_API_KEY`                                         | Lesson embeddings (Memories search) |


Without keys, Play still works; Authoring chat/build and semantic memory retrieval are degraded (see root `README.md`).

## 7. When you add a domain later

1. Point DNS A record → Elastic IP.
2. Terminate TLS at nginx (Certbot on the instance, or ACM + ALB in front).
3. Switch invites and bookmarks to `https://your.domain`.
4. Browser WS rewrite already follows page scheme (`ws` / `wss`).

## Host tuning

Elasticsearch and OpenSearch challenges require `vm.max_map_count=262144` on the Linux host. Why, which challenges are affected, and how to verify: **[docs/host-requirements.md](../docs/host-requirements.md)**.

## Known gaps (before go-live)

1. **Default admin password** (`admin` / `admin123`) — rotate before sharing the public IP.
2. **No TLS** without a domain — fine for private demos; add HTTPS when DNS is ready.
3. **Authoring build ports (6000–6999)** must be reachable if you validate builds from a remote browser.

## Smoke test (after deploy)

- `curl http://<PUBLIC_HOST>/health` → `{"ok":true,...}`
- Login as interviewer → Challenge Library loads
- Start **broken-postgres** → terminal connects, metrics stream
- Authoring → Problem Setter responds (if LLM key set)
- Create candidate invite → open link in incognito → session starts
- End session → score returned, containers torn down

---

### Appendix: Ubuntu 22.04 (optional)

If you use Ubuntu instead of Amazon Linux, SSH as `**ubuntu@<elastic-ip>`** and install Docker via apt — see [Docker’s Ubuntu install guide](https://docs.docker.com/engine/install/ubuntu/). Use `sudo usermod -aG docker ubuntu` instead of `ec2-user`.