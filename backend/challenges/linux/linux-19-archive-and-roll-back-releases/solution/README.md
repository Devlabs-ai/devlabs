# Solution — Archive and Roll Back Releases

The release layout used by most deploy tools: every version lives in its own folder, and a `current` **symlink** points at the live one. Rolling back means re-pointing one link. `tar` + `gzip` package a folder into one file. A **hard link** is a second name for the same file data (inode); a symlink is a pointer to a *path*.

Docs: `man tar` · `man ln` · `man stat`

## Look

```bash
ls -l /opt/order-processor /opt/order-processor/releases
readlink /opt/order-processor/current
```

## Roll back first (outage first, housekeeping later)

```bash
sudo ln -sfn releases/v1.1 /opt/order-processor/current
/opt/order-processor/current/bin/order-processor      # v1.1
```

`-s` makes a symlink, `-f` replaces the existing link, and `-n` treats the existing link as a file rather than descending into the directory it points to.

## Archive v1.2, then remove it

`-C` changes into a directory first, so the paths inside the archive start at `v1.2/`:

```bash
sudo tar -C /opt/order-processor/releases -czf /var/backups/order-processor-v1.2.tar.gz v1.2
tar -tzf /var/backups/order-processor-v1.2.tar.gz          # list without extracting
sudo rm -rf /opt/order-processor/releases/v1.2
```

The flags: `c` create, `x` extract, `t` list, `z` gzip, `f` the archive file.

## Restore v1.0

```bash
sudo tar -C /opt/order-processor/releases -xzf /var/backups/order-processor-v1.0.tar.gz
ls -l /opt/order-processor/releases/v1.0/bin      # modes preserved
```

## Config symlink and hard-link backup

```bash
sudo ln -sfn /opt/order-processor/current/app.conf /etc/order-processor/app.conf
cat /etc/order-processor/app.conf                  # v1.1 config

sudo ln /opt/order-processor/releases/v1.1/app.conf /var/backups/app.conf.v1.1
ls -li /opt/order-processor/releases/v1.1/app.conf /var/backups/app.conf.v1.1   # same inode, link count 2
```

Deleting the release folder later wouldn't touch the backup: the data survives while any hard link points at it. Hard links can't cross filesystems or point at directories.

Then **Submit**.
