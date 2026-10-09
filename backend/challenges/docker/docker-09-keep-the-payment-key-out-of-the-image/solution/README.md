# Solution — Keep the Payment Key Out of the Image

Two common ways to leak a secret with Docker:

- **Baked into the image** (`ENV KEY=...`, or `COPY .env`). Every layer is readable by anyone who can pull the image, forever, even if a later layer "removes" it.
- **Passed as an environment variable**. Better, but `docker inspect` shows it to anyone with Docker access, child processes inherit it, and crash reporters love to dump the environment.

A **secret file** mounted at runtime fixes both: the value never enters the image and never appears in the container's config.

Docs: [Secrets in Compose](https://docs.docker.com/compose/how-tos/use-secrets/)

## Find the leak

```bash
docker images quickbyte/payment-handler
docker history --no-trunc quickbyte/payment-handler:1.1-hotfix | grep -i key
docker image inspect -f '{{json .Config.Env}}' quickbyte/payment-handler:1.1-hotfix
docker image inspect -f '{{json .Config.Env}}' quickbyte/payment-handler:1.1-hotfix \
  | jq -r '.[]' | sed -n 's/^PAYMENT_API_KEY=//p' > ~/answers/leaked-key
docker rmi quickbyte/payment-handler:1.1-hotfix
```

In real life: **revoke the key** with the payment provider first. Deleting the image doesn't help if it was ever pushed to a registry.

## Lock down the key file

```bash
cd ~/payments
ls -l secrets/            # -rw-r--r--: every user on the box can read it
chmod 600 secrets/payment_api_key.txt
```

## compose.yaml with a secret

```yaml
services:
  payment-handler:
    image: devsetu/payment-handler:v1.1
    restart: unless-stopped
    secrets:
      - payment_api_key

secrets:
  payment_api_key:
    file: ./secrets/payment_api_key.txt
```

- The top-level `secrets:` says where the value comes from; the service-level `secrets:` grants it to that service.
- Compose mounts it read-only at **`/run/secrets/payment_api_key`**. The app reads the file (many images support `*_FILE` variables for this, e.g. `POSTGRES_PASSWORD_FILE`).
- The container runs as UID 1000, the same UID as `learner` who owns the file, so `600` still lets it read.

## Bring it up and check

```bash
docker compose up -d
docker compose exec payment-handler cat /run/secrets/payment_api_key     # the key
docker inspect $(docker compose ps -q payment-handler) | grep -c pk_live  # 0
```

Keep `secrets/` out of git (`.gitignore`) and out of builds (`.dockerignore`).

Then **Submit**.
