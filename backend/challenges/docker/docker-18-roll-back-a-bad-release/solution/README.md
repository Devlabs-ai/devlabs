# Solution — Roll Back a Bad Release

Images are immutable and old versions stay on the machine (and in the registry), so rolling back is just "run the previous image". The hard part is knowing **what's running**, **what changed**, and **which version was last good**.

Docs: `docker image ls --help` · `docker history --help`

## What's running?

```bash
docker ps                                  # order-processor  Up ...  0.0.0.0:8080->8000/tcp
curl -v http://127.0.0.1:8080/health       # Connection reset by peer
docker inspect -f '{{.Config.Image}}' order-processor        # quickbyte/order-processor:latest
docker images quickbyte/order-processor    # 1.8 and latest share an IMAGE ID
```

`latest` tells you nothing: it's just the tag that was pushed last. Compare **image IDs** to find the real version.

```bash
docker inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' quickbyte/order-processor:latest   # 1.8
echo 1.8 > ~/answers/broken-version
```

## Why is it broken?

```bash
docker logs order-processor
# [INFO] Listening at: http://127.0.0.1:8000
docker history --no-trunc quickbyte/order-processor:1.8 | head -3     # the changed CMD
echo 127.0.0.1:8000 > ~/answers/listen-address
```

Inside a container, `127.0.0.1` is the **container's own** loopback. Docker forwards published ports to the container's network interface (`eth0`), where nothing is listening, so connections are reset. Apps in containers must listen on `0.0.0.0`.

## Roll back

```bash
docker rm -f order-processor
docker run -d --name order-processor --restart unless-stopped -p 8080:8000 quickbyte/order-processor:1.7
curl http://127.0.0.1:8080/health        # {"status":"ok","version":"v1.7"}
```

Run by the **version tag**, not `latest`: anyone reading `docker ps` sees exactly what's deployed, and a re-tag can't silently change it on the next restart.

## Point latest back at the good release

```bash
docker tag quickbyte/order-processor:1.7 quickbyte/order-processor:latest
docker images quickbyte/order-processor
```

Keep `1.8` around for the post-mortem, and fix forward with a `1.9`. Kubernetes keeps this history for you: `kubectl rollout undo deployment/order-processor`.

Then **Submit**.
