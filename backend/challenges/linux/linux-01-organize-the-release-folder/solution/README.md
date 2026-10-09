# Solution — Organize the Release Folder

Everything here is `mkdir`, `cp`, `mv`, `rm` and shell globs (`*.conf` matches every name ending in `.conf`). Work as `learner`, no `sudo`.

Docs: `man mkdir` · `man cp` · `man mv` · `man rm` · `man 7 glob`

## Look first

```bash
cd ~/incoming
ls -la
```

## Build the layout

`-p` creates parents and doesn't complain if a folder exists. Braces expand to three names:

```bash
mkdir -p ~/release/{bin,config,logs}
```

## Move configs and logs

The glob catches `payment handler.conf` even though it has a space. When you type that name yourself, quote it: `'payment handler.conf'`.

```bash
mv *.conf ~/release/config/
mv *.log  ~/release/logs/
```

## Copy the binary, move the README

```bash
cp -p order-processor ~/release/bin/      # -p keeps the executable mode and timestamps
mv README ~/release/README.md              # mv also renames
```

## Clean up

```bash
rm *.tmp
rmdir old            # rmdir only removes empty folders — a safe habit
ls -A                # only order-processor left
ls -R ~/release
```

Then **Submit**.
