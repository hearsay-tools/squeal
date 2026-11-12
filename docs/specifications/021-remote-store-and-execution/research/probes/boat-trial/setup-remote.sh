#!/bin/sh
# Throwaway (row 021-15). Runs on the sandbox as `user`, fed on ssh's input:
#   ssh boat-trial sh -s <version> < setup-remote.sh
# Installs Node <version> under ~/.local/node-v<version> (checksum from nodejs.org),
# links it first on the PATH a non-interactive ssh sees, and enables corepack.
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
if [ "${2:-}" = "--only-install" ]; then "$D/bin/node" -v; exit 0; fi
mkdir -p "$HOME/.local/bin"
for b in node npm npx corepack; do ln -sfn "$D/bin/$b" "$HOME/.local/bin/$b"; done
# Non-interactive ssh runs bash's ~/.bashrc, whose top returns when not interactive:
# the PATH line goes above it.
L='export PATH="$HOME/.local/bin:$PATH" # squeal-021-15'
grep -q 'squeal-021-15' "$HOME/.bashrc" 2>/dev/null || { printf '%s\n' "$L" | cat - "$HOME/.bashrc" > "$HOME/.bashrc.new" && mv "$HOME/.bashrc.new" "$HOME/.bashrc"; }
grep -q 'squeal-021-15' "$HOME/.profile" 2>/dev/null || printf '%s\n' "$L" >> "$HOME/.profile"
PATH=$HOME/.local/bin:$PATH
corepack enable --install-directory "$HOME/.local/bin"
echo "node $(node -v) at $(command -v node); pnpm shim at $(command -v pnpm)"
