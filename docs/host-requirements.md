# Host requirements (Linux / EC2)

Devlabs runs interview sandboxes with `docker compose` on the **same machine** as the backend. Some challenge images impose extra requirements on the **host OS**, not only on Docker.

This document explains **`vm.max_map_count`** — the most common host tuning step for production deploys.

---

## `vm.max_map_count` and search-engine challenges

### What the setting is

On Linux, `vm.max_map_count` is a kernel limit: **how many separate memory-mapped regions one process may have at once**.

Many programs use a small number of maps. **Elasticsearch** and **OpenSearch** (and anything built on Lucene) use **thousands** of small on-disk index files; the JVM maps each segment into virtual memory. Startup and indexing need a high map count.

| Value | Meaning |
| ----- | ------- |
| Default on many Linux hosts | `65530` |
| Recommended for Elasticsearch / OpenSearch | **at least `262144`** |

This is **not** extra RAM allocation. It only raises a **counter** of how many map regions are allowed.

### Why Devlabs cares

When an interviewer or candidate starts a session, the backend:

1. Copies a verified challenge bundle from `sandbox/verified/<slug>/` into `sandbox/sessions/<sessionId>/`
2. Runs `docker compose up` on the EC2 host

Containers run as processes on the **host kernel**. Kernel limits apply to the host first, then to containers.

Challenges that include **Elasticsearch** or **OpenSearch** services will fail on a default host unless `vm.max_map_count` is raised. Typical container log / exit message:

```text
max virtual memory areas vm.max_map_count [65530] is too low, increase to at least [262144]
```

Challenges that use only Postgres, Redis, Kafka, nginx, etc. **do not** need this setting. We still document and apply it on deploy hosts so **any** catalog challenge can run without silent failures when someone picks a search-engine scenario.

### Apply on Amazon Linux 2023 (persistent)

```bash
echo 'vm.max_map_count=262144' | sudo tee /etc/sysctl.d/99-devlabs.conf
sudo sysctl --system
```

Log out / reboot is not required if `sysctl --system` succeeds.

### Verify

```bash
sysctl vm.max_map_count
# expected: vm.max_map_count = 262144
```

### If you skip it

| Scenario | Expected behavior |
| -------- | ------------------- |
| Play **broken-postgres**, Kafka-only, nginx, etc. | Usually works |
| Session with **Elasticsearch** or **OpenSearch** service | Container fails or stays unhealthy |

### References

- [Elasticsearch: Virtual memory (Docker prod prerequisites)](https://www.elastic.co/guide/en/elasticsearch/reference/current/docker.html#docker-prod-prerequisites)
- [OpenSearch installation — important settings](https://docs.opensearch.org/latest/install-and-configure/install-opensearch/index/)

---

## Other host notes (brief)

| Topic | Notes |
| ----- | ----- |
| **Docker socket** | Backend container mounts `/var/run/docker.sock` so it can start per-session compose stacks. |
| **Ports 7000–7999** | Live compose sessions bind on the host; security group must allow them if browsers reach sandbox HTTP endpoints remotely. |
| **Disk** | Docker images and session workspaces grow quickly; 40–80 GB root volume recommended on EC2. |

See [deploy/README.md](../deploy/README.md) for full EC2 setup steps.
