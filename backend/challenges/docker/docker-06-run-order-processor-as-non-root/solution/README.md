# Solution — Run Order Processor as Non-Root

Unless the image says otherwise, the process in a container runs as **root** (UID 0). It's not the host's full root, but it is root over everything in the container, and the first in line if someone finds a container escape. Same rule as the Linux track: services run as a dedicated, unprivileged user.

Docs: [USER](https://docs.docker.com/reference/dockerfile/#user) · [Dockerfile best practices](https://docs.docker.com/build/building/best-practices/#user)

## See the problem

```bash
cd ~/order-processor
docker build -t quickbyte/order-processor:1.6 .
docker run --rm quickbyte/order-processor:1.6 id         # uid=0(root)
docker run --rm --entrypoint sh quickbyte/order-processor:1.6 -c 'echo hacked >> /app/app.py && echo writable'
```

## The Dockerfile

```dockerfile
FROM python:3.12-slim

RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin orders

WORKDIR /app

COPY requirements.txt .
COPY wheels/ ./wheels/
RUN pip install --no-cache-dir --no-index --find-links=wheels -r requirements.txt \
    && rm -rf wheels

COPY app.py .

ENV APP_VERSION=v1.6
EXPOSE 8000

USER 10001

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "2", "app:app"]
```

- `useradd --system --uid 10001`: a fixed, high UID that won't collide with users on the host or in other images. `--shell /usr/sbin/nologin`: nobody logs in as it.
- **`USER 10001`, numeric**, not `USER orders`. Kubernetes' `runAsNonRoot: true` checks the image's user, and it can only prove a **number** isn't 0.
- `USER` goes **after** `pip install`: installing packages needs root; running the app doesn't.
- The code stays owned by **root** and is only readable by `orders`. If the app is compromised, it can't rewrite itself. (Only `chown` the directories the app must write to, if any.)
- Port 8000 is above 1024, so a non-root user can bind it. Ports below 1024 would need root or a capability.

## Build and run

```bash
docker build -t quickbyte/order-processor:1.6 ~/order-processor
docker run --rm quickbyte/order-processor:1.6 id              # uid=10001(orders)
docker run -d --name op-16 -p 8084:8000 quickbyte/order-processor:1.6
curl http://127.0.0.1:8084/health
docker exec op-16 ps -o user,pid,cmd 2>/dev/null || docker top op-16
```

`docker top op-16` shows the process from the **host's** side, as UID 10001.

Then **Submit**.
