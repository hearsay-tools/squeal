#!/usr/bin/env bash
# Throwaway (row 021-04): the process-level cut. Start `node -e` (a stand-in for `node --test`)
# through ssh in its own process group, kill the group as startGroup does, then look at the remote.
set -uo pipefail
. "$(dirname "$0")/env.sh"
for tty in notty tty; do
  flag=""; [ $tty = tty ] && flag="-tt"
  setsid "$SSHW" $flag remote "cd $REMOTE_ROOT && exec node -e 'setTimeout(()=>{},30000)' marker-$tty" </dev/null >/dev/null 2>&1 &
  pid=$!; sleep 2
  kill -TERM -- -$pid 2>/dev/null; sleep 2
  echo "$tty: after killing the local group, remote marker processes: $(docker exec squeal-021-rs sh -c "ps -eo args | grep -c '[m]arker-$tty'")"
done
docker exec squeal-021-rs pkill -f marker- || true
