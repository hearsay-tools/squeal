// Runs one Claude Code hook in a plain Node process, so a test can kill it the
// way the harness does at its timeout (task 001-416). Arguments: the hook's
// name and its input as JSON. The daemon is reported alive and never spawned.
import { type HookName, runHook } from "../../../src/harness/claude-code/index.js";

const [name, input] = process.argv.slice(2);
const out = await runHook(name as HookName, JSON.parse(input ?? "{}"), {
  env: {},
  ensureDaemon: async () => "alive",
});
process.stdout.write(out.stdout);
