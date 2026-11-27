#!/usr/bin/env bash
# Throwaway probe, row 011-435. Runs ON a boat.dev sandbox (user `user`), never on the host.
# Installs what the Node 22 CI job installs (.github/workflows/ci.yml, job node22): Node 22.19.0,
# pnpm at package.json's packageManager, uv 0.12.2 with Python 3.10 and 3.13, then the repository
# from a git bundle (HEAD plus the squeal--v* tags shard 1 reads) and `pnpm install --frozen-lockfile`.
# Usage: setup.sh <commit>
set -euo pipefail
COMMIT=$1
cd /home/user
NODE=node-v22.19.0-linux-x64
[ -d $NODE ] || curl -fsSL https://nodejs.org/dist/v22.19.0/$NODE.tar.xz | tar xJ
export PATH=/home/user/$NODE/bin:/home/user/.local/bin:$PATH
npm install -g pnpm@12.15.0 >/dev/null
curl -LsSf https://astral.sh/uv/0.12.2/install.sh | UV_NO_MODIFY_PATH=1 sh >/dev/null
uv python install 3.10 3.13
[ -d squeal ] || git clone -q push/repo.bundle squeal
cd squeal
git checkout -q -B main "$COMMIT"
pnpm install --frozen-lockfile >/dev/null
echo "node $(node -v), pnpm $(pnpm -v), $(uv --version), at $(git rev-parse --short HEAD), $(git tag -l 'squeal--v*' | wc -l) release tags"
