// Copies the fake `claude` and `codex` scripts out of test/evals/fake-cell.ts, unchanged, into
// <dir>/bin, and puts a recording wrapper in front of `claude` that logs its argv and the
// environment variables that decide isolation, then runs the fake with its stdout teed to
// $FAKE_LOG/events.jsonl, the native stream-json our grader reads.
//   node extract-fakes.mjs <dir>
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const src = readFileSync(join(import.meta.dirname, "../../../../../../test/evals/fake-cell.ts"), "utf8");
const literal = (name) => {
  const m = src.match(new RegExp(`const ${name} = (\`[\\s\\S]*?\`);\\n`));
  const HOST = "proxy.example.invalid";
  return eval(m[1]);
};
const bin = join(dir, "bin");
mkdirSync(bin, { recursive: true });
writeFileSync(join(bin, "claude-fake"), literal("FAKE_HARNESS"), { mode: 0o755 });
writeFileSync(join(bin, "codex"), literal("FAKE_CODEX"), { mode: 0o755 });
writeFileSync(
  join(bin, "claude"),
  `#!/bin/sh
{ printf 'argv:'; for a in "$@"; do printf ' [%s]' "$a"; done; echo
  for v in HOME PWD TMPDIR CLAUDE_CONFIG_DIR ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY ANTHROPIC_MODEL CLAUDE_CODE_DISABLE_AUTO_MEMORY MCP_CONNECTION_NONBLOCKING; do eval "echo $v=\\\${$v-<unset>}"; done
} >> "$FAKE_LOG/claude-calls"
[ "$1" = "--version" ] && exec "$(dirname "$0")/claude-fake" "$@"
"$(dirname "$0")/claude-fake" "$@" | tee -a "$FAKE_LOG/events.jsonl"
`,
);
chmodSync(join(bin, "claude"), 0o755);
