# Solution — Memory and CPU Limits

Without limits, a container can use all the memory and CPU of the machine. One runaway report job and order-processor (and the whole box) slows to a crawl, or the kernel starts killing random processes. Limits are the same **cgroups** you met in the Linux track; Docker just sets them for you.

Docs: [Resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)

## Watch a job blow its limit

```bash
docker run --name report-big --memory 128m quickbyte/report-builder:1.0
# report-builder: loading 300 MB of orders
# report-builder: 50 MB loaded
# (silence: killed)
docker inspect -f 'OOMKilled={{.State.OOMKilled}} exit={{.State.ExitCode}}' report-big
# OOMKilled=true exit=137
docker inspect -f '{{.State.ExitCode}}' report-big > ~/answers/report-big-exit-code
```

`137` = 128 + 9: killed by **SIGKILL**. The kernel's OOM killer gave the process no chance to clean up or log anything. `OOMKilled=true` is how you tell it apart from someone running `kill -9`. (In Kubernetes the same thing shows up as `OOMKilled` in `kubectl describe pod`.)

## Make the work fit

```bash
docker run --name report-small --memory 128m --cpus 0.5 --pids-limit 64 \
  -e REPORT_BATCH_MB=48 quickbyte/report-builder:1.0
# report done: 48 MB processed
```

- `--memory 128m` is a hard limit. The Python interpreter itself needs ~15 MB, so a 48 MB batch leaves headroom; 120 MB wouldn't.
- `--cpus 0.5` = at most half a CPU's time. Over the limit, the process is **throttled** (slowed down), not killed.
- `--pids-limit 64` caps the number of processes and threads: a fork bomb or thread leak hits the wall instead of taking the box down.

## Limit the long-running service too

```bash
docker run -d --name order-processor -p 8080:8000 \
  --memory 256m --cpus 1 --pids-limit 128 devsetu/order-processor:v1.2
docker stats --no-stream             # MEM USAGE / LIMIT, CPU %, PIDS
```

`docker stats` is your `top` for containers. Size limits from what the app really uses under load, plus headroom. `docker update --memory ... --cpus ...` changes them on a running container.

Then **Submit**.
