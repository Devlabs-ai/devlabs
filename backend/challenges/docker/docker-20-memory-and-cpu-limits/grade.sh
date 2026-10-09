#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

mib=$((1024 * 1024))
limits() { inspect "$1" '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{if .HostConfig.PidsLimit}}{{.HostConfig.PidsLimit}}{{else}}0{{end}}'; }

wait_docker

for c in report-big report-small order-processor; do
  container_exists "$c" || fail "no container named $c"
done
[[ "$(inspect report-big '{{.Config.Image}}')" == quickbyte/report-builder:1.0 ]] || fail "report-big must run quickbyte/report-builder:1.0"
[[ "$(inspect report-small '{{.Config.Image}}')" == quickbyte/report-builder:1.0 ]] || fail "report-small must run quickbyte/report-builder:1.0"

read -r mem _ _ <<<"$(limits report-big)"
(( mem == 128 * mib )) || fail "report-big needs a 128 MiB memory limit (--memory 128m)"
[[ "$(inspect report-big '{{.State.Status}} {{.State.OOMKilled}} {{.State.ExitCode}}')" == "exited true 137" ]] \
  || fail "report-big should have been killed for running out of memory (docker inspect: State.OOMKilled); it is $(inspect report-big '{{.State.Status}}, OOMKilled={{.State.OOMKilled}}, exit {{.State.ExitCode}}')"
need_answer report-big-exit-code "the exit code report-big stopped with"
[[ "$(answer report-big-exit-code)" == 137 ]] || fail "~/answers/report-big-exit-code is not report-big's exit code"
ok "report-big hit its 128 MiB limit and was OOM-killed (137)"

read -r mem cpus pids <<<"$(limits report-small)"
(( mem == 128 * mib )) || fail "report-small needs the same 128 MiB memory limit"
(( cpus == 500000000 )) || fail "report-small needs half a CPU (--cpus 0.5)"
(( pids == 64 )) || fail "report-small needs --pids-limit 64"
[[ "$(container_env report-small REPORT_BATCH_MB)" =~ ^[0-9]+$ ]] || fail "make the batch fit with REPORT_BATCH_MB on report-small"
[[ "$(inspect report-small '{{.State.Status}} {{.State.ExitCode}}')" == "exited 0" ]] \
  || fail "report-small should finish and exit 0 (docker logs report-small); a batch that fits needs headroom for Python itself"
dk logs report-small 2>&1 | grep -q '^report done' || fail "report-small didn't print 'report done'"
ok "report-small fits in 128 MiB with 0.5 CPU and 64 PIDs"

read -r mem cpus pids <<<"$(limits order-processor)"
[[ "$(inspect order-processor '{{.Config.Image}}')" == devsetu/order-processor:v1.2 ]] || fail "order-processor must run devsetu/order-processor:v1.2"
(( mem == 256 * mib )) || fail "order-processor needs --memory 256m"
(( cpus == 1000000000 )) || fail "order-processor needs --cpus 1"
(( pids == 128 )) || fail "order-processor needs --pids-limit 128"
[[ "$(container_state order-processor)" == running ]] || fail "order-processor is not running"
[[ "$(published_port order-processor 8000)" == 8080 ]] || fail "publish order-processor on 8080"
ok "order-processor runs with 256 MiB, 1 CPU, 128 PIDs"

pass "every container on the box has limits"
