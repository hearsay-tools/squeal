#!/usr/bin/env bash
# Throwaway (018-14). How a developer clone reads a CI-written results ref.
# Shows: configured refspec behaviour when the remote lacks the ref; FETCH_HEAD;
# notes outside `git log`; worktrees share the fetched ref; fetching one per-commit
# ref; offline and auth failures with GIT_TERMINAL_PROMPT=0 (no prompt, no hang?).
# Usage: reader.sh <work dir under $TMPDIR>
set -uo pipefail
. "$(dirname "$0")/common.sh"
fresh "$1"; W=$PWD
git clone -q origin.git dev
c3=$(git -C ci rev-parse HEAD)
echo "--- 1. configured refspec, remote has no notes ref yet"
git -C dev config --add remote.origin.fetch '+refs/notes/squeal:refs/notes/squeal'
git -C dev fetch origin; echo "exit $?"
git -C dev pull -q; echo "pull exit $?"
git -C dev config --unset remote.origin.fetch '\+refs/notes/squeal:refs/notes/squeal'
git -C dev config --add remote.origin.fetch '+refs/squeal/*:refs/squeal/*'
git -C dev fetch origin; echo "wildcard refspec, no match: exit $?"
git -C dev config --unset remote.origin.fetch '\+refs/squeal/\*:refs/squeal/\*'
echo "--- 2. explicit fetch of a missing ref (command line)"
git -C dev fetch origin refs/notes/squeal:refs/notes/squeal; echo "exit $?"
echo "--- 3. CI writes a note and a per-commit ref"
echo '{"x":1}' > n.json
git -C ci notes --ref=squeal add -F "$W/n.json" "$c3"; git -C ci push -q origin refs/notes/squeal
k=$(git -C ci commit-tree "$(git -C ci notes --ref=squeal show "$c3" >/dev/null; printf '100644 blob %s\texport.json\n' "$(git -C ci hash-object -w "$W/n.json")" | git -C ci mktree)" -m results)
git -C ci push -q origin "$k:refs/squeal/$c3"
echo "--- 4. FETCH_HEAD: user state before, after a plain fetch, after --no-write-fetch-head"
git -C dev fetch -q origin main; before=$(cat dev/.git/FETCH_HEAD | cut -c1-60)
git -C dev fetch -q --no-write-fetch-head --no-auto-maintenance origin +refs/notes/squeal:refs/notes/squeal
[ "$(cut -c1-60 dev/.git/FETCH_HEAD)" = "$before" ] && echo "--no-write-fetch-head kept FETCH_HEAD" || echo "FETCH_HEAD changed"
git -C dev fetch -q origin +refs/notes/squeal:refs/notes/squeal
[ "$(cut -c1-60 dev/.git/FETCH_HEAD)" = "$before" ] && echo "plain fetch kept FETCH_HEAD" || echo "plain fetch rewrote FETCH_HEAD: $(cut -c1-60 dev/.git/FETCH_HEAD)"
echo "--- 5. the note does not show in git log; it does with --notes=squeal"
git -C dev log -1 --format='%H%n%N' | sed 's/^/log: /'
git -C dev log -1 --notes=squeal --format='%N' | sed 's/^/log --notes=squeal: /'
echo "--- 6. a linked worktree sees the fetched ref"
git -C dev worktree add -q ../wt HEAD 2>/dev/null; git -C wt notes --ref=squeal show "$c3"
echo "--- 7. fetch one per-commit ref only"
git -C dev fetch -q --no-write-fetch-head origin "refs/squeal/$c3:refs/squeal/$c3" && git -C dev cat-file -p "refs/squeal/$c3:export.json"
echo "--- 8. offline: connection refused"
t=$(ms); git -C dev fetch -q http://127.0.0.1:9/x.git refs/notes/squeal 2>&1 | tail -1; echo "took $(( $(ms)-t )) ms"
echo "--- 9. offline: unroutable address, no timeout set (cut at 20 s by timeout(1))"
t=$(ms); timeout 20 git -C dev fetch -q http://10.255.255.1/x.git refs/notes/squeal 2>&1 | tail -1; echo "exit ${PIPESTATUS[0]}, took $(( $(ms)-t )) ms"
echo "--- 10. ssh: unroutable, BatchMode and ConnectTimeout=3"
t=$(ms); GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=3' timeout 20 git -C dev fetch -q ssh://git@10.255.255.1/x.git refs/notes/squeal 2>&1 | tail -1; echo "took $(( $(ms)-t )) ms"
echo "--- 11. https remote that asks for credentials (local 401 server), no helper, GIT_TERMINAL_PROMPT=0"
node -e 'require("http").createServer((q,r)=>{r.writeHead(401,{"WWW-Authenticate":"Basic realm=x"});r.end()}).listen(18765)' & srv=$!; sleep 0.5
t=$(ms); timeout 20 git -C dev fetch -q http://127.0.0.1:18765/x.git refs/notes/squeal 2>&1 | tail -1; echo "exit ${PIPESTATUS[0]}, took $(( $(ms)-t )) ms"
kill $srv
