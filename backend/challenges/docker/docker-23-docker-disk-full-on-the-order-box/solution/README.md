# Solution — Docker Disk Full on the Order Box

Docker never deletes anything on its own. Every exited container, every image replaced by a rebuild, every volume and every cached build layer stays on disk until someone removes it. On a busy box that's tens of GB, and then the disk is full. Same skills as the Linux disk-full lab (`df`, `du`, find the big stuff), with Docker's own tools.

Docs: [Prune unused objects](https://docs.docker.com/engine/manage-resources/pruning/)

## Where is the space?

```bash
docker system df            # images, containers, volumes, build cache: total and RECLAIMABLE
docker system df -v         # the same, item by item
```

```bash
docker system df -v | sed -n '/VOLUME NAME/,/^$/p' | sort -k3 -h | tail -3
echo export-2026-09-2X > ~/answers/biggest-volume       # the one with the largest SIZE
```

## Clean up, one kind at a time

```bash
docker container prune -f                   # every stopped container
docker image prune -f                       # dangling images: <none>:<none>, left by rebuilds
docker builder prune -af                    # build cache
docker volume ls --filter label=com.quickbyte.keep=true     # what's protected
docker volume prune -af --filter 'label!=com.quickbyte.keep=true'
docker system df
```

- A **dangling** image is one that lost its tag when a newer build took it (`<none>`). `docker image prune -a` would also delete **unused tagged** images: anything no container uses right now.
- Since Docker 23, `docker volume prune` removes only **anonymous** volumes; `-a` includes named ones. The label filter keeps `orders-backup`. Always check what a prune will touch **before** running it: volumes are data, and there's no undo.
- Running containers, and the images and volumes they use, are never pruned.

## The big hammer

```bash
docker system prune -a --volumes     # everything unused: containers, networks, images, cache, volumes
```

Fine on a laptop. On a server it would have deleted `orders-backup`. Prefer the targeted commands, with filters (`--filter until=168h` keeps the last week).

Then **Submit**.
