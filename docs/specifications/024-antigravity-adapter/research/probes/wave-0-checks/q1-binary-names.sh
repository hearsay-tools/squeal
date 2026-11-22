#!/bin/sh
# Throwaway probe (row 024-01, Q1). Runs inside an offline container with a tmpfs HOME:
#   docker run --rm --network none -u "$(id -u):$(id -g)" -e HOME=/home/user -e SHELL=/bin/bash \
#     --tmpfs /home/user:exec,uid="$(id -u)",gid="$(id -g)" -v <release-binary>:/opt/ag/antigravity:ro \
#     -v "$PWD":/probe:ro ubuntu:24.04 sh /probe/q1-binary-names.sh
# Simulates the official installer's last two steps: copy the release binary to
# ~/.local/bin/agy, then run `agy install`. Reports which names exist afterwards and
# whether `agy` and `antigravity` expose the same `plugin` subcommands.
set -u
BIN=/opt/ag/antigravity               # read-only mount of the release binary (tarball name)
mkdir -p "$HOME/.local/bin"
cp "$BIN" "$HOME/.local/bin/agy"; chmod +x "$HOME/.local/bin/agy"
printf 'alias antigravity=agy\nalias agy=antigravity\n' > "$HOME/.bashrc"
printf '# profile\n' > "$HOME/.profile"
echo "== agy install (SHELL=$SHELL)"
"$HOME/.local/bin/agy" install </dev/null 2>&1 | head -40; echo "exit=$?"
echo "== files under HOME after install"
find "$HOME" -path "$HOME/.gemini/antigravity-cli/log" -prune -o -newer "$HOME/.profile" -print 2>/dev/null | sort
ls -la "$HOME/.local/bin"
echo "== .bashrc after"; cat "$HOME/.bashrc"
echo "== .profile after"; cat "$HOME/.profile"
echo "== help usage line by argv[0]"
"$HOME/.local/bin/agy" --help 2>&1 | head -1
"$BIN" --help 2>&1 | head -1
echo "== plugin help identical?"
"$HOME/.local/bin/agy" help plugin > /tmp/agy.txt 2>&1
"$BIN" help plugin > /tmp/ag.txt 2>&1
cmp /tmp/agy.txt /tmp/ag.txt && echo "plugin help: identical"
"$HOME/.local/bin/agy" plugin validate --help > /tmp/agyv.txt 2>&1
"$BIN" plugin validate --help > /tmp/agv.txt 2>&1
cmp /tmp/agyv.txt /tmp/agv.txt && echo "plugin validate help: identical"
sha256sum "$BIN" "$HOME/.local/bin/agy" | cut -c1-16
echo "== help diff after replacing argv[0] name"
sed 's/\bagy\b/NAME/g' /tmp/agy.txt > /tmp/a1; sed 's/\bantigravity\b/NAME/g' /tmp/ag.txt > /tmp/a2
cmp /tmp/a1 /tmp/a2 && echo "plugin help: identical modulo argv[0]"; head -1 /tmp/agy.txt
sed 's/\bagy\b/NAME/g' /tmp/agyv.txt > /tmp/b1; sed 's/\bantigravity\b/NAME/g' /tmp/agv.txt > /tmp/b2
cmp /tmp/b1 /tmp/b2 && echo "plugin validate help: identical modulo argv[0]"
for c in install uninstall; do "$HOME/.local/bin/agy" plugin $c --help 2>&1 | head -3; done
