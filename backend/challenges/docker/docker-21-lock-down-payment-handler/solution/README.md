# Solution — Lock Down Payment Handler

payment-handler handles card data, so it's the container an attacker wants most. If they find a bug in the app, what they can do next depends on how the container runs. **Least privilege**: take away everything the app doesn't need, so a compromise stays small.

Docs: [Runtime privilege and Linux capabilities](https://docs.docker.com/engine/containers/run/#runtime-privilege-and-linux-capabilities) · [Docker security](https://docs.docker.com/engine/security/)

## See what it runs with

```bash
docker inspect -f 'user={{.Config.User}} caps={{.HostConfig.CapAdd}} ro={{.HostConfig.ReadonlyRootfs}}' payment-handler
docker exec payment-handler id                       # uid=0(root)
docker exec payment-handler sh -c 'grep Cap /proc/1/status'
docker port payment-handler                          # 0.0.0.0:8001
```

## Recreate it locked down

```bash
docker rm -f payment-handler
docker run -d --name payment-handler \
  --read-only --tmpfs /tmp \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  -p 127.0.0.1:8001:8000 \
  devsetu/payment-handler:v1.1
```

| Flag | What it takes away |
|---|---|
| (no `--user 0`) | Root. The image already says `USER 1000`. |
| `--cap-drop ALL` | Every Linux **capability**: the pieces root's power is split into (`NET_ADMIN` reconfigures networking, `SYS_PTRACE` reads other processes' memory, `CHOWN`, `NET_RAW`...). A web app on port 8000 needs none. |
| `--security-opt no-new-privileges` | setuid binaries (`su`, `sudo`, `passwd`) can't gain privileges, even if they're in the image. |
| `--read-only` | Nobody can drop tools or modify the app on disk. |
| `--tmpfs /tmp` | The one place gunicorn must write (worker heartbeat files), in memory. |
| `-p 127.0.0.1:...` | Only the box itself can reach it. |

Try `--read-only` without `--tmpfs /tmp` and read `docker logs`: gunicorn fails because it can't create its temp files. That's the normal workflow: lock everything, then open exactly what the logs say is needed.

## Check

```bash
docker exec payment-handler id                       # uid=1000(appuser)
docker exec payment-handler sh -c 'grep CapEff /proc/1/status'   # 0000000000000000
docker exec payment-handler touch /app/x             # Read-only file system
curl http://127.0.0.1:8001/health
```

These map one-to-one onto a Kubernetes `securityContext`: `runAsNonRoot`, `capabilities.drop: [ALL]`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`.

Then **Submit**.
