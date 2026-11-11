#!/usr/bin/env bash
# Throwaway (row 021-04): build the remote image, start the container on a loopback port,
# write SSH config and wrappers under $TMPDIR/rs, copy the fixture with its node_modules once.
# Squeal's clone is mounted read-only at /opt/squeal: it stands for "Squeal installed on the remote".
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/env.sh"
CMDIR=$(mktemp -d /tmp/sq021rs.XXXX); echo "$CMDIR" > "$RS/cmdir"
mkdir -p "$RS/home" "$RS/ssh" "$RS/sshwrap"
docker build -q -t squeal-021-rs:throwaway "$HERE" >/dev/null
[ -f "$RS/ssh/id" ] || ssh-keygen -q -t ed25519 -N '' -f "$RS/ssh/id"
docker rm -f squeal-021-rs >/dev/null 2>&1 || true
docker run -d --name squeal-021-rs -p 127.0.0.1::22 \
  -v "$SQUEAL_SRC":/opt/squeal:ro -v "$HERE":/opt/rs:ro squeal-021-rs:throwaway >/dev/null
docker exec -i squeal-021-rs sh -c 'mkdir -p /root/.ssh /work && chmod 700 /root/.ssh && cat > /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys' < "$RS/ssh/id.pub"
PORT=$(docker port squeal-021-rs 22/tcp | head -1 | sed 's/.*://')
cat > "$RS/ssh/config" <<CFG
Host remote
  HostName 127.0.0.1
  Port $PORT
  User root
  IdentityFile $RS/ssh/id
  IdentitiesOnly yes
  UserKnownHostsFile $RS/ssh/known_hosts
  StrictHostKeyChecking accept-new
  ControlMaster auto
  ControlPath $CMDIR/%C
  ControlPersist 300
CFG
printf '#!/bin/sh\nHOME=%s exec /usr/bin/ssh -F %s "$@"\n' "$RS/home" "$RS/ssh/config" > "$RS/sshwrap/ssh"
chmod +x "$RS/sshwrap/ssh"
sleep 1; rm -f "$RS/ssh/known_hosts"
"$SSHW" remote 'node --version; uname -sm'
T=$(date +%s%N)
rsync -a -e "$SSHW" "$FIXTURE/" "remote:$REMOTE_ROOT/"
echo "first copy with node_modules: $(( ($(date +%s%N)-T)/1000000 )) ms, $(du -sh "$FIXTURE" | cut -f1)"
