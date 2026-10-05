# Solution — Push and Pin with a Private Registry

A **registry** stores images; `docker push` uploads, `docker pull` downloads. Docker Hub is one registry, but companies keep their own images in a private one (ECR, GCR, Harbor, or the open-source `registry`). An image's full name says where it lives: `localhost:5000/quickbyte/order-processor:1.2` means *registry* `localhost:5000`, *repository* `quickbyte/order-processor`, *tag* `1.2`.

Docs: [Registry](https://distribution.github.io/distribution/) · `docker push --help`

## Run a registry

```bash
docker run -d --name registry --restart unless-stopped \
  -p 5000:5000 -v registry-data:/var/lib/registry registry:3
curl http://127.0.0.1:5000/v2/_catalog          # {"repositories":[]}
```

Docker only talks plain HTTP to registries on `localhost`; anything else needs TLS (or an `insecure-registries` entry in daemon.json).

## Tag and push

```bash
docker tag devsetu/order-processor:v1.2 localhost:5000/quickbyte/order-processor:1.2
docker tag devsetu/order-processor:v1.2 localhost:5000/quickbyte/order-processor:stable
docker push localhost:5000/quickbyte/order-processor:1.2
# 1.2: digest: sha256:4f8a... size: 1993
docker push localhost:5000/quickbyte/order-processor:stable     # layers already exist: instant
curl http://127.0.0.1:5000/v2/quickbyte/order-processor/tags/list
```

`docker tag` doesn't copy anything; it adds another name for the same image ID.

## Tags move, digests don't

A **tag** is a label anyone can move: tomorrow `stable` (or even `1.2`) can point at a different image. A **digest** (`sha256:...`) is the hash of the image manifest: it can only ever mean those exact bytes.

```bash
docker inspect -f '{{json .RepoDigests}}' localhost:5000/quickbyte/order-processor:1.2 | jq
# [ "devsetu/order-processor@sha256:a66b...",
#   "localhost:5000/quickbyte/order-processor@sha256:be4f..." ]
docker inspect -f '{{json .RepoDigests}}' localhost:5000/quickbyte/order-processor:1.2 \
  | jq -r '.[] | select(startswith("localhost:5000/")) | split("@")[1]' > ~/answers/digest
```

One image, **two digests**: a digest belongs to a manifest **in a registry**. Docker Hub stores a multi-arch index (arm64 + amd64); this box pushed only its own arm64 manifest, so the bytes, and the hash, differ. Always take the digest from the registry you deploy from (the `docker push` output prints it too).

## Deploy by digest

```bash
DIGEST=$(cat ~/answers/digest)
docker run -d --name op-pinned -p 8087:8000 localhost:5000/quickbyte/order-processor@$DIGEST
curl http://127.0.0.1:8087/health
```

Pinning by digest means a deploy, a rollback or a new node always gets **the same image** that was tested, even if someone re-pushes the tag. Kubernetes manifests and CI pipelines do the same: `image: repo@sha256:...`.

Then **Submit**.
