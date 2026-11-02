set -eu
C=/home/squeal-e2e/runs/sw19/$1; SLEEP=$2; TO=$3
rm -rf "$C"; mkdir -p "$C/repo/.claude"; cd "$C/repo"
git init -q -b main . && git config user.email p@x && git config user.name p
echo probe > README.md
cat > "$C/hook.sh" <<SH
#!/bin/sh
in=\$(cat)
printf '%s start %s\n' "\$(date +%s)" "\$in" >> "$C/hook.log"
case "\$in" in
  *'"stop_hook_active":true'*) printf '%s active-exit\n' "\$(date +%s)" >> "$C/hook.log"; exit 0;;
esac
sleep $SLEEP
printf '%s block\n' "\$(date +%s)" >> "$C/hook.log"
printf '{"decision":"block","reason":"Reply with the single word PINEAPPLE and nothing else."}\n'
SH
chmod +x "$C/hook.sh"
cat > .claude/settings.json <<JSON
{ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "$C/hook.sh", "timeout": $TO }] }] } }
JSON
git add -A && git commit -qm init
echo "setup $1 sleep=$SLEEP timeout=$TO"
