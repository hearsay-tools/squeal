#!/bin/sh
# Throwaway. Runs as squeal-e2e with the probe tree unpacked at $W/probe.
# Builds the scratch repository and one linked git worktree of it.
set -eu
. "$(dirname "$0")/env.sh"
rm -rf $W/repo $W/wt
mkdir -p $W/repo/.opencode/plugin $W/repo/tests
cd $W/repo
git init -q -b main
git config user.email probe@example.invalid
git config user.name probe
cp $W/probe/plugin/probe.js .opencode/plugin/probe.js
cat > opencode.json <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "cliproxy": {
      "npm": "@ai-sdk/openai",
      "name": "cliproxy",
      "options": { "baseURL": "https://cliproxy.home.jarka.pl/v1", "apiKey": "{env:CLIPROXY_API_KEY}" },
      "models": { "gpt-6-luna": { "name": "gpt-6-luna" } }
    }
  },
  "model": "cliproxy/gpt-6-luna",
  "permission": { "edit": "allow", "bash": "allow", "external_directory": "allow" },
  "share": "disabled",
  "autoupdate": false
}
EOF
echo 'export const add = (a, b) => a + b' > add.js
echo 'probe repo' > README.md
git add -A
git commit -qm init
git worktree add -q -b wt-branch $W/wt
echo "setup done: $(opencode --version)"
