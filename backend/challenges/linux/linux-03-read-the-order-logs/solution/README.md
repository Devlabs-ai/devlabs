# Solution — Read the Order Logs

Logs are the first thing you read in any incident. `less` is for browsing, `head` and `tail` grab the ends, `wc` counts, and `tail -f` follows a file as it grows.

Docs: `man less` · `man head` · `man tail` · `man wc`

## Browse

```bash
cd /var/log/order-processor
ls -lh
less orders-2026-09-30.log
```

Inside `less`: `Space`/`b` page down/up, `G` end, `g` start, `/ERROR` search, `n` next match, `q` quit.

## Answers

`>` sends a command's output into a file:

```bash
mkdir -p ~/answers
wc -l < orders-2026-09-30.log            > ~/answers/line-count   # < avoids printing the filename
head -n 10 orders-2026-09-30.log         > ~/answers/first-10.txt
tail -n 5  orders-2026-09-30.log         > ~/answers/last-5.txt
sed -n 1500p orders-2026-09-30.log       > ~/answers/line-1500
# same thing with head/tail: head -n 1500 orders-2026-09-30.log | tail -n 1
```

## Follow the live log

```bash
tail -f live.log          # Ctrl+C to stop
```

A `NOTICE shift handoff code=...` line appears every 30 seconds. Write the newest code down quickly:

```bash
echo 'K3X9QA' > ~/answers/handoff-code
```

Then **Submit** before it rotates twice.
