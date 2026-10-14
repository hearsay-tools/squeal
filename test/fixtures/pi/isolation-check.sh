#!/usr/bin/env bash
# Spec 009 open question 5: does Pi 1.0.4 with PI_CODING_AGENT_DIR set write anything outside
# its temp directory? Pi runs only as the throwaway user squeal-e2e: run from the agent user,
# this script copies itself and the fixture into that user's home and runs there; it never
# starts Pi as any other user.
#   bash test/fixtures/pi/isolation-check.sh
# Each mode (-p, json, rpc) writes then answers through the fake provider, traced with strace;
# every file-changing syscall on a path outside the temp directory is reported. A snapshot of
# HOME and of this user's files in the temp roots (path, size, mtime) is diffed as a second check.
set -eu
if [ "$(id -un)" != squeal-e2e ]; then
  HERE=$(cd "$(dirname "$0")" && pwd)
  E2E=(sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e
    PATH=/home/squeal-e2e/.npm-global/bin:/opt/squeal-e2e/node24/bin:/usr/bin:/bin)
  D=/home/squeal-e2e/pi-isolation
  tar -C "$HERE" -cf - fake-provider.ts isolation-plan.json isolation-check.sh \
    | "${E2E[@]}" bash -c "rm -rf $D && mkdir -p $D && tar -C $D -xf -"
  exec "${E2E[@]}" bash -c "cd / && bash $D/isolation-check.sh $D" </dev/null
fi
[ "$(pi --version)" = 1.0.4 ] || { echo "needs Pi 1.0.4 in squeal-e2e's ~/.npm-global" >&2; exit 2; }
T=$(mktemp -d /tmp/pi-iso.XXXXXX)
mkdir -p "$T/fixture" "$T/agent" "$T/proj" "$T/out"
cp "$1/fake-provider.ts" "$T/fixture/"
cp "$1/isolation-plan.json" "$T/fixture/plan.json"
printf 'alpha\n' > "$T/proj/a.txt"

# ~/runs holds the eval harness's cells, which run as squeal-e2e concurrently; Pi never reaches it
# (strace above is the check that is immune to concurrent writers).
snapshot() {
  find "$HOME" -xdev -path "$HOME/runs" -prune -o -printf '%p\t%s\t%T@\n' 2>/dev/null
  find /tmp /var/tmp /dev/shm -xdev -path "$T" -prune -o -user "$(id -un)" -printf '%p\t%s\t%T@\n' 2>/dev/null
}
snapshot | sort > "$T/out/home.before"

# A mode under one environment: "agent" sets PI_CODING_AGENT_DIR only (the spec's question);
# "helper" also points HOME and TMPDIR into the temp dir, as test/helpers/pi.ts does.
run() {
  local name=$1 extra=$2; shift 2
  env -i HOME="$HOME" PATH="$PATH" PI_CODING_AGENT_DIR="$T/agent" PI_OFFLINE=1 $extra \
    PI_FIXTURE_PLAN="$T/fixture/plan.json" PI_FIXTURE_LOG="$T/out/requests.$name.jsonl" \
    strace -f -qq -o "$T/out/strace.$name" -e trace=%file,%desc -e signal=none "$@" \
    > "$T/out/stdout.$name" 2> "$T/out/stderr.$name" || echo "exit $?" >> "$T/out/stderr.$name"
}
# The RPC run: one prompt, then stdin closes at the first agent_settled.
RPC='
  const { spawn } = require("node:child_process");
  const child = spawn(process.argv[1], process.argv.slice(2), { stdio: ["pipe", "pipe", "inherit"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; if (out.includes("\"type\":\"agent_settled\"")) child.stdin.end(); });
  child.stdin.write(JSON.stringify({ id: "p1", type: "prompt", message: "write out.txt" }) + "\n");
  const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
  child.on("exit", (code, signal) => { clearTimeout(timer); process.stdout.write(out); console.error(`exit ${code} ${signal}`); });
'
PI=(pi --provider fake --model fake-1 -e "$T/fixture/fake-provider.ts")
cd "$T/proj"
mkdir -p "$T/tmp" "$T/home"
for env in agent helper; do
  extra=""; [ "$env" = helper ] && extra="HOME=$T/home TMPDIR=$T/tmp"
  run "print.$env" "$extra" "${PI[@]}" -p "write out.txt" < /dev/null
  run "json.$env" "$extra" "${PI[@]}" --mode json -p "write out.txt" < /dev/null
  run "rpc.$env" "$extra" node -e "$RPC" "${PI[@]}" --mode rpc
done
cd /

snapshot | sort > "$T/out/home.after"
echo "temp dir: $T"
for name in print.agent json.agent rpc.agent print.helper json.helper rpc.helper; do
  echo "== $name: $(wc -l < "$T/out/requests.$name.jsonl" 2>/dev/null || echo 0) model requests; $(tail -n 1 "$T/out/stderr.$name")"
  # Every successful file-changing syscall outside the temp dir: write-mode opens, mkdir,
  # rename, unlink, rmdir, links, chmod, utimes, truncate. Failed calls (= -1) are listed apart.
  grep -E '^[0-9]+ +(open|openat|creat|mkdir|mkdirat|rmdir|rename|renameat|renameat2|unlink|unlinkat|link|linkat|symlink|symlinkat|chmod|fchmodat|chown|fchownat|lchown|utimensat|utimes|truncate)\(' "$T/out/strace.$name" \
    | grep -vE '^[0-9]+ +(open|openat)\(' | cat - <(grep -E '^[0-9]+ +(open|openat)\(.*O_(WRONLY|RDWR|CREAT)' "$T/out/strace.$name") \
    | grep -vE "\"$T(/|\")" | grep -vE '"/dev/(null|tty|pts)' \
    | sed -E 's/^[0-9]+ +([a-z0-9]+)\([^"]*"([^"]*)".*= (-?[0-9]+)( [A-Z]+)?.*/  \1 \2 = \3\4/' | sort -u
  # Reads under the real HOME other than Pi's own install and this script's copy.
  grep -oE "\"$HOME/[^\"]*\"" "$T/out/strace.$name" | grep -vE "/(\.npm-global|pi-isolation)/" | sort -u | sed 's/^/  looked at: /'
done
echo "== changes under HOME (~/runs excluded) and to this user's files in /tmp, /var/tmp, /dev/shm:"
diff "$T/out/home.before" "$T/out/home.after" | grep '^[<>]' | sed 's/^/  /' || true
rm -rf "$T"
