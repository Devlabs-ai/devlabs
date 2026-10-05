# Learner machine for the Docker module: the Linux-lab box (systemd as PID 1, sudo-capable
# `learner`, user-namespaced pod) plus Docker Engine, BuildKit and Compose. dockerd runs as
# the box's namespaced root; learner containers are cgroups and namespaces inside the box,
# never on the node. See deploy/eks/docker/.
ARG LINUX_LAB_IMAGE=devsetu/linux-lab:v0.3

# Boxes reach Docker Hub only through the in-cluster mirror, never PyPI, so Dockerfile labs
# install Python dependencies offline from this wheelhouse (pip --no-index --find-links).
# Both arches, so the same build context works on Graviton boxes and x86 laptops.
FROM python:3.12-slim AS wheelhouse
RUN for plat in manylinux2014_aarch64 manylinux2014_x86_64; do \
      pip download --no-cache-dir --dest /wheels --only-binary=:all: \
        --platform "$plat" --python-version 3.12 --implementation cp \
        flask==3.0.3 gunicorn==22.0.0 || exit 1; \
    done

FROM ${LINUX_LAB_IMAGE}

RUN install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
  && chmod a+r /etc/apt/keyrings/docker.asc \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
  && rm -rf /var/lib/apt/lists/*

# Mirror: in-cluster Docker Hub cache (deploy/eks/docker/registry-mirror.yaml).
# Address pools: the VPC is 172.31.0.0/16 and services 10.100.0.0/16, both of which
# Docker's defaults (172.17-31.x, 192.168.x) could shadow.
# Classic overlay2 store keeps all image data under /var/lib/docker (an emptyDir in the pod).
COPY daemon.json /etc/docker/daemon.json
COPY --from=wheelhouse /wheels /opt/devsetu/wheelhouse

RUN systemctl enable containerd.service docker.service \
  && usermod -aG docker learner
