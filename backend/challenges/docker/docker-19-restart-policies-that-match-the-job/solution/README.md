# Solution — Restart Policies That Match the Job

In the Linux track, systemd's `Restart=` decided what happens when a service dies. For containers, Docker's **restart policy** does the same job, and it also decides what comes back after a reboot.

Docs: [Start containers automatically](https://docs.docker.com/engine/containers/start-containers-automatically/)

| Policy | Restarts after a crash | After Docker / host restarts | Good for |
|---|---|---|---|
| `no` (default) | no | no | one-off commands |
| `on-failure[:N]` | only on non-zero exit, at most N times | if it was still retrying | jobs that may hit a transient error |
| `unless-stopped` | yes | yes, **unless you stopped it** | long-running services |
| `always` | yes | yes, even if you stopped it | rarely what you want |

## Long-running services

```bash
docker run -d --name order-processor --restart unless-stopped -p 8080:8000 devsetu/order-processor:v1.2
docker run -d --name notification-service --restart unless-stopped devsetu/notification-service:v1.1
docker stop notification-service          # maintenance: should stay down
```

## A flaky job: retry, but not forever

```bash
docker run -d --name order-sync --restart on-failure:3 quickbyte/order-sync:1.0
docker ps -a --filter name=order-sync     # Restarting (1) ... then Exited (1)
docker inspect -f '{{.RestartCount}} restarts, exit {{.State.ExitCode}}' order-sync
docker logs order-sync                    # four runs: the first + 3 retries
```

Docker waits a little longer between each restart (100 ms, doubling) so a crash loop doesn't hammer the machine. A job that keeps failing after 3 tries has a real problem; restarting it forever (`always`) just hides it and floods the partner API.

## What survives a restart of Docker?

```bash
sudo systemctl restart docker            # what a reboot looks like to containers
docker ps -a --format 'table {{.Names}}\t{{.Status}}'
# order-processor        Up 2 seconds
# notification-service   Exited (0) ...   <- stopped on purpose, stays stopped
# order-sync             Exited (1) ...   <- gave up, stays down
```

With `always`, notification-service would have come back: an operator's `docker stop` undone by a reboot. That difference is the whole reason `unless-stopped` exists.

Kubernetes has the same idea per pod: `restartPolicy: Always` for Deployments, `OnFailure` with `backoffLimit` for Jobs.

Then **Submit**. The grader restarts Docker itself.
