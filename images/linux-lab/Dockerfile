# Learner machine for the Linux module: Ubuntu with systemd as PID 1 and a sudo-capable
# `learner` user. Runs as a user-namespaced pod (hostUsers: false), so root here is an
# unprivileged UID on the node. See deploy/eks/linux/.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    container=containerd

# The minimized base image drops man pages and stubs out `man`; labs use `man`.
# Reinstalling the base packages restores pages for coreutils, bash, passwd, etc.
RUN rm -f /etc/dpkg/dpkg.cfg.d/excludes /usr/bin/man \
  && dpkg-divert --quiet --local --rename --remove /usr/bin/man \
  && apt-get update \
  && dpkg-query -W -f '${binary:Package}\n' \
    | xargs apt-get install -y --reinstall --no-install-recommends \
  && apt-get install -y --no-install-recommends \
    systemd systemd-sysv dbus sudo cron logrotate rsyslog \
    bash-completion ca-certificates less man-db manpages nano vim file tree \
    procps psmisc htop lsof strace \
    acl attr tar gzip zip unzip bzip2 xz-utils rsync \
    iproute2 iputils-ping dnsutils netcat-openbsd curl wget traceroute nftables iptables \
    openssh-server openssh-client \
    jq gawk sed grep findutils \
  && rm -rf /var/lib/apt/lists/*

# Units that need hardware or a real console never start in a pod; masking them keeps
# `systemctl is-system-running` at "running" instead of "degraded".
RUN systemctl mask \
    systemd-udevd.service systemd-udevd-kernel.socket systemd-udevd-control.socket \
    systemd-modules-load.service sys-kernel-config.mount sys-kernel-debug.mount \
    sys-kernel-tracing.mount sys-fs-fuse-connections.mount \
    systemd-remount-fs.service getty.target console-getty.service \
    systemd-logind.service systemd-networkd-wait-online.service \
  && systemctl enable cron rsyslog \
  && rm -f /etc/ssh/ssh_host_*_key*

# Boxes share a pod network, so sshd stays off unless a lab starts it, and never takes
# passwords by default: some labs create users with known passwords.
RUN systemctl disable ssh.service ssh.socket 2>/dev/null; \
  printf '%s\n' \
    'PasswordAuthentication no' \
    'KbdInteractiveAuthentication no' \
    'HostKey /etc/ssh/ssh_host_ed25519_key' \
    'HostKey /etc/ssh/ssh_host_ecdsa_key' \
    > /etc/ssh/sshd_config.d/10-devsetu.conf

# Host keys differ per learner machine. Generated before ssh.service, whose own
# ExecStartPre (sshd -t) fails without them. No RSA key: under the box's CPU limit
# it takes 4-13 s and every boot waited on it.
RUN printf '%s\n' \
    '[Unit]' \
    'Description=Generate SSH host keys' \
    'DefaultDependencies=no' \
    'After=local-fs.target' \
    'Before=ssh.socket ssh.service' \
    'ConditionPathExists=!/etc/ssh/ssh_host_ed25519_key' \
    '[Service]' \
    'Type=oneshot' \
    "ExecStart=/usr/bin/ssh-keygen -q -t ed25519 -N '' -f /etc/ssh/ssh_host_ed25519_key" \
    "ExecStart=/usr/bin/ssh-keygen -q -t ecdsa -N '' -f /etc/ssh/ssh_host_ecdsa_key" \
    '[Install]' \
    'WantedBy=sockets.target' \
    > /etc/systemd/system/ssh-hostkeys.service \
  && systemctl enable ssh-hostkeys.service

# Colored prompt (green user, red root). Added to skel before useradd so learner and
# every user a lab creates get it too.
COPY prompt.sh /etc/devsetu/prompt.sh
RUN for rc in /etc/skel/.bashrc /root/.bashrc; do \
      printf '\n. /etc/devsetu/prompt.sh\n' >> "$rc"; \
    done

RUN userdel -r ubuntu 2>/dev/null || true \
  && useradd -m -u 1000 -s /bin/bash -G sudo learner \
  && echo 'learner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-learner \
  && chmod 0440 /etc/sudoers.d/90-learner

STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
