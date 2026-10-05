# Solution — Disk Full on the Order Box

`df` reports what the filesystem says is used. `du` adds up the files it can see. When the two disagree, a process is holding a **deleted** file open: the name is gone, but the space comes back only when the last open handle closes.

Docs: `man df` · `man du` · `man lsof`

## Triage

```bash
df -h /var/log/order-processor            # 100%
systemctl status order-processor          # crash loop: cannot write log
sudo du -sh /var/log/order-processor      # noticeably less than df says
sudo du -ah /var/log/order-processor | sort -h | tail
ls -lhS /var/log/order-processor
```

## Free the obvious space

```bash
sudo rm /var/log/order-processor/order-processor.log.{2,3,4,5}
sudo mv /var/log/order-processor/order-processor-heap.hprof /var/tmp/
df -h /var/log/order-processor
```

## Find the deleted-but-open file

```bash
sudo lsof +L1                                  # open files with link count 0 (deleted)
sudo lsof -a +L1 /var/log/order-processor     # -a: AND the filters (lsof ORs them by default)
# order-expo  1234 root  4w  REG ... /var/log/order-processor/export-spool.tmp (deleted)
mkdir -p ~/answers
echo order-exporter > ~/answers/held-by
```

Restart the holder so it closes the old file:

```bash
sudo systemctl restart order-exporter
df -h /var/log/order-processor                 # space comes back
```

Without lsof: `sudo find /proc/*/fd -lname '*(deleted)' -ls`.

## Bring order-processor back

```bash
sudo systemctl restart order-processor
systemctl status order-processor
curl http://127.0.0.1:8080/health
```

Then **Submit**. The long-term fix is a logrotate rule (lab 16) and an alert on disk usage.
