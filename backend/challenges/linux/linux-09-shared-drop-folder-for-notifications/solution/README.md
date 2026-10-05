# Solution — Shared Drop Folder for Notifications

Plain `rwx` modes have three limits for shared folders:
- New files get the creator's own group, so teammates can't read them. The **setgid** bit on the directory fixes that.
- Anyone who can write the directory can delete anyone's file. The **sticky** bit fixes that.
- There's only one group slot, so a read-only outsider can't be given access. **ACLs** fix that.

Docs: `man chmod` (SETUID AND SETGID BITS, RESTRICTED DELETION FLAG) · `man setfacl` · `man getfacl`

## Group ownership and special bits

```bash
sudo chgrp notify /srv/notifications/outbox
sudo chmod 3770 /srv/notifications/outbox
ls -ld /srv/notifications/outbox        # drwxrws--T  root notify
```

The leading `3` is `2` (setgid) plus `1` (sticky). In `ls`, an `s` in the group slot means setgid, and a `T`/`t` in the others slot means sticky.

## ACL for the auditor

```bash
sudo setfacl -m u:auditor:rx /srv/notifications/outbox        # access now
sudo setfacl -d -m u:auditor:rx /srv/notifications/outbox     # default: inherited by new files
getfacl /srv/notifications/outbox
ls -ld /srv/notifications/outbox        # a trailing + means an ACL is set
```

## Prove it

```bash
sudo -u order-bot   sh -c 'echo hi > /srv/notifications/outbox/o1'
ls -l /srv/notifications/outbox/o1                                     # group notify
sudo -u payment-bot cat /srv/notifications/outbox/o1                   # works
sudo -u payment-bot rm  /srv/notifications/outbox/o1                   # Operation not permitted (sticky)
sudo -u auditor     cat /srv/notifications/outbox/o1                   # works (ACL)
sudo -u auditor     touch /srv/notifications/outbox/a1                 # Permission denied
sudo rm /srv/notifications/outbox/o1
```

Then **Submit**.
