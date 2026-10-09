# Solution — Keep the Batch Running After Logout

When a terminal closes, the kernel sends **SIGHUP** ("hang up") to the processes running in it, and by default they die. `nohup` makes a command ignore SIGHUP. `&` puts it in the background, so you get your prompt back.

Docs: `man nohup` · `man bash` (JOB CONTROL) · `man 7 signal`

## Job control first

```bash
/opt/order-processor/bin/batch-export      # runs in the foreground, holding your prompt
# Ctrl+Z   → stops (suspends) it
jobs        # [1]+  Stopped
bg          # resume it in the background
fg          # bring it back to the foreground
# Ctrl+C   → kill it
```

A background job started this way still dies when the terminal closes.

## Start it properly

```bash
cd ~
nohup /opt/order-processor/bin/batch-export > ~/batch-export.log 2>&1 &
jobs -l
tail -f ~/batch-export.log      # Ctrl+C stops tail, not the batch
```

- `nohup`: ignore SIGHUP.
- `> file 2>&1`: stdout *and* stderr into the log. Without it, nohup writes to `nohup.out`.
- `&`: run in the background.

## Prove it

```bash
pgrep -af batch-export
kill -HUP "$(pgrep -f batch-export)"   # what closing the terminal would do
pgrep -af batch-export                 # still running
```

Then **Submit**. For anything that must survive a reboot as well, use a systemd service (lab 12).
