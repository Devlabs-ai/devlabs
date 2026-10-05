# Solution — Configure Order Processor with an Env File

The same image runs in dev, QA and production. What changes between them is **configuration**, and the simplest way to hand it to a container is environment variables: one at a time with `-e`, or many at once from a file with `--env-file`.

Docs: [Set environment variables](https://docs.docker.com/reference/cli/docker/container/run/#env)

## Read the file, run it

```bash
cat ~/config/order-processor.env
docker run -d --name op-config -p 8085:8000 \
  --env-file ~/config/order-processor.env \
  -e LOG_LEVEL=WARNING \
  devsetu/order-processor:v1.2
```

`-e` on the command line wins over the same variable in `--env-file`: the file holds the defaults, the command line overrides them for one container without touching the shared file.

## The orders don't follow the minimum

```bash
MIN=$(sed -n 's/^MIN_ORDER_VALUE=//p' ~/config/order-processor.env | tr -d '"')
curl -s -X POST http://127.0.0.1:8085/orders -H 'Content-Type: application/json' \
  -d "{\"items\":[\"chai\"],\"total\":$((MIN - 1))}"
# 201 created, but it should have been rejected

docker exec op-config env | grep MIN_ORDER_VALUE
# MIN_ORDER_VALUE="23"     <- the quotes are part of the value
```

`docker --env-file` is **not** a shell file: no quote removal, no `$VAR` expansion, no `export`. Each line is `KEY=everything after the =`. The app tried `float('"23"')`, failed, and fell back to 0. (Docker **Compose** env files do strip quotes, which is why this catches people out.)

## Fix the file, recreate the container

```bash
sed -i 's/^MIN_ORDER_VALUE="\(.*\)"$/MIN_ORDER_VALUE=\1/' ~/config/order-processor.env
cat ~/config/order-processor.env
docker rm -f op-config
docker run -d --name op-config -p 8085:8000 \
  --env-file ~/config/order-processor.env -e LOG_LEVEL=WARNING \
  devsetu/order-processor:v1.2
docker exec op-config env | grep -E 'MIN_ORDER|MAX_ITEMS|LOG_LEVEL'
```

A container's environment is fixed when it's **created**: editing the file changes nothing until you recreate the container.

## Check

```bash
curl -s -X POST http://127.0.0.1:8085/orders -H 'Content-Type: application/json' \
  -d "{\"items\":[\"chai\"],\"total\":$((MIN - 1))}"          # 400 order_total_too_low
curl -s -X POST http://127.0.0.1:8085/orders -H 'Content-Type: application/json' \
  -d '{"items":["a","b","c","d","e","f","g","h","i"],"total":99}'   # 400 too_many_items
```

`docker inspect op-config` shows every variable, **including the API key**. Anyone who can run `docker` can read it. The next lab moves secrets out of the environment.

Then **Submit**.
