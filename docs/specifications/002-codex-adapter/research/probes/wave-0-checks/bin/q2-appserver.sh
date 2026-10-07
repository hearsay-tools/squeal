#!/usr/bin/env bash
# Throwaway Q2b: Cezar-shaped app-server. Process cwd /tmp; thread/start cwd <repo>/pkg/sub;
# turn 2 overrides cwd to a second repository. Plugin hooks plus two launcher hooks declared in
# thread/start config, all trusted only through thread/start config "hooks.state" (no bypass).
# The launcher SessionStart hook also records which shell ran it ($0, $-, login or not).
set -e
B="$(cd "$(dirname "$0")" && pwd)"
bash "$B/q2-setup.sh" >/dev/null; export CODEX_HOME=/tmp/w0c/home-q2
rm -f /tmp/w0c/logs/q2-as.jsonl /tmp/w0c/logs/q2-shell.txt /tmp/w0c/logs/as-q2.log
SHELLPROBE='echo "$0|$-|$(shopt -q login_shell 2>/dev/null && echo login || echo non-login)|launcher" >> /tmp/w0c/logs/q2-shell.txt; sh '"$B"'/hook.sh launcher-SessionStart'
cat > /tmp/w0c/launcher-hooks.json <<J
{ "hooks": {
  "SessionStart": [ { "hooks": [ { "type": "command", "command": $(node -e 'console.log(JSON.stringify(process.argv[1]))' "$SHELLPROBE"), "timeout": 2 } ] } ],
  "PostToolUse": [ { "matcher": "*", "hooks": [ { "type": "command", "command": "sh $B/hook.sh launcher-PostToolUse", "timeout": 2 } ] } ]
} }
J
node "$B/hash.mjs" /tmp/w0c/launcher-hooks.json '/<session-flags>/config.toml' > /tmp/w0c/logs/q2-launcher-hashes.txt
START=$(node -e '
const fs = require("fs");
const hooks = JSON.parse(fs.readFileSync("/tmp/w0c/launcher-hooks.json")).hooks;
const state = {};
for (const f of ["/tmp/w0c/logs/q2-hashes.txt", "/tmp/w0c/logs/q2-launcher-hashes.txt"])
  for (const l of fs.readFileSync(f, "utf8").trim().split("\n")) { const [k, h] = l.split(" "); state[k] = { trusted_hash: h }; }
const config = { "hooks.state": state };
for (const [ev, groups] of Object.entries(hooks)) config["hooks." + ev] = groups;
console.log(JSON.stringify({ sandbox: "danger-full-access", approvalPolicy: "never", config }));')
W0C_LOG=/tmp/w0c/logs/q2-as.jsonl AS_LOG=/tmp/w0c/logs/as-q2.log node "$B/as-cwd.mjs" /tmp /tmp/w0c/r-q2/pkg/sub /tmp/w0c/r-q2-other \
  'Run `pwd` with your shell tool, once, and reply with its output only.' "$START"
