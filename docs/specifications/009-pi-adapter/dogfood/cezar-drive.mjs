// A Cezar-shaped RPC session: the installed Cezar PiRunner (0.16.0-dev.1634, copied unchanged
// into dogfood-009/cezar-source, as research/probes/pi-sessions-and-packaging/cezar.mjs did)
// drives Pi in persistent mode. The scenario file lists the prompts; each is sent after the
// previous turn ends, then the session stays open `idleMs` for a wake nobody prompted, and ends
// once it has been quiet that long. Every event goes to the log with its time and load average.
// Usage: node cezar-drive.mjs <scenario.json> <events.jsonl>
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { PiRunner, buildPiArgs } from "/home/squeal-e2e/dogfood-009/cezar-source/dist/core/pi-runner.js";

if (process.getuid() !== 1002) throw new Error("must run as squeal-e2e");
const [scenarioPath, log] = process.argv.slice(2);
const sc = JSON.parse(readFileSync(scenarioPath, "utf8"));
const t0 = Date.now();
const load = () => loadavg()[0].toFixed(1);
writeFileSync(log, "");
const write = (o) => appendFileSync(log, JSON.stringify({ ms: Date.now() - t0, load: load(), ...o }) + "\n");

const spec = {
  cwd: sc.cwd,
  userPrompt: sc.prompts[0],
  model: sc.model,
  ...(sc.systemPrompt ? { systemPrompt: sc.systemPrompt } : {}),
  env: {},
};
write({ kind: "start", args: buildPiArgs(spec), scenario: sc });
const runner = new PiRunner({ bin: "/home/squeal-e2e/dogfood-009/bin/pi", timeoutMs: sc.timeoutMs ?? 1_800_000 });
let next = 1;
let turns = 0;
let quiet = null;
const session = runner.startSession(
  spec,
  (event) => {
    write({ kind: "event", event });
    if (event.type !== "turn-end") {
      if (quiet && next >= sc.prompts.length) {
        clearTimeout(quiet);
        quiet = null;
      }
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
    clearTimeout(quiet);
    quiet = setTimeout(() => {
      write({ kind: "end", turns });
      session.end();
    }, sc.idleMs ?? 120_000);
  },
  { onUiEvent: (event) => write({ kind: "ui", type: event.type }) },
);
write({ kind: "pid", pid: session.pid });
const result = await session.result;
write({ kind: "result", result });
