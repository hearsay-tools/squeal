#!/bin/sh
# Throwaway hook: append one JSON line to $W0C_LOG (default /tmp/w0c/logs/hooks.jsonl) with the
# label, the physical working directory, $PWD, the parent shell's argv, the names of every
# environment variable, the values of CODEX_*/PLUGIN_*/CLAUDE_* (credential-looking names
# dropped), and the stdin fields cwd/event/session/agent. Prints nothing, exits 0.
log="${W0C_LOG:-/tmp/w0c/logs/hooks.jsonl}"; mkdir -p "$(dirname "$log")"
in=$(cat)
parent=$(tr '\0' ' ' < /proc/$PPID/cmdline 2>/dev/null | cut -c1-200)
node -e '
const [label, physical, parent, stdin] = process.argv.slice(1);
const secret = /TOKEN|KEY|SECRET|AUTH|PASS|CRED/i;
const env = {}; for (const k of Object.keys(process.env).sort())
  if (/^(CODEX_|PLUGIN_|CLAUDE_)/.test(k) && !secret.test(k)) env[k] = process.env[k];
let s; try { s = JSON.parse(stdin); } catch { s = { raw: stdin.slice(0, 200) }; }
console.log(JSON.stringify({ label, event: s.hook_event_name, pwd_P: physical, PWD: process.env.PWD ?? null,
  stdin_cwd: s.cwd, session_id: s.session_id, agent_id: s.agent_id ?? null, parent, env,
  env_names: Object.keys(process.env).sort() }));
' "$1" "$(pwd -P)" "$parent" "$in" >> "$log"
exit 0
