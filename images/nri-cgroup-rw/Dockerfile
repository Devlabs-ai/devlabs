# NRI plugin (DaemonSet on labs-linux nodes): writable cgroupfs for user-namespaced
# Linux-lab machines. See main.go and deploy/eks/linux/nri-cgroup-rw.yaml.
FROM --platform=$BUILDPLATFORM golang:1.25 AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags='-s -w' -o /nri-cgroup-rw .

FROM gcr.io/distroless/static-debian12
COPY --from=build /nri-cgroup-rw /nri-cgroup-rw
ENTRYPOINT ["/nri-cgroup-rw"]
