#!/usr/bin/env bash
# Throwaway probe (005-05, question 2b). The plugin's own CLI bundle (dist/ of this commit) packed as a
# standalone npm package and installed globally into a scratch prefix from the tarball, no registry;
# then a terminal setup through it. Usage: q2b.sh <scratch> <pin>
set -u
S=$(cd "$1" && pwd); PIN=$(cd "$2" && pwd); HERE=$(cd "$(dirname "$0")" && pwd)
unset $(env | grep -oE '^(CLAUDE|CEZ_|SQUEAL)[A-Z_]*' ) 2>/dev/null
export XDG_RUNTIME_DIR=$S/run npm_config_cache=$S/npm-cache; mkdir -p -m 0700 "$XDG_RUNTIME_DIR"
PK=$S/pkg; mkdir -p "$PK/bin"; cp -r "$PIN/v72/plugins/claude-code/dist" "$PK/dist"
printf '#!/usr/bin/env node\nimport "../dist/cli/squeal.mjs";\n' > "$PK/bin/squeal.mjs"
echo '{"name":"squeal-probe","version":"0.1.72","type":"module","bin":{"squeal":"bin/squeal.mjs"},"engines":{"node":">=22.13"}}' > "$PK/package.json"
cd "$S"; T=$(npm pack "$PK" --silent 2>/dev/null | tail -1); ls -l "$T" | awk '{print "  tarball", $5, "bytes"}'
npm install -g --prefix "$S/prefix" "./$T" --silent 2>&1 | tail -2
export PATH=$S/prefix/bin:$PATH; echo "  which: $(command -v squeal) -> $(readlink -f "$(command -v squeal)")"; echo "  version: $(squeal --version)"
F=$S/F; "$HERE/mkfix.sh" "$F" "$PIN/v72/plugins/claude-code/dist/cli/squeal.mjs"; cd "$F"
squeal start | head -1; squeal run --all --wait | grep -E "^(Checkpoint .* completed|Known)"
pgrep -af "daemon $F" | sed 's/^/  daemon: /' | cut -c1-200
squeal stop | head -1
