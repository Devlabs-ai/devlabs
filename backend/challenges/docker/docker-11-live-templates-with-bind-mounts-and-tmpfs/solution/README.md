# Solution — Live Templates with Bind Mounts and tmpfs

Three kinds of storage you can give a container:

| Mount | Lives in | Use it for |
|---|---|---|
| **Volume** (`-v name:/path`) | Docker's storage area | Data the app owns: databases, uploads |
| **Bind mount** (`-v /host/path:/path`) | A folder you choose on the host | Sharing host files: config, source code, templates |
| **tmpfs** (`--tmpfs /path`) | Memory only | Scratch files, caches, PID files: fast, never on disk, gone on stop |

Docs: [Bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) · [tmpfs mounts](https://docs.docker.com/engine/storage/tmpfs/)

## Start with the bind mount

```bash
docker run -d --name notify-preview -p 8086:80 \
  -v ~/notify/templates:/usr/share/nginx/html:ro \
  nginx:1.27-alpine
curl http://127.0.0.1:8086/order-confirmed.txt
echo "P.S. thanks for ordering!" >> ~/notify/templates/order-shipped.txt
curl http://127.0.0.1:8086/order-shipped.txt     # the change is there, no restart
```

A bind mount is the **same files**, not a copy. `:ro` makes it read-only inside the container: nginx serves the templates but can't change them.

## Lock down the rest: --read-only

```bash
docker rm -f notify-preview
docker run -d --name notify-preview -p 8086:80 --read-only \
  -v ~/notify/templates:/usr/share/nginx/html:ro \
  nginx:1.27-alpine
docker ps -a --filter name=notify-preview      # Exited
docker logs notify-preview
# mkdir() "/var/cache/nginx/client_temp" failed (30: Read-only file system)
```

`--read-only` makes the whole root filesystem read-only, so nothing can modify the image's files at runtime: no dropped malware, no config drift. But nginx needs somewhere to write its cache and PID file. That's what tmpfs is for.

```bash
docker rm -f notify-preview
docker run -d --name notify-preview -p 8086:80 --read-only \
  --tmpfs /var/cache/nginx --tmpfs /run \
  -v ~/notify/templates:/usr/share/nginx/html:ro \
  nginx:1.27-alpine
docker logs notify-preview
curl http://127.0.0.1:8086/payment-failed.txt
docker exec notify-preview touch /etc/nginx/x          # Read-only file system
```

On Alpine `/var/run` is a link to `/run`, where nginx writes `nginx.pid`. Read the error messages: they name each path that needs to be writable.

## The long form

`--mount` says the same thing more explicitly, and is what you'll see in Compose and Kubernetes:

```bash
--mount type=bind,source=$HOME/notify/templates,target=/usr/share/nginx/html,readonly
--mount type=tmpfs,target=/var/cache/nginx,tmpfs-size=16m
```

Then **Submit**.
