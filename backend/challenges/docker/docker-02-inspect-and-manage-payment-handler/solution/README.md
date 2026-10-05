# Solution — Inspect and Manage Payment Handler

Running a container is the easy part. Day to day you'll **look inside** containers (settings, network, files), **move files** in and out, **restart** them, and **read why** a container stopped.

Docs: `docker inspect --help` · `docker cp --help` · `docker restart --help`

## What is payment-handler running with?

```bash
docker ps
docker inspect payment-handler | less          # everything, as JSON
docker inspect -f '{{json .Config.Env}}' payment-handler
docker exec payment-handler env                 # the same, from inside the process's view
docker inspect -f '{{json .Config.Env}}' payment-handler | jq -r '.[]' | sed -n 's/^MERCHANT_ID=//p' > ~/answers/merchant-id
```

`-f` (`--format`) takes a Go template, so you can pull out one field instead of scrolling through JSON.

## Its IP address

```bash
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' payment-handler > ~/answers/payment-ip
```

Every container gets its own network namespace and an IP on a Docker network (here the default `bridge`). That IP changes when the container is recreated, which is why later labs reach containers **by name** instead.

## Copy a file out of the container

```bash
docker exec payment-handler cat /tmp/last-receipt.txt
docker cp payment-handler:/tmp/last-receipt.txt ~/answers/last-receipt.txt
```

`docker cp` works in both directions (`docker cp ./file name:/path`), and even on stopped containers.

## Restart it

```bash
docker restart payment-handler       # stop (SIGTERM, then SIGKILL after 10 s) + start
docker ps                            # STATUS: Up a few seconds
```

Restart keeps the **same container**: same ID, same writable layer, same settings. Only the process starts fresh.

## Why did settlement-job stop?

```bash
docker ps -a --filter name=settlement-job     # STATUS: Exited (N) ...
docker logs settlement-job                    # ERROR: bank API timeout
docker inspect -f '{{.State.ExitCode}}' settlement-job > ~/answers/settlement-exit-code
docker rm settlement-job
```

Exit code `0` means success; anything else is the program telling you it failed. `137` would mean it was killed (SIGKILL: often out of memory), `143` stopped by SIGTERM.

Then **Submit**.
