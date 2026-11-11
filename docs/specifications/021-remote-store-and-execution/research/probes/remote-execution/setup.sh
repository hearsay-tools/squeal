#!/usr/bin/env bash
# Throwaway (row 021-02): start the remote container and SSH wrappers under $TMPDIR/re.
set -euo pipefail
. "$(dirname "$0")/env.sh"
CMDIR=$(mktemp -d /tmp/sq021.XXXX); echo "$CMDIR" > "$RE/cmdir"
mkdir -p "$HOME" "$RE/ssh" "$RE/sshwrap" "$MUTAGEN_DATA_DIRECTORY"
[ -f "$RE/ssh/id" ] || ssh-keygen -q -t ed25519 -N '' -f "$RE/ssh/id"
docker rm -f squeal-021-remote >/dev/null 2>&1 || true
docker run -d --name squeal-021-remote -p 127.0.0.1::22 squeal-021-remote:throwaway >/dev/null
docker exec -i squeal-021-remote sh -c 'mkdir -p /root/.ssh && chmod 700 /root/.ssh && cat > /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys' < "$RE/ssh/id.pub"
PORT=$(docker port squeal-021-remote 22/tcp | head -1 | sed 's/.*://')
cat > "$RE/ssh/config" <<CFG
Host remote
  HostName 127.0.0.1
  Port $PORT
  User root
  IdentityFile $RE/ssh/id
  IdentitiesOnly yes
  UserKnownHostsFile $RE/ssh/known_hosts
  StrictHostKeyChecking accept-new
  ControlMaster auto
  ControlPath $CMDIR/%C
  ControlPersist 120
CFG
for t in ssh scp; do
  printf '#!/bin/sh\nexec /usr/bin/%s -F %s "$@"\n' "$t" "$RE/ssh/config" > "$RE/sshwrap/$t"
  chmod +x "$RE/sshwrap/$t"
done
sleep 1
rm -f "$RE/ssh/known_hosts"
"$RE/sshwrap/ssh" remote 'node --version; uname -sm; id -un'
