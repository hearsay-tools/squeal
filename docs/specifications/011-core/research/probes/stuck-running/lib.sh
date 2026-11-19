# Helpers for the 011-394 drivers (source after env.sh). Every Squeal call is bounded.
ts() { date -u +%H:%M:%S; }
log() { echo "$(ts) $*" | tee -a "$OUT/steps.log"; }
# sqt <seconds> <name> <args...>: runs sq with a timeout, keeps stdout, stderr and exit.
sqt() {
  t=$1; name=$2; shift 2
  start=$(date +%s%3N)
  timeout "$t" sq "$@" > "$OUT/$name.out" 2> "$OUT/$name.err"; code=$?
  ms=$(( $(date +%s%3N) - start ))
  echo "{\"t\":\"$(ts)\",\"name\":\"$name\",\"args\":\"$*\",\"exit\":$code,\"ms\":$ms,\"load\":\"$(cut -d' ' -f1-3 /proc/loadavg)\"}" >> "$OUT/calls.jsonl"
  log "$name exit=$code ms=$ms :: $(tail -n 1 "$OUT/$name.out" | cut -c1-300) || $(tail -n 1 "$OUT/$name.err" | cut -c1-300)"
  return $code
}
# Selected file state and reason from `sq status --json <path>`.
pick() { node -e '
const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const s=j.selection??{};
console.log(JSON.stringify({rev:j.revision, hb:j.daemon?.lastHeartbeatAt?Date.now()-j.daemon.lastHeartbeatAt:null,
 daemon:j.daemon?.state, listed:j.testFilesListed, runnerPartPending:j.runnerPartPending, code:s.code, result:s.result, reason:s.reason,
 files:(s.testFiles??[]).map(f=>({p:f.path.split("/").pop(),state:f.state,verdict:f.verdict,reason:f.reason}))}))' "$1" 2>/dev/null; }
