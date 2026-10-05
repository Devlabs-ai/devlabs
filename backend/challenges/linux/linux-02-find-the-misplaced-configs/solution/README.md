# Solution — Find the Misplaced Configs

`find` walks a directory tree and filters by name, type, owner, size and age. You can then print the matches, delete them, or run a command on each one.

Docs: `man find` (see TESTS and ACTIONS)

## 1. Configs under /srv owned by orders

```bash
find /srv -type f -name '*.conf' -user orders
mkdir -p ~/answers
find /srv -type f -name '*.conf' -user orders > ~/answers/orders-configs
cat ~/answers/orders-configs
```

Quote the pattern (`'*.conf'`). Without quotes, the shell expands it in your current directory before `find` ever sees it.

## 2. Dumps larger than 10 MiB

Always look before you delete:

```bash
find /var/tmp/order-dumps -type f -size +10M -exec ls -lh {} \;
sudo find /var/tmp/order-dumps -type f -size +10M -delete
find /var/tmp/order-dumps -type f -exec ls -lh {} \;     # only small ones left
```

`-size +10M` means *more than* 10 MiB. The 9 MiB file stays.

## 3. Configs changed in the last 2 days

`-mtime -2` means modified less than 2×24 hours ago:

```bash
find /etc/order-processor -type f -mtime -2
mkdir -p ~/recent
find /etc/order-processor -type f -mtime -2 -exec cp {} ~/recent/ \;
ls -l ~/recent
```

Then **Submit**.
