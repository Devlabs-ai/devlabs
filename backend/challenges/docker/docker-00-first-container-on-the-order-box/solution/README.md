# Solution — First Container on the Order Box

A **container** is a process that Docker starts from an **image** (a read-only bundle of files: a mini filesystem plus a default command). `docker run` creates a container from an image and starts it; when its main process exits, the container stops but stays around until you remove it.

Docs: `docker run --help` · `docker ps --help` · `docker logs --help` (every subcommand has `--help`).

## Which Docker is this?

```bash
docker version            # Client: the CLI you type into. Server (Engine): dockerd doing the work.
docker version -f '{{.Server.Version}}'
mkdir -p ~/answers
docker version -f '{{.Server.Version}}' > ~/answers/docker-version
docker info               # storage driver, how many containers/images, where data lives
```

The client and the server are separate programs: the CLI sends requests to `dockerd` over a socket (`/var/run/docker.sock`). Being in the `docker` group is what lets `learner` use that socket without `sudo`.

## A long-running container

```bash
docker run -d --name scratchpad alpine:3.20 sleep infinity
docker ps                 # STATUS: Up ...
```

- `-d` (detached): run in the background and print the container ID.
- `--name`: a name you choose. Without it Docker makes one up (`eager_turing`).
- Everything after the image is the **command**, replacing the image's default.

## A one-off container

```bash
docker run --name hello-once alpine:3.20 echo "order box ready"
docker ps                 # not listed: it's not running
docker ps -a              # STATUS: Exited (0) ...
```

The container did its one job and exited with code 0. `docker ps -a` shows stopped containers too. (Add `--rm` when you want Docker to delete it automatically on exit; here the grader needs to see it.)

## Read an old container's logs, then clean up

```bash
docker ps -a --filter name=old-batch
docker logs old-batch     # everything it printed to stdout/stderr
docker logs old-batch | grep BATCH-ID
docker logs old-batch | awk '/BATCH-ID/ {print $2}' > ~/answers/batch-id
docker rm old-batch
```

Logs outlive the process: Docker keeps a stopped container's output until the container is removed. That's why `docker rm` is a deliberate step.

## Lifecycle at a glance

```text
docker create  ->  created
docker start   ->  running   (docker run = create + start)
process exits  ->  exited    (docker stop sends SIGTERM, then SIGKILL)
docker rm      ->  gone      (docker rm -f stops and removes in one go)
```

Then **Submit**.
