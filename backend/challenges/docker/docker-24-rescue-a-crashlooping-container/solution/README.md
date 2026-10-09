# Solution — Rescue a Crash-Looping Container

A container that dies on startup and has `--restart always` turns into a **crash loop**: start, fail, restart, fail. `docker ps` shows `Restarting (78) 2 seconds ago` and the logs pile up. The fix is always the same routine: **read the exit code, read the logs, fix one thing, repeat**. (Kubernetes calls this `CrashLoopBackOff`; the routine is identical.)

Docs: `docker logs --help` · `docker inspect --help`

## Read the evidence

```bash
docker ps -a --filter name=notification-service      # Restarting (78) ...
docker inspect -f 'exit={{.State.ExitCode}} restarts={{.RestartCount}}' notification-service
docker inspect -f '{{.State.ExitCode}}' notification-service > ~/answers/exit-code
docker logs --tail 5 notification-service
# notification-service: FATAL: SMTP_HOST is not set
cat ~/notify/README.txt
```

Exit code **78** is `EX_CONFIG` ("configuration error") from `sysexits.h`: a well-behaved app telling you exactly which kind of problem it has.

## Fix, recreate, look again

Environment and mounts are fixed at creation, so each fix means recreating the container:

```bash
docker rm -f notification-service
docker run -d --name notification-service --restart always -p 8090:8080 \
  -e SMTP_HOST=smtp.quickbyte.internal \
  -v ~/notify/config.json:/etc/notify.json:ro \
  quickbyte/notification-service:1.2
docker logs --tail 3 notification-service
# FATAL: cannot read /etc/notify/config.json
```

The mount target was wrong (`/etc/notify.json`). When you're not sure what the image expects, open a shell **in the image** without running its entrypoint:

```bash
docker run --rm -it --entrypoint sh quickbyte/notification-service:1.2
cat /entrypoint.sh       # the checks it runs, and the paths it reads
exit
```

```bash
docker rm -f notification-service
docker run -d --name notification-service --restart always -p 8090:8080 \
  -e SMTP_HOST=smtp.quickbyte.internal \
  -v ~/notify/config.json:/etc/notify/config.json:ro \
  quickbyte/notification-service:1.2
docker logs --tail 3 notification-service
# FATAL: /etc/notify/config.json is not valid JSON: ... line 5 column 1
```

## The last one: the config itself

```bash
jq . ~/notify/config.json          # parse error: Expected another key-value pair at line 5
nano ~/notify/config.json          # remove the trailing comma after the "retry" object
jq . ~/notify/config.json
docker restart notification-service
docker logs --tail 3 notification-service     # sending via smtp.quickbyte.internal ... Listening
curl http://127.0.0.1:8090/health
```

A bind mount is live, so fixing the file only needs a **restart**, not a recreate.

One catch with **single-file** bind mounts: the mount is tied to the file's inode. Editors that save by writing a new file and renaming it over the old one (some vim setups, `sed -i`) leave the container still seeing the **old** file. If the logs still show the old error after a restart, recreate the container (or bind-mount the directory instead of the file).

Then **Submit**.
