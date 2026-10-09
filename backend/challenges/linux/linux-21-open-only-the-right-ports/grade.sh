#!/usr/bin/env bash
# Probes ports from a throwaway network namespace wired to the box over a veth pair, so
# traffic arrives on a real interface (not lo) and hits the learner's input chain.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

box_ok "nft -c -f /etc/nftables.conf" || fail "/etc/nftables.conf has a syntax error (check with: sudo nft -c -f /etc/nftables.conf)"
box_ok "grep -qE 'hook[[:space:]]+input' /etc/nftables.conf" || fail "/etc/nftables.conf should define a chain with hook input"
[[ "$(in_box "systemctl is-enabled nftables 2>/dev/null || true")" == enabled ]] \
  || fail "nftables.service is not enabled, so the rules won't load at boot"
ok "rules persisted in /etc/nftables.conf and enabled at boot"

ruleset="$(in_box "nft list ruleset")"
grep -qE 'hook input priority (filter|0); policy drop;' <<<"$ruleset" \
  || fail "the live ruleset has no input chain with policy drop (did you load it? sudo systemctl restart nftables)"
ok "default-deny input chain loaded"

for s in order-processor metrics-exporter order-cache; do
  [[ "$(in_box "systemctl is-active $s 2>/dev/null || true")" == active ]] || fail "$s must keep running — block it with the firewall, don't stop it"
done

trap 'in_box "ip netns del dlprobe 2>/dev/null; ip link del dlprobe0 2>/dev/null" >/dev/null 2>&1 || true' EXIT
box_script <<'EOF' >/dev/null
ip netns del dlprobe 2>/dev/null || true
ip link del dlprobe0 2>/dev/null || true
ip netns add dlprobe
ip link add dlprobe0 type veth peer name dlprobe1
ip link set dlprobe1 netns dlprobe
ip addr add 10.250.0.1/30 dev dlprobe0
ip link set dlprobe0 up
N="nsenter --net=/run/netns/dlprobe"
$N ip addr add 10.250.0.2/30 dev dlprobe1
$N ip link set dlprobe1 up
$N ip link set lo up
EOF
probe() { box_ok "nsenter --net=/run/netns/dlprobe nc -z -w 2 10.250.0.1 $1"; }

probe 22 || fail "port 22 (ssh) is blocked from outside — keep it open or you'll lock yourself out"
probe 8080 || fail "port 8080 (order-processor) is blocked from outside"
! probe 6379 || fail "port 6379 (order-cache) is reachable from outside"
! probe 9100 || fail "port 9100 (metrics-exporter) is reachable from outside"
ok "from outside: 22 and 8080 open, 6379 and 9100 blocked"

box_ok "curl -fsS --max-time 3 http://127.0.0.1:9100/health" || fail "metrics on 127.0.0.1:9100 must still work locally (allow loopback)"
box_ok "curl -fsS --max-time 3 http://127.0.0.1:6379/health" || fail "order-cache on 127.0.0.1:6379 must still work locally (allow loopback)"
box_ok "curl -fsS --max-time 5 -o /dev/null https://deb.debian.org/" \
  || box_ok "getent hosts kubernetes.default.svc.cluster.local" \
  || fail "outbound traffic broke: allow replies to connections the box opens (ct state established,related accept)"
ok "loopback and outbound replies still work"

pass "only the right ports are open"
