// A Cezar-shaped `opencode serve` session: the installed Cezar 0.16.0-dev.1634
// OpencodeServerRunner (copied unchanged into dogfood-008/cezar-source; sha256 of
// dist/core/opencode-server-runner.js 20b478af…) drives OpenCode in persistent mode, as an
// interactive Cezar step does. The scenario lists the prompts; each is sent `gapMs` after the
// previous turn-end. After the last turn-end the server stays open until nothing has happened for
// `idleMs`, so a wake nobody prompted (D5) shows up as events after the last turn-end; any event
// re-arms the quiet timer. With `autoEnd: true` the session is a non-interactive step instead:
// Cezar ends the server 250 ms after the first idle. Every event goes to the log with its time
// and the 1-minute load average.
// Usage: node cezar-drive.mjs <scenario.json> <events.jsonl>
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { OpencodeServerRunner } from "/home/squeal-e2e/dogfood-008/cezar-source/dist/core/opencode-server-runner.js";

if (process.getuid() !== 1002) throw new Error("must run as squeal-e2e");
const [scenarioPath, log] = process.argv.slice(2);
const sc = JSON.parse(readFileSync(scenarioPath, "utf8"));
const t0 = Date.now();
const load = () => loadavg()[0].toFixed(1);
writeFileSync(log, "");
const write = (o) => appendFileSync(log, JSON.stringify({ ms: Date.now() - t0, at: new Date().toISOString(), load: load(), ...o }) + "\n");

const spec = {
  cwd: sc.cwd,
  userPrompt: sc.prompts[0],
  model: sc.model,
  ...(sc.sessionId ? { sessionId: sc.sessionId, resume: true } : {}),
  // Cezar's env curation drops OPENCODE_*; these two keep OpenCode off the network for models
  // and updates, as every other dogfood run.
  env: { OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1" },
};
write({ kind: "start", scenario: sc });
const runner = new OpencodeServerRunner({ bin: "/home/squeal-e2e/dogfood-008/bin/opencode", timeoutMs: sc.timeoutMs ?? 1_800_000 });
let next = 1;
let turns = 0;
let quiet = null;
let lastSent = false;
const arm = () => {
  clearTimeout(quiet);
  quiet = setTimeout(() => {
    write({ kind: "end", turns });
    session.end();
  }, sc.idleMs ?? 120_000);
};
const session = runner.startSession(
  spec,
  (event) => {
    write({ kind: "event", event });
    if (event.type !== "turn-end") {
      if (lastSent && quiet) arm();
      return;
    }
    turns++;
    if (next < sc.prompts.length) {
      const text = sc.prompts[next++];
      setTimeout(() => {
        write({ kind: "prompt", text });
        session.sendMessage([{ type: "text", text }]);
      }, sc.gapMs ?? 1000);
      return;
    }
    lastSent = true;
    if (!sc.autoEnd) arm();
  },
  { onUiEvent: (event) => write({ kind: "ui", type: event.type }), autoEndAfterFirstTurn: Boolean(sc.autoEnd) },
);
write({ kind: "pid", pid: session.pid });
const result = await session.result;
write({ kind: "result", sessionId: result.sessionId, text: result.text.slice(-2000) });
process.exit(0); // Cezar's runner leaves a handle open after the result
