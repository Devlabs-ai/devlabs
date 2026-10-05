# Solution — Lock Down Payment Secrets

Everything under the payment-handler install is owned by `learner` and world-writable (`777` / `666`). Fix **ownership** with `chown`, **modes** with `chmod`, and give `learner` group access with `usermod -aG`. You need `sudo` for all of it — only root can give files away.

Docs: `man chmod` · `man chown` · `man usermod`

## Read the current state

```bash
ls -la /etc/payment-handler /var/log/payment-handler /opt/payment-handler/bin
stat /etc/payment-handler/secrets.env
id payment-handler
getent group payments
```

Mode digits are **owner / group / others**, each a sum of `r=4 w=2 x=1`. On a **directory**, `x` means "may enter" and `r` means "may list".

| Mode | Meaning |
|------|---------|
| `750` | owner rwx, group r-x, others nothing |
| `640` | owner rw-, group r--, others nothing |
| `600` | owner rw-, nobody else |

## Config directory and files

```bash
sudo chown root:payments /etc/payment-handler
sudo chmod 750 /etc/payment-handler

sudo chown root:payments /etc/payment-handler/payment-handler.conf
sudo chmod 640 /etc/payment-handler/payment-handler.conf

sudo chown payment-handler:payments /etc/payment-handler/secrets.env
sudo chmod 640 /etc/payment-handler/secrets.env

sudo chown payment-handler:payments /etc/payment-handler/signing.key
sudo chmod 600 /etc/payment-handler/signing.key
```

## Script and logs

```bash
sudo chown root:payments /opt/payment-handler/bin/rotate-keys.sh
sudo chmod 750 /opt/payment-handler/bin/rotate-keys.sh

sudo chown -R payment-handler:payments /var/log/payment-handler
sudo chmod 750 /var/log/payment-handler
sudo chmod 640 /var/log/payment-handler/payment-handler.log
```

## Give learner group access

`-a` **appends**. `usermod -G payments learner` without `-a` would drop learner from `sudo`.

```bash
sudo usermod -aG payments learner
id learner                      # payments listed (takes effect on next login)
```

Group membership only applies to new sessions. Test it without logging out:

```bash
sg payments -c 'cat /etc/payment-handler/secrets.env'     # works
sg payments -c 'cat /etc/payment-handler/signing.key'     # Permission denied
sudo -u nobody ls /etc/payment-handler                     # Permission denied
```

Then **Submit**.
