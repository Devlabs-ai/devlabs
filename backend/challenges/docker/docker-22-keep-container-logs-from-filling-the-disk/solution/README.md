# Solution — Keep Container Logs from Filling the Disk

Everything a container prints to stdout/stderr is captured by Docker's **logging driver**. The default, `json-file`, writes it to a file on the host, and **by default that file grows forever**. A chatty container can fill the disk in days, and then everything on the machine fails at once. Same lesson as logrotate in the Linux track, applied to containers.

Docs: [Configure logging drivers](https://docs.docker.com/engine/logging/configure/) · [json-file](https://docs.docker.com/engine/logging/drivers/json-file/)

## Find the culprit

```bash
docker ps --format '{{.Names}}'
docker inspect -f '{{.LogPath}}' notifier-chatty
sudo ls -lh "$(docker inspect -f '{{.LogPath}}' notifier-chatty)"     # 40+ MB and growing
docker inspect -f '{{.LogPath}}' notifier-chatty > ~/answers/chatty-log-path
docker rm -f notifier-chatty         # the log file goes with the container
```

`docker logs` reads that same file. Never delete or truncate it by hand while the container runs; remove or recreate the container instead.

## A sane default for every new container

```bash
sudo cat /etc/docker/daemon.json
sudo nano /etc/docker/daemon.json
```

Add `log-driver` and `log-opts`, **keeping everything that's already there** (the registry mirror, the networks...):

```json
{
  "registry-mirrors": ["..."],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

```bash
sudo jq . /etc/docker/daemon.json          # validate: a typo here and Docker won't start
sudo systemctl restart docker
docker run --rm alpine:3.20 true && echo ok
```

- Values in `log-opts` are **strings**: `"3"`, not `3`.
- `max-size` × `max-file` = at most 30 MB per container: when the file reaches 10 MB it's rotated, and the oldest of 3 is deleted.
- The daemon reads `daemon.json` only at **startup**, and the defaults apply to containers **created afterwards**. Existing containers keep the options they were created with.

## Override per container

```bash
docker run -d --name notifier --restart unless-stopped \
  --log-opt max-size=5m --log-opt max-file=3 \
  devsetu/notification-service:v1.1
docker inspect -f '{{json .HostConfig.LogConfig}}' notifier
```

Create notifier **after** restarting Docker, or give it `--restart unless-stopped` (as here): a container without a restart policy stays stopped when the daemon restarts.

In production, logs usually go off the box entirely (to Loki, CloudWatch, Elasticsearch...) via a logging agent or a different driver. Local rotation is still the safety net.

Then **Submit**.
