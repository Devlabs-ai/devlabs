# Solution — Health Check for Order Processor

Docker only knows whether the container's main **process** is alive. A hung app (process up, `/health` never answering) still shows `Up 9 hours`. A **HEALTHCHECK** tells Docker how to ask the app itself; `docker ps` then shows `(healthy)` or `(unhealthy)`, and Compose and orchestrators can act on it.

Docs: [HEALTHCHECK](https://docs.docker.com/reference/dockerfile/#healthcheck) · [LABEL](https://docs.docker.com/reference/dockerfile/#label)

## Add the health check and labels

```bash
nano ~/order-processor/Dockerfile
```

```dockerfile
FROM python:3.12-slim

LABEL org.opencontainers.image.title="order-processor" \
      org.opencontainers.image.version="1.4" \
      com.quickbyte.team="orders"

WORKDIR /app

COPY requirements.txt .
COPY wheels/ ./wheels/
RUN pip install --no-cache-dir --no-index --find-links=wheels -r requirements.txt \
    && rm -rf wheels

COPY app.py .

ENV APP_VERSION=v1.4
EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "2", "app:app"]
```

- The probe runs **inside the container**, so `127.0.0.1:8000` is the app itself. Exit code 0 = healthy, anything else = a failed check.
- `python:3.12-slim` has **no curl or wget**. `urlopen` raises on errors and non-2xx answers, so a failure becomes a non-zero exit.
- `--interval`: how often. `--timeout`: how long one probe may take. `--retries`: consecutive failures before `unhealthy`. `--start-period`: grace time at startup where failures don't count.
- `LABEL`s are metadata: who owns the image and what version it is. `org.opencontainers.image.*` are the standard keys tools understand.

## Build, run, watch

```bash
docker build -t quickbyte/order-processor:1.4 ~/order-processor
docker run -d --name op-14 -p 8082:8000 quickbyte/order-processor:1.4
docker ps                       # STATUS: Up 5 seconds (health: starting) ... then (healthy)
docker inspect --format '{{json .State.Health}}' op-14 | jq
docker inspect --format '{{json .Config.Labels}}' quickbyte/order-processor:1.4
```

## See it fail

```bash
docker run -d --name hc-demo --entrypoint sleep quickbyte/order-processor:1.4 infinity
sleep 45; docker ps --filter name=hc-demo     # (unhealthy): the process runs, the app doesn't
docker rm -f hc-demo
```

Docker itself only reports `unhealthy`; it doesn't restart the container. Compose (`depends_on: condition: service_healthy`) and Kubernetes (liveness and readiness probes) are what act on it.

Then **Submit**. The grader runs your probe against a working app and against a container where nothing listens, and expects healthy and unhealthy.
