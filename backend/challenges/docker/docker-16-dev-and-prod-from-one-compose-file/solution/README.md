# Solution — Dev and Prod from One Compose File

Copying `compose.yaml` into `compose-dev.yaml` and `compose-prod.yaml` works for about a week, until someone changes one copy and not the others. Compose can instead **merge** several files: a shared base plus small files that only say what's different.

Docs: [Merge Compose files](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/) · [Profiles](https://docs.docker.com/compose/how-tos/profiles/)

## compose.override.yaml: dev, automatic

```yaml
services:
  order-processor:
    environment:
      LOG_LEVEL: DEBUG
```

`docker compose` with no `-f` reads `compose.yaml` **and** `compose.override.yaml` if it exists. Maps like `environment` merge key by key, so `MIN_ORDER_VALUE` from the base stays.

## compose.prod.yaml: prod, explicit

```yaml
services:
  order-processor:
    restart: always
    ports: !reset []
    environment:
      LOG_LEVEL: WARNING
  payment-handler:
    restart: always
```

- Used with `docker compose -f compose.yaml -f compose.prod.yaml ...`. Naming files with `-f` **disables** the automatic override, so dev settings never leak into prod.
- Single values (`restart`) are replaced. **Lists like `ports` are appended**, so an override can't remove a port by leaving it out. `!reset []` clears the inherited list.

## A debug toolbox, off by default

Add to `compose.yaml`:

```yaml
  toolbox:
    image: alpine:3.20
    command: ["sleep", "infinity"]
    profiles: [debug]
```

Services with `profiles` only start when that profile is enabled: `docker compose --profile debug up -d`. Everything without a profile always starts.

## Compare the variants

```bash
cd ~/order-stack
docker compose config | grep -A3 environment                                   # DEBUG
docker compose -f compose.yaml -f compose.prod.yaml config | grep -E 'LOG_LEVEL|restart|published'
docker compose config --services                                               # no toolbox
docker compose --profile debug config --services                               # + toolbox
```

`docker compose config` is the merged result: always check it before trusting a merge.

## Run dev

```bash
docker compose up -d
docker compose exec order-processor env | grep LOG_LEVEL      # DEBUG
docker compose ps                                             # no toolbox
```

Then **Submit**.
