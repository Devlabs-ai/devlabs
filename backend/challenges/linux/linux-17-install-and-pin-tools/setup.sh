#!/usr/bin/env bash
# The stock box: no package lists downloaded, ncdu missing, htop installed (not approved).
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/lab.sh"

box_script <<'EOF'
rm -rf /home/learner/answers
apt-mark unhold jq >/dev/null 2>&1 || true
dpkg-query -W -f '${Status}' htop 2>/dev/null | grep -q 'ok installed' || { echo "htop missing from image" >&2; exit 1; }
EOF
ok "box ready"
