# Solution — Onboard the Payments Team

Users and groups decide who can do what on a box. `sudo` rules belong in small drop-in files under `/etc/sudoers.d/`, never in edits to `/etc/sudoers` itself. Offboarding means **locking** an account, not deleting it.

Docs: `man useradd` · `man usermod` · `man sudoers` · `man passwd`

## Group and users

```bash
sudo groupadd payments-team
sudo useradd -m -s /bin/bash -G payments-team priya
sudo useradd -m -s /bin/bash -G payments-team,adm marco
id priya; id marco
ls -ld /home/priya /home/marco
```

- `-m`: create the home directory.
- `-s`: login shell.
- `-G`: supplementary groups.

## Least-privilege sudo

`visudo -f` edits the file safely: it refuses to save a broken file, which could otherwise lock everyone out of sudo.

```bash
sudo visudo -f /etc/sudoers.d/payments-team
```

```
%payments-team ALL=(root) NOPASSWD: /usr/bin/systemctl restart payment-handler, /usr/bin/systemctl status payment-handler
```

`%` means a group. Always use full command paths.

```bash
sudo chmod 440 /etc/sudoers.d/payments-team
sudo visudo -cf /etc/sudoers.d/payments-team
sudo -l -U priya
```

Test as the new user:

```bash
sudo -u priya sudo -n systemctl restart payment-handler     # works
sudo -u priya sudo -n cat /etc/shadow                       # "a password is required" — denied
```

## Offboard olek

```bash
sudo usermod -L -s /usr/sbin/nologin olek     # lock the password, no interactive shell
sudo passwd -S olek                           # second field: L = locked
```

Keep `/home/olek`; audits and handovers need it. Then **Submit**.
