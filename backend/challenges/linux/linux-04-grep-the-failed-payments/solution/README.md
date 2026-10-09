# Solution — Grep the Failed Payments

`grep` prints the lines that match a pattern. A few flags cover most real work:

| Flag | Meaning |
|------|---------|
| `-i` | ignore letter case |
| `-w` | match whole words only (`E402` doesn't match `E4021`) |
| `-c` | count matching lines |
| `-o` | print only the matched part |
| `-E` | extended regex (`{6}`, `+`, `\|`) |
| `-r` / `-l` | search a directory tree / list matching file names |

Docs: `man grep` · `man 7 regex`

```bash
cd /var/log/payment-handler
mkdir -p ~/answers
```

## 1. Every failed payment, in any case

```bash
grep -i 'failed' payments.log > ~/answers/failed.txt
```

## 2. How many E402s

```bash
grep -c 'code=E402' payments.log        # too many: also counts E4021
grep -cw 'code=E402' payments.log > ~/answers/e402-count
```

## 3. Unique order IDs on declined lines

Chain two greps: the first keeps the declined lines, the second cuts out the IDs.

```bash
grep -w 'declined' payments.log | grep -oE 'ORD-[0-9]{6}' | sort -u > ~/answers/declined-orders
```

`-w` skips `predeclined`. `sort -u` sorts and removes duplicates.

## 4. Configs that set a timeout

```bash
grep -ri 'timeout' /etc/payment-handler                # includes a comment line
grep -rlE '^[a-z_]*timeout *=' /etc/payment-handler > ~/answers/timeout-configs
```

`^` anchors the match to the start of the line, so comment lines starting with `#` are skipped.

Then **Submit**.
