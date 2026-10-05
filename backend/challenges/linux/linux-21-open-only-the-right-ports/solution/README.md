# Solution — Open Only the Right Ports

`nftables` is the Linux kernel firewall (iptables' successor; `ufw` and `firewalld` are front-ends to it). The safe pattern is **default deny**. Drop everything inbound, then allow:
- loopback,
- replies to connections the box itself opened,
- the ports you actually serve.

Docs: `man nft` · `/usr/share/doc/nftables/examples/`

## See what's exposed

```bash
sudo ss -tlnp        # 0.0.0.0:22, :8080, :9100, :6379 — all reachable
sudo nft list ruleset   # empty
```

## Write the ruleset

```bash
sudo tee /etc/nftables.conf >/dev/null <<'EOF'
#!/usr/sbin/nft -f
flush ruleset

table inet filter {
  chain input {
    type filter hook input priority filter; policy drop;

    iif lo accept
    ct state established,related accept
    ct state invalid drop
    meta l4proto { icmp, ipv6-icmp } accept

    tcp dport { 22, 8080 } accept
  }
  chain forward {
    type filter hook forward priority filter; policy drop;
  }
  chain output {
    type filter hook output priority filter; policy accept;
  }
}
EOF
```

- `iif lo accept`: local services still talk to each other over 127.0.0.1.
- `ct state established,related accept`: replies to your own outbound traffic (DNS, apt, curl) get back in.
- Keep **22** open, or the next SSH session can't connect.

## Check, load, persist

```bash
sudo nft -c -f /etc/nftables.conf          # syntax check only
sudo systemctl enable --now nftables       # loads /etc/nftables.conf now and at boot
sudo systemctl restart nftables            # after later edits
sudo nft list ruleset
```

## Test

```bash
curl -s http://127.0.0.1:9100/health       # local: still works
curl -sI https://deb.debian.org | head -1  # outbound: still works
```

The grader probes from a separate network namespace to check that 22 and 8080 are reachable from outside and 9100 and 6379 are not. Then **Submit**.
