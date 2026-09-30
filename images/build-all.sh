#!/usr/bin/env bash
# Build and push every lab workload image as a multi-arch manifest.
# Learner nodes (labs-k8s) are Graviton / arm64; amd64 is kept so the same tags
# still run on x86 hosts (system-k8s, CI, local Intel machines).
#
# Usage (repo root, after `docker login`):
#   ./images/build-all.sh                          # build + push all images
#   ./images/build-all.sh order-processor          # just one image (all its tags)
#   NO_PUSH=1 ./images/build-all.sh                # build both arches, push nothing
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="${IMAGE_REPO:-devsetu}"
PLATFORMS="${IMAGE_PLATFORMS:-linux/amd64,linux/arm64}"
BUILDER="${BUILDX_BUILDER:-devlabs-multiarch}"

ALL_IMAGES="order-processor payment-handler notification-service order-reconciliation slow-order-processor zombie-order-processor"

# Each tag is also passed as APP_VERSION (the apps echo it on /health).
tags_for() {
  case "$1" in
    order-processor) echo "v1.0 v1.1 v1.2" ;;
    payment-handler) echo "v1.0 v1.1" ;;
    notification-service) echo "v1.0 v1.1" ;;
    order-reconciliation) echo "v1.0" ;;
    slow-order-processor) echo "1.0" ;;
    zombie-order-processor) echo "1.0" ;;
    *) echo "unknown image: $1" >&2; return 1 ;;
  esac
}

# Multi-platform builds need the docker-container driver (default driver is single-arch).
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  echo "==> creating buildx builder $BUILDER"
  docker buildx create --name "$BUILDER" --driver docker-container >/dev/null
fi

if [[ -n "${NO_PUSH:-}" ]]; then
  OUTPUT=(--output type=cacheonly)
else
  OUTPUT=(--push)
fi

for image in ${*:-$ALL_IMAGES}; do
  for tag in $(tags_for "$image"); do
    ref="$REPO/$image:$tag"
    echo "==> $ref ($PLATFORMS)"
    docker buildx build \
      --builder "$BUILDER" \
      --platform "$PLATFORMS" \
      --build-arg "APP_VERSION=$tag" \
      -t "$ref" \
      "${OUTPUT[@]}" \
      "$ROOT/$image"
  done
done

if [[ -z "${NO_PUSH:-}" ]]; then
  echo ""
  echo "==> published; verify with:"
  echo "    docker buildx imagetools inspect $REPO/order-processor:v1.2"
fi
