# Solution — Loop Over Order Batches

Loops let a script handle any number of files. Functions name a step so the loop stays readable. Environment variables let callers change where a script works without editing it. `~/.bashrc` runs at the start of every interactive shell, which makes it the place for your `PATH` and personal settings.

Docs: `man bash` (Looping Constructs, Shell Functions, Parameter Expansion, INVOCATION)

## The script

```bash
mkdir -p ~/bin
cat > ~/bin/process-batches <<'EOF'
#!/bin/bash
# process-batches — count and archive order batch CSVs from $ORDER_SPOOL/incoming.
spool="${ORDER_SPOOL:-/var/spool/orders}"

count_orders() {
  local lines
  lines=$(wc -l < "$1")
  echo $((lines - 1))          # minus the header row
}

shopt -s nullglob              # no matches → empty list, not a literal "*.csv"
total=0
for f in "$spool"/incoming/*.csv; do
  n=$(count_orders "$f")
  echo "$(basename "$f") $n"
  total=$((total + n))
  mv "$f" "$spool/processed/"
done
echo "TOTAL $total"
EOF
chmod +x ~/bin/process-batches
```

- `${ORDER_SPOOL:-/var/spool/orders}` uses the variable if it's set and the default otherwise.
- `"$f"` in quotes keeps `batch 0002 (retry).csv` as one argument.
- Globs expand in sorted order.

## PATH and ORDER_SPOOL in ~/.bashrc

```bash
cat >> ~/.bashrc <<'EOF'
export PATH="$HOME/bin:$PATH"
export ORDER_SPOOL=/var/spool/orders
EOF
source ~/.bashrc                 # apply to the current shell
command -v process-batches       # /home/learner/bin/process-batches
```

`export` makes a variable visible to programs you start, not just to the shell itself.

## Run it

```bash
process-batches
ls /var/spool/orders/incoming /var/spool/orders/processed
process-batches                  # TOTAL 0
```

Then **Submit**.
