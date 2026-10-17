#!/bin/sh
# Throwaway probe for issue 29 (spec 004). Runs the SessionStart hook of two
# Claude Code plugin bundles in a temp git repository whose policy is the
# reporter's (stop.requireSlowSuite false, requireFullSuite false, lookup-only),
# with HOME and XDG_RUNTIME_DIR in a temp directory, and prints the injected
# context (after `squeal start`, so the 2 s hook finds a daemon). Then stops any daemon it started and deletes the temp tree.
# Usage: probe.sh <plugin-root> [<plugin-root> ...]
set -eu
for plugin in "$@"; do
  tmp=$(mktemp -d /tmp/issue29-XXXXXX)
  mkdir -m 700 "$tmp/run" "$tmp/home"
  repo="$tmp/repo"
  mkdir -p "$repo/test/e2e" "$repo/test/unit"
  cat > "$repo/squeal.config.json" <<'JSON'
{
  "slow": { "include": ["test/e2e/**"] },
  "stop": { "requireSlowSuite": false, "requireFullSuite": false },
  "baseline": { "onStart": "lookup-only" }
}
JSON
  printf 'export default {};\n' > "$repo/vitest.config.ts"
  printf '{"name":"fixture","type":"module","private":true}\n' > "$repo/package.json"
  printf '# Agents\n\nDocs row.\n' > "$repo/AGENTS.md"
  printf 'import { test } from "vitest";\ntest("u", () => {});\n' > "$repo/test/unit/a.test.ts"
  printf 'import { test } from "vitest";\ntest("e", () => {});\n' > "$repo/test/e2e/b.test.ts"
  git -C "$repo" init -q && git -C "$repo" add -A && git -C "$repo" -c user.name=p -c user.email=p@p commit -qm fixture
  (cd "$repo" && HOME="$tmp/home" XDG_RUNTIME_DIR="$tmp/run" timeout 30 node "$plugin/dist/cli/squeal.mjs" start >/dev/null 2>&1) || echo "(squeal start exit $?)"
  echo "=== plugin: $plugin ($(node -p "require('$plugin/package.json').version" 2>/dev/null || echo '?'))"
  printf '{"session_id":"issue29-probe","cwd":"%s","hook_event_name":"SessionStart","source":"startup","transcript_path":"%s/t.jsonl"}' "$repo" "$tmp" \
    | (cd "$repo" && HOME="$tmp/home" XDG_RUNTIME_DIR="$tmp/run" CLAUDE_PLUGIN_ROOT="$plugin" CLAUDE_PROJECT_DIR="$repo" \
        timeout 30 node "$plugin/dist/session-start.mjs") || echo "(exit $?)"
  echo
  (cd "$repo" && HOME="$tmp/home" XDG_RUNTIME_DIR="$tmp/run" timeout 20 node "$plugin/dist/cli/squeal.mjs" stop >/dev/null 2>&1) || true
  pgrep -af "$tmp" && echo "(probe process still running; left for inspection)" || true
  rm -rf "$tmp"
done
