set -eu
# Case c: does stop_hook_active stay true on a Stop after the continued turn ran a tool?
C=/home/squeal-e2e/runs/sw19/$1
rm -rf "$C"; mkdir -p "$C/repo/.claude"; cd "$C/repo"
git init -q -b main . && git config user.email p@x && git config user.name p
echo probe > README.md
cat > "$C/hook.sh" <<SH
#!/bin/sh
in=\$(cat)
n=\$(cat "$C/count" 2>/dev/null || echo 0); n=\$((n+1)); echo \$n > "$C/count"
printf '%s stop#%s %s\n' "\$(date +%s)" "\$n" "\$in" >> "$C/hook.log"
if [ "\$n" = 1 ]; then
  printf '{"decision":"block","reason":"Run the shell command: echo probe-c > marker.txt with the Bash tool, then reply DONE."}\n'
fi
exit 0
SH
chmod +x "$C/hook.sh"
cat > .claude/settings.json <<JSON
{ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "$C/hook.sh", "timeout": 30 }] }] } }
JSON
git add -A && git commit -qm init
echo "setup $1 active"
