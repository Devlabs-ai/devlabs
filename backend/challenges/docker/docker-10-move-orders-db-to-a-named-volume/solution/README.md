# Solution — Move the Orders Database onto a Named Volume

A container's writable layer dies with the container. Databases declare a **volume** for their data directory, so the data lives outside that layer, but `docker run` without `-v` gives it an **anonymous** volume: a random 64-character name that nobody will recognise, that `docker run` won't reattach to a new container, and that the next cleanup might delete.

A **named volume** has a name you choose, lives until you delete it, and is reattached by name to whatever container you start next.

Docs: [Volumes](https://docs.docker.com/engine/storage/volumes/)

## Where is the data now?

```bash
docker inspect -f '{{json .Mounts}}' orders-db | jq
# "Type": "volume", "Name": "3f1c9e...", "Destination": "/var/lib/postgresql/data"
docker volume ls
docker exec orders-db psql -tA -U orders -d orders -c 'SELECT count(*) FROM orders' > ~/answers/order-count
```

## Move it

```bash
docker stop orders-db                  # clean shutdown: never copy a running database's files
docker rename orders-db orders-db-old
docker volume create orders-data

docker run --rm --volumes-from orders-db-old -v orders-data:/to alpine:3.20 \
  sh -c 'cp -a /var/lib/postgresql/data/. /to/'
```

`--volumes-from` mounts every volume of `orders-db-old` at the same paths in a throwaway Alpine container; `cp -a` keeps owners and permissions, which Postgres insists on.

(The other common way is logical: `pg_dump` from the old database, `psql` into a new one. Copying files is faster; dumps also work across Postgres versions.)

## Start the new container on the named volume

```bash
docker run -d --name orders-db \
  -e POSTGRES_PASSWORD=orders -e POSTGRES_USER=orders -e POSTGRES_DB=orders \
  -v orders-data:/var/lib/postgresql/data \
  postgres:16-alpine
docker logs orders-db | tail -3       # "database system is ready to accept connections" (no initdb)
docker exec orders-db psql -tA -U orders -d orders -c 'SELECT count(*) FROM orders'
```

## Clean up the old container and its anonymous volume

```bash
docker rm -v orders-db-old            # -v also removes its anonymous volumes
docker volume ls                      # only orders-data
```

## Prove it survives

```bash
docker rm -f orders-db
docker run -d --name orders-db -e POSTGRES_PASSWORD=orders -e POSTGRES_USER=orders -e POSTGRES_DB=orders \
  -v orders-data:/var/lib/postgresql/data postgres:16-alpine
```

Same data, brand-new container. Volumes are also how Kubernetes thinks about state: a PersistentVolumeClaim is the cluster's named volume.

Then **Submit**.
