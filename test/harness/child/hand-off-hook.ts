// Row 011-288: one Claude Code or Codex hook run by its bundle's process wrapper
// (`runMain`, `runHookInput`), so a test can stall the hook's output after its report
// was prepared and kill it the way the harness does at its timeout. Arguments:
// `claude` or `codex`, the hook's name, a marker path. Stdin is the hook input. With
// SQUEAL_TEST_STALL=1 the hook's stdout write records its text in the marker and never
// completes; with SQUEAL_TEST_SLOW_MS=<ms> it records it and completes that much later.
// The daemon is reported alive and never spawned. The test gives it a private
// HOME and XDG_RUNTIME_DIR.
import { readFileSync, writeFileSync } from "node:fs";
import { HOOKS, type HookName } from "../../../src/harness/claude-code/index.js";
import { runMain } from "../../../src/harness/claude-code/main.js";
import { CODEX_HOOKS, type CodexHookName } from "../../../src/harness/codex/index.js";
import { runHookInput } from "../../../src/harness/codex/main.js";

const [harness, name, marker] = process.argv.slice(2);
const deps = { env: {}, ensureDaemon: async () => "alive" as const };

const slowMs = Number(process.env.SQUEAL_TEST_SLOW_MS ?? "0");
if (process.env.SQUEAL_TEST_STALL === "1" && marker !== undefined) {
  // The text reached the write, so the report was prepared; its write never reports done.
  process.stdout.write = ((text: string) => {
    writeFileSync(marker, text);
    return false;
  }) as typeof process.stdout.write;
} else if (slowMs > 0 && marker !== undefined) {
  // A normal hand-off that takes `slowMs`: the report stays held that long, then commits.
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((text: string, done: (error?: Error | null) => void) => {
    writeFileSync(marker, text);
    setTimeout(() => write(text, done), slowMs);
    return true;
  }) as typeof process.stdout.write;
}

if (harness === "claude") {
  await runMain(name ?? "", HOOKS[name as HookName], deps);
} else {
  const stdin = readFileSync(0, "utf8");
  await runHookInput(name ?? "", CODEX_HOOKS[name as CodexHookName], stdin, process.env, deps);
}
