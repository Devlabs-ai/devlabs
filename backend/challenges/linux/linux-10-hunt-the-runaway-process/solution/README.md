# Solution — Hunt the Runaway Process

`top` and `ps` show what's running and what it costs. **Signals** tell a process to stop: `SIGTERM` (15) politely, `SIGKILL` (9) unconditionally. **Nice** values (-20 to 19) tell the scheduler who matters less: higher means lower priority.

Docs: `man top` · `man ps` · `man kill` · `man 7 signal` · `man renice`

## Find it

```bash
top                 # press P to sort by CPU, q to quit
ps -eo pid,user,ni,pcpu,cmd --sort=-pcpu | head
```

The `order-reindex` process owned by `orders` sits at about 100% CPU.

```bash
mkdir -p ~/answers
pgrep -f order-reindex > ~/answers/runaway-pid
cat ~/answers/runaway-pid
```

## Stop it

Always try `SIGTERM` first: it lets a process clean up after itself.

```bash
sudo kill "$(cat ~/answers/runaway-pid)"
ps -p "$(cat ~/answers/runaway-pid)"      # still there: it ignores SIGTERM
sudo kill -9 "$(cat ~/answers/runaway-pid)"
ps -p "$(cat ~/answers/runaway-pid)"      # gone
```

## Deprioritize the report builder

```bash
pgrep -af report-builder
sudo renice -n 15 -p "$(pgrep -f report-builder)"
ps -o pid,ni,cmd -p "$(pgrep -f report-builder)"
```

Only root can *raise* a process's priority (lower its nice value). Anyone can lower the priority of their own processes. To start something at low priority: `nice -n 15 <command>`.

Leave `notification-retry` running. Then **Submit**.
