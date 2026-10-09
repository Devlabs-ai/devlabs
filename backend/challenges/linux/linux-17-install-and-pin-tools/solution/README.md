# Solution — Install and Pin Tools

`apt` installs from online repositories and resolves dependencies. `dpkg` is the lower-level tool that knows what is installed and which files belong to which package.

Docs: `man apt` · `man apt-mark` · `man dpkg-query` · `man dpkg`

## Install ncdu

The box ships without package lists, so download them first:

```bash
sudo apt update
apt search ncdu        # or: apt show ncdu
sudo apt install -y ncdu
ncdu /var/log          # q to quit
```

## Hold jq

A hold stops `apt upgrade` from changing a package's version:

```bash
sudo apt-mark hold jq
apt-mark showhold
```

`sudo apt-mark unhold jq` releases it.

## Purge htop

`remove` deletes the program but keeps its config files (status `rc`). `purge` deletes both.

```bash
sudo apt purge -y htop
dpkg -l htop           # no "ii" or "rc" line left
```

## Who owns what

```bash
mkdir -p ~/answers
dpkg -S /usr/bin/dig                              # bind9-dnsutils: /usr/bin/dig
dpkg -S /usr/bin/dig | cut -d: -f1 > ~/answers/dig-package
dpkg -L cron | head                               # files a package installed
dpkg-query -W -f '${Version}\n' cron > ~/answers/cron-version
apt policy cron                                   # installed vs candidate version
```

Then **Submit**.
