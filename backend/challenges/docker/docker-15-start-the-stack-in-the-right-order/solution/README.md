# Solution — Start the Stack in the Right Order

Plain `depends_on: [x]` only waits for container `x` to be **created and started**, not for it to be finished or ready. Compose has two stronger conditions:

| Condition | Waits until | Use it for |
|---|---|---|
| `service_started` (the default) | the container has started | almost nothing |
| `service_healthy` | its healthcheck passes | services that need a *working* dependency |
| `service_completed_successfully` | it has **exited with code 0** | one-shot jobs: migrations, seeding, config rendering |

Docs: [Control startup order](https://docs.docker.com/compose/how-tos/startup-order/)

## See the problem

```bash
cd ~/order-stack
docker compose up -d
docker compose ps -a
docker compose logs order-processor | head
docker inspect --format '{{json .State.Health}}' order-stack-order-processor-1 | jq '.Log[-1]'
```

`slow-order-processor` answers `503` on `/health` for its first **25 seconds** (cache warm-up). With `interval: 2s` and `retries: 1`, the first failed probe marks it **unhealthy**. Meanwhile it started while `migrate` was still applying the schema, and notification-service started without waiting for either.

## The fixed compose.yaml

```yaml
services:
  migrate:
    image: quickbyte/order-migrate:1.0
    volumes:
      - schema:/schema

  order-processor:
    image: devsetu/slow-order-processor:1.0
    restart: unless-stopped
    ports:
      - "8080:8000"
    volumes:
      - schema:/schema:ro
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 40s
      start_interval: 2s
    depends_on:
      migrate:
        condition: service_completed_successfully

  notification-service:
    image: devsetu/notification-service:v1.1
    restart: unless-stopped
    depends_on:
      order-processor:
        condition: service_healthy

volumes:
  schema:
```

- **`start_period: 40s`**: failures during the first 40 s don't count toward `retries`, but the first **success** marks it healthy straight away. Size it to the slowest realistic boot.
- `start_interval: 2s` probes more often during the start period, so "healthy" is noticed quickly.
- `retries: 3` after that: one slow answer under load shouldn't flip it to unhealthy.
- `migrate` has no `restart:`. It's a job: run once, exit 0, stay exited.

The same three ideas exist in Kubernetes as an **init container** (migrate), a **startupProbe** (start_period), and a **readinessProbe** (healthy before traffic).

## Bring it up

```bash
docker compose down
docker compose up -d --wait        # returns once everything is running/healthy, or fails
docker compose ps -a               # migrate Exited (0), order-processor (healthy), notification-service Up
docker compose logs migrate
```

`--wait` is what you'd use in CI or a deploy script: it blocks until the stack is actually ready and exits non-zero if it never gets there.

Then **Submit**. The grader runs `docker compose down` and `up -d --wait` itself.
