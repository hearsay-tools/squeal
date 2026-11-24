#!/bin/sh
# Throwaway (026 agent37-sandboxes). On the instance as `node`, after setup-node.sh is in
# /tmp: installs Node 26.13.0, clones Squeal (public, all tags) at a commit, installs with
# pnpm. Prints one timing line per step. Run detached: RX_BG=1 rx.sh <id> setup.sh <sha>
SHA=$1
t() { date +%s%N; }
ms() { echo $(( ($(t) - $1) / 1000000 )); }
s=$(t); sh /tmp/setup-node.sh 26.13.0 > /tmp/setup-node.log 2>&1; echo "setup-node rc $? $(ms $s) ms"
export PATH=$HOME/.local/bin:$PATH
s=$(t); git clone -q https://github.com/hearsay-tools/squeal.git ~/squeal && cd ~/squeal && git checkout -q "$SHA"; echo "clone rc $? $(ms $s) ms; tags $(git tag | wc -l); head $(git rev-parse --short HEAD)"
s=$(t); CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile > /tmp/pnpm.log 2>&1; echo "pnpm install rc $? $(ms $s) ms; node_modules $(du -sh node_modules | cut -f1); .git $(du -sh .git | cut -f1)"
echo "node $(node -v)"
echo SETUP-DONE
