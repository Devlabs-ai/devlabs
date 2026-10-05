# Solution — Script the Health Check

A good ops script validates its arguments, reads configuration instead of hardcoding it, prints something useful, and, most importantly, returns an **exit code** that other tools can act on (`0` = success, anything else = a specific failure).

Docs: `man bash` (Positional Parameters, Compound Commands, `$?`) · `help test` · `man curl`

## The script

```bash
sudo tee /usr/local/bin/check-health >/dev/null <<'EOF'
#!/bin/bash
# check-health <service> — exit 0 OK, 1 DOWN, 2 usage error, 3 unknown service.
registry=/etc/order-platform/services

if [ $# -ne 1 ]; then
  echo "usage: check-health <service>" >&2
  exit 2
fi
name="$1"

port="$(awk -v n="$name" '$1 == n {print $2}' "$registry")"
if [ -z "$port" ]; then
  echo "unknown service: $name" >&2
  exit 3
fi

if curl -fsS --max-time 3 "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
  echo "$name OK"
  exit 0
else
  echo "$name DOWN"
  exit 1
fi
EOF
sudo chmod 755 /usr/local/bin/check-health
```

- `$#` is the number of arguments, and `$1` is the first.
- `>&2` sends a message to stderr.
- `if <command>; then` branches on that command's exit code. `curl -f` fails on HTTP errors.
- The `awk` matches the first column exactly, so comment lines (`#`) never match.

## Try it

```bash
check-health; echo "exit=$?"                       # usage, 2
check-health order-processor; echo "exit=$?"       # OK, 0
check-health notification-service; echo "exit=$?"  # DOWN, 1
check-health inventory-service; echo "exit=$?"     # unknown, 3
check-health payment-handler && echo "safe to deploy"
```

Debug a script with `bash -x /usr/local/bin/check-health order-processor`. Then **Submit**.
