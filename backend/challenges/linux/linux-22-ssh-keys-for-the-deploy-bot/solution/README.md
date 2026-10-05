# Solution — SSH Keys for the Deploy Bot

Key authentication works like this: the **private** key stays on the client (`~/.ssh/id_ed25519`, mode 600), and the **public** key goes into the server account's `~/.ssh/authorized_keys`. sshd refuses keys whose files are writable by other users, so permissions matter.

Docs: `man ssh-keygen` · `man sshd_config` · `man ssh_config`

## Key pair

```bash
ssh-keygen -t ed25519 -C "deploy-bot" -f ~/.ssh/id_ed25519 -N ''
ls -l ~/.ssh
```

`-N ''` means no passphrase, which suits a bot. For a human, use a passphrase and `ssh-agent`.

## Authorize it for deploy

`ssh-copy-id` would do this over SSH. Here you have sudo, so do it directly:

```bash
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
cat ~/.ssh/id_ed25519.pub | sudo tee -a /home/deploy/.ssh/authorized_keys >/dev/null
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
ssh -o StrictHostKeyChecking=accept-new deploy@127.0.0.1 whoami     # deploy
```

## Client alias

```bash
cat >> ~/.ssh/config <<'EOF'
Host order-box
    HostName 127.0.0.1
    User deploy
    IdentityFile ~/.ssh/id_ed25519
EOF
chmod 600 ~/.ssh/config
ssh order-box whoami
```

## Harden sshd

For each setting, sshd uses the **first** value it reads, and files in `sshd_config.d/` are read in name order. A `10-` file therefore beats the existing `50-legacy.conf`. You could also delete or fix the legacy file.

```bash
sudo tee /etc/ssh/sshd_config.d/10-hardening.conf >/dev/null <<'EOF'
PasswordAuthentication no
PermitRootLogin no
EOF
sudo sshd -t                                   # syntax check
sudo sshd -T | grep -E 'passwordauthentication|permitrootlogin'
sudo systemctl restart ssh
ssh -o PubkeyAuthentication=no deploy@127.0.0.1   # Permission denied (publickey)
ssh order-box whoami                              # still works
```

Then **Submit**.
