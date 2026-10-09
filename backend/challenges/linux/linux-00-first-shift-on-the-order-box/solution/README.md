# Solution — First Shift on the Order Box

You are logged in as `learner` on the order box. Everything here is plain shell navigation: `pwd`, `ls`, `cd`, `cat`, and `man` to look up flags you don't know yet.

Docs: `man ls` · `man hier` (what each top-level directory is for)

## Look around

```bash
whoami                      # learner
hostname                    # order-box
pwd                         # /home/learner
ls /                        # top-level directories
```

## Find the release version

The version lives in a **hidden** file (name starts with a dot), so plain `ls` won't show it:

```bash
cd /opt/order-processor
ls -la                      # -a shows dotfiles: .release
cat .release
```

## Find the port

```bash
cat /etc/order-processor/app.conf
# or just the line you need:
grep port /etc/order-processor/app.conf
```

## Find the biggest log file

`man ls` → search with `/size` → `-S` sorts by file size, largest first:

```bash
ls -lS /var/log/order-processor
ls -S /var/log/order-processor | head -1
```

## Write your notes

Create the folder and the file as `learner` (no `sudo` — the file must be yours):

```bash
mkdir -p ~/notes
cd ~/notes
echo "<version>"  >  first-shift.txt    # e.g. 1.4.2
echo "<port>"     >> first-shift.txt    # e.g. 8317
echo "<logfile>"  >> first-shift.txt    # e.g. orders-2026-09-14.log
cat first-shift.txt
```

`>` creates/overwrites the file, `>>` appends a line. Use the file **name** for line 3, not the full path. Then **Submit**.
