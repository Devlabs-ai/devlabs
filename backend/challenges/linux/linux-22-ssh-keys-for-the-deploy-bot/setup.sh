#!/usr/bin/env bash
# A deploy account with a password and no keys, and an sshd that accepts passwords and
# root logins.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

box_script <<'EOF'
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
echo 'deploy:deploy123' | chpasswd
rm -rf /home/deploy/.ssh /home/learner/.ssh
rm -f /etc/ssh/sshd_config.d/*.conf
cat > /etc/ssh/sshd_config.d/50-legacy.conf <<'CONF'
# Added during the 2023 migration. "Temporary."
PasswordAuthentication yes
PermitRootLogin yes
CONF
systemctl restart ssh.socket
systemctl restart ssh.service 2>/dev/null || true
EOF
ok "deploy account and permissive sshd ready"
