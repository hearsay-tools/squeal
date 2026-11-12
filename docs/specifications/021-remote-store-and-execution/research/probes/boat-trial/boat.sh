#!/bin/sh
# Throwaway (row 021-15). boat.dev API calls for the trial, and the ssh files that pin
# the sandbox's host key per start. The API key comes from the agent-vault proxy
# (HTTPS_PROXY): the bearer below is a placeholder the proxy replaces. Never put a key here.
#
# Usage: boat.sh <state-dir> create|get|sshkey|stop|resume|usage|limits [args]
# Files in <state-dir>: id (sandbox id), known_hosts, config (ssh -F), *.json answers.
set -eu
S=$1; shift
API=https://boat.dev/api/v1
KEY=/home/agent/.config/squeal-remote-trial/id_ed25519
call() { # method path [json]
  if [ $# -ge 3 ]; then
    curl -sS -m 120 -X "$1" "$API$2" -H "Authorization: Bearer placeholder" -H "Content-Type: application/json" -d "$3"
  else
    curl -sS -m 120 -X "$1" "$API$2" -H "Authorization: Bearer placeholder"
  fi
}
field() { python3 -I -c 'import json,sys; d=json.load(sys.stdin)
for k in sys.argv[1].split("."): d=d.get(k) if isinstance(d,dict) else None
print("" if d is None else d)' "$1"; }
case $1 in
  create)
    call POST /sandboxes '{"type":"default","ttlSeconds":7200,"noEnv":true,"name":"squeal-021-15-trial","labels":{"purpose":"squeal-021-15"}}' > "$S/create.json"
    field sandbox.id < "$S/create.json" > "$S/id"; cat "$S/id" ;;
  get) call GET "/sandboxes/$(cat "$S/id")" | tee "$S/get.json" | field sandbox.state ;;
  stop) call POST "/sandboxes/$(cat "$S/id")/stop" | tee "$S/stop.json" | field type ;;
  resume) call POST "/sandboxes/$(cat "$S/id")/resume" '{}' | tee "$S/resume.json" | field type ;;
  usage) call GET "/sandboxes/$(cat "$S/id")/usage" | tee "$S/usage.json" ;;
  limits) call GET /limits > "$S/limits.json"; field canStart < "$S/limits.json" ;;
  sshkey)
    # Authorize the trial key and pin the host key the API gives for this start.
    id=$(cat "$S/id")
    body=$(python3 -I -c 'import json,sys; print(json.dumps({"key": open(sys.argv[1]).read().strip()}))' "$KEY.pub")
    call POST "/sandboxes/$id/sshkey" "$body" > "$S/sshkey.json"
    hostkey=$(field hostKey < "$S/sshkey.json"); ep=$(field sshEndpoint < "$S/sshkey.json")
    if [ -n "$ep" ]; then host=${ep%:*}; port=${ep##*:}; else host=$(field machineIp < "$S/sshkey.json"); port=22; fi
    [ -n "$hostkey" ] && [ -n "$host" ] || { echo "no host key or address" >&2; exit 1; }
    echo "boat-trial $hostkey" > "$S/known_hosts"
    cat > "$S/config" <<EOF
Host boat-trial
  HostName $host
  Port $port
  User user
  IdentityFile $KEY
  IdentitiesOnly yes
  IdentityAgent none
  HostKeyAlias boat-trial
  UserKnownHostsFile $S/known_hosts
  GlobalKnownHostsFile /dev/null
  StrictHostKeyChecking yes
  UpdateHostKeys no
  ConnectTimeout 15
EOF
    echo "$host:$port $(echo "$hostkey" | cut -c1-40)..." ;;
  *) echo "unknown: $1" >&2; exit 2 ;;
esac
