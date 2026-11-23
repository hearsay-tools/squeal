#!/bin/sh
# Throwaway (026 boat-sandboxes). Runs on the sandbox as `user`, fed on ssh's input:
#   boat ssh <id> -- sh -s 26.13.0 < setup-node.sh
# Installs Node <version> under ~/.local/node-v<version> (checksum from nodejs.org),
# links it first on the PATH a non-interactive ssh sees, enables corepack.
# Same steps as 021's probes/boat-trial/setup-remote.sh.
set -eu
V=${1:-26.13.0}
D=$HOME/.local/node-v$V
A=$(uname -m); case $A in x86_64) A=x64;; aarch64) A=arm64;; esac
F=node-v$V-linux-$A.tar.xz
if [ ! -x "$D/bin/node" ]; then
  W=$(mktemp -d); cd "$W"
  curl -fsSLO "https://nodejs.org/dist/v$V/$F"
  curl -fsSL "https://nodejs.org/dist/v$V/SHASUMS256.txt" | grep " $F\$" | sha256sum -c -
  mkdir -p "$D"; tar -xJf "$F" -C "$D" --strip-components=1
  cd /; rm -rf "$W"
fi
mkdir -p "$HOME/.local/bin"
for b in node npm npx corepack; do ln -sfn "$D/bin/$b" "$HOME/.local/bin/$b"; done
L='export PATH="$HOME/.local/bin:$PATH" # squeal-026'
grep -q 'squeal-026' "$HOME/.bashrc" 2>/dev/null || { printf '%s\n' "$L" | cat - "$HOME/.bashrc" > "$HOME/.bashrc.new" && mv "$HOME/.bashrc.new" "$HOME/.bashrc"; }
grep -q 'squeal-026' "$HOME/.profile" 2>/dev/null || printf '%s\n' "$L" >> "$HOME/.profile"
PATH=$HOME/.local/bin:$PATH
corepack enable --install-directory "$HOME/.local/bin"
echo "node $(node -v) at $(command -v node); pnpm shim at $(command -v pnpm)"
