# Probes for row 011-249 (gh-1, a daemon stops on a signal)

Throwaway. Nothing here is product code or a test. Findings: `../../issue-1.md`.

## Files

- `notes.mjs`: prints every persisted note of a **copied** store as JSON lines, and each current `worktrees` row.
- `match.mjs`: joins the `daemon stopped: signal` notes with the cockpit's service stops, the Ansible restarts and the release tags. Its output on 2026-10-26 is `match-output.txt`.
- `stops.txt`: `cezar.service` stops from the user journal, UTC, 2026-10-01 to 2026-10-26. `stop` is a requested stop (`Stopping cezar.service`), `oom` the OOM killer, `exit` a main-process crash.
- `ansible.txt`: each `ansible.builtin.systemd_service ... name=cezar.service` call in the user journal, UTC.
- `tags.txt`: `squeal--v0.1.*` tag times from 2026-10-05, from the local clone.
- `exits-by-day.txt`: daemon exit notes per day, signal against all others, over all four stores.
- `listener.mjs`: what a Node `SIGTERM` listener receives.

## Re-run

Copy each store with its `-wal` and `-shm`; never open a live one:

```sh
mkdir -p /tmp/r011-249/stores/{squeal,cezar,toolkit,mvp}
for p in squeal:squeal cezar:cezar toolkit:toolkit-dev mvp:mvp-unveiled-july26; do
  d=${p%%:*}; s=/home/agent/projects/${p#*:}/.git/squeal
  nice -n 10 ionice -c3 cp "$s"/store.sqlite* /tmp/r011-249/stores/$d/
done
cd /tmp/r011-249
for s in squeal cezar toolkit mvp; do node <probe>/notes.mjs stores/$s/store.sqlite > $s.jsonl; done
```

Journal extracts (read-only):

```sh
TZ=UTC journalctl --user -u cezar.service --since 2026-10-01 --no-pager -o short-iso-precise \
  | grep -E "Stopping cezar|killed by the OOM killer|Main process exited, code=(dumped|killed|exited)" \
  | awk '{k=($0~/Stopping/)?"stop":($0~/OOM/)?"oom":"exit"; print substr($1,1,23), k}' > stops.txt
TZ=UTC journalctl --user --since 2026-10-01 --no-pager -o short-iso-precise \
  | grep -E "systemd_service Invoked with.*name=cezar.service" \
  | grep -o "^[^ ]*\|state=[a-z]*" | paste - - | cut -c1-23,33- > ansible.txt
git for-each-ref refs/tags --format='%(creatordate:iso-strict) %(refname:short)' \
  | grep "squeal--v0.1" | sort | awk '$1>="2026-10-05"' > tags.txt
node <probe>/match.mjs stops.txt ansible.txt tags.txt squeal.jsonl toolkit.jsonl mvp.jsonl
```

Signal listener (signals only the process it starts):

```sh
node listener.mjs > out.txt & P=$!; sleep 0.5; kill -TERM $P; wait $P; cat out.txt
# {"args":["SIGTERM",15],"ppid":...}
```

The service's kill settings: `systemctl --user show cezar.service -p KillMode,KillSignal,TimeoutStopUSec`. A daemon's control group: `cat /proc/<pid>/cgroup` (read only; never signal it).

Remove `/tmp/r011-249` afterwards.
