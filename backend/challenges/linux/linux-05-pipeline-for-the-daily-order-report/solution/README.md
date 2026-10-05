# Solution — Pipeline for the Daily Order Report

Each Unix tool does one thing. A pipe (`|`) feeds one tool's output into the next. `awk -F,` splits CSV lines into fields `$1`, `$2`, and so on.

Columns in `orders.csv`: `date(1) order_id(2) customer(3) region(4) status(5) amount(6)`.

Docs: `man sort` · `man uniq` · `man cut` · `man awk` · `man bash` (REDIRECTION)

```bash
head -5 /srv/orders/orders.csv
mkdir -p ~/reports
cd /srv/orders
```

## Top 3 regions by completed orders

```bash
awk -F, 'NR>1 && $5=="completed" {print $4}' orders.csv \
  | sort | uniq -c | sort -rn | head -3 > ~/reports/top-regions.txt
```

`uniq -c` only merges *adjacent* duplicates, so you have to `sort` first. `sort -rn` then sorts numerically, highest first.

Without awk: `grep ',completed,' orders.csv | cut -d, -f4 | sort | uniq -c | sort -rn | head -3`.

## Total completed amount

```bash
awk -F, 'NR>1 && $5=="completed" {s += $6} END {printf "%.2f\n", s}' orders.csv > ~/reports/completed-total.txt
```

## Customers with failed orders

```bash
awk -F, '$5=="failed" {print $3}' orders.csv | sort -u > ~/reports/failed-customers.txt
```

## Split stdout and stderr

Every program has two output streams: stdout (`1`) for data and stderr (`2`) for errors and warnings.

```bash
/opt/order-processor/bin/order-export > ~/reports/export.csv 2> ~/reports/export.err
wc -l ~/reports/export.*
```

Then **Submit**.
