# Solution — Fix the Config with sed and vim

`sed` edits text from a script, which is ideal for repeatable changes you could run on a hundred servers. `vim` is the editor that's on every server you'll ever SSH into. Use each where it fits.

Docs: `man sed` · `vimtutor` (a 30-minute interactive vim lesson)

## Look, then back up

```bash
cat -n /etc/order-processor/app.conf
sudo cp /etc/order-processor/app.conf /etc/order-processor/app.conf.bak
```

## Scripted edits with sed

Preview without `-i` first. Without `-i`, sed only prints the result:

```bash
sed 's/queue-old\.internal/queue.internal/g' /etc/order-processor/app.conf
```

Then apply all changes in place:

```bash
sudo sed -i \
  -e 's/queue-old\.internal/queue.internal/g' \
  -e 's/^log_level = debug$/log_level = info/' \
  -e '/TODO/d' \
  -e 's/^#metrics_port/metrics_port/' \
  /etc/order-processor/app.conf
```

- `s/old/new/g`: substitute. `g` replaces every match on the line, not just the first.
- `\.` matches a literal dot. A bare `.` matches any character.
- `/TODO/d`: delete the lines that match.
- `^`: start of line.

`sed -i.bak ...` would have made the backup for you.

## Interactive edit with vim

```bash
sudo vim /etc/order-processor/app.conf
```

1. `/\[queue\]` then `Enter` to jump to the section.
2. `o` to open a new line below and enter insert mode, then type `max_retries = 5`.
3. `Esc`, then `:wq` and `Enter` to write and quit. (`:q!` quits without saving.)

```bash
diff /etc/order-processor/app.conf.bak /etc/order-processor/app.conf
```

Then **Submit**.
