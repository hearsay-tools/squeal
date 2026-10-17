// Issue 31 probe: where does an edited fast test land behind broad dependent suites?
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const src = resolve(process.argv[2] ?? "src");
const { RunQueue, priorityOf, Priority } = await import(pathToFileURL(`${src}/core/scheduler/queue.ts`).href);
const { joinSpan } = await import(pathToFileURL(`${src}/core/scheduler/sharing.ts`).href);

const TIER_SIZE = 4; // runner.tierSize default
const RUN = "packages/cezar/src/workflows/run.ts";
const EDITED = "packages/cezar/src/workflows/worker-wait-durability.test.ts";
const s = (n) => n * 1000;

// files: [path, durationMs|null, directImporterOfRun, hasResult]
function scenario(name, editedMs, extra = [], running = new Set(), monitoringDirect = false) {
  const files = [
    [EDITED, editedMs, true, editedMs !== null],
    ["packages/cezar/test/harness-parity.test.ts", s(540), true, true],
    ["packages/cezar/test/monitoring-turn.test.ts", s(480), monitoringDirect, true],
    ...extra,
  ];
  const changed = new Set([RUN, EDITED]);
  const direct = new Set(files.filter((f) => f[2]).map((f) => `p\0${f[0]}`));
  const state = new Map();
  const queue = new RunQueue();
  for (const [path, ms, , hasResult] of files) {
    if (running.has(path)) continue; // in the running tier: not queued, never split (C15)
    const ref = { project: "p", path };
    const file = { ref, id: `p\0${path}`, failing: false, resultKey: hasResult ? "old" : null, durationMs: ms };
    state.set(path, file);
    // Ledger.settle: every miss here is recent (closure changed or the file itself changed).
    queue.add(ref, priorityOf(file, changed, direct), false, true);
  }
  const order = queue.ordered((ref) => state.get(ref.path).durationMs);
  // selectTier, edit tier: take in order, skip a file joinSpan refuses, at most TIER_SIZE.
  const tiers = [];
  const left = [...order];
  while (left.length) {
    const tier = [];
    let span = null;
    for (const ref of [...left]) {
      if (tier.length >= TIER_SIZE) break;
      const joined = joinSpan(span, state.get(ref.path).durationMs);
      if (joined === null) continue;
      span = joined;
      tier.push(ref);
      left.splice(left.indexOf(ref), 1);
    }
    tiers.push(tier);
  }
  const cls = Object.fromEntries(Object.entries(Priority).map(([k, v]) => [v, k]));
  console.log(`\n== ${name}`);
  order.forEach((ref, i) => {
    const f = state.get(ref.path);
    const p = priorityOf(f, changed, direct);
    console.log(`${String(i + 1).padStart(2)}. ${cls[p].padEnd(10)} ${String(f.durationMs ?? "unknown").padStart(7)} ms  ${ref.path}`);
  });
  let waitedMs = 0;
  for (const [i, tier] of tiers.entries()) {
    const longest = Math.max(...tier.map((r) => state.get(r.path).durationMs ?? 0));
    const hasEdited = tier.some((r) => r.path === EDITED);
    console.log(`  tier ${i + 1}: ${tier.map((r) => r.path.split("/").pop()).join(", ")}  (~${longest / 1000}s)${hasEdited ? "  <- edited test" : ""}`);
    if (hasEdited) break;
    waitedMs += longest;
  }
  console.log(`  edited test starts after ~${waitedMs / 1000}s of earlier tiers (serial lane, last-known durations)`);
}

const smallDirect = Array.from({ length: 12 }, (_, i) => [`packages/cezar/src/runner/r${i}.test.ts`, s(2 + i * 4), true, true]);

scenario("A: edited file has a known short duration (20 s)", s(20));
scenario("B: edited file has no stored duration (new file, or no result in the store)", null);
scenario("C: edited file is itself long (600 s, longer than harness-parity)", s(600));
scenario("D: A, plus 12 other direct importers of run.ts, 2-46 s", s(20), smallDirect);
scenario("E: B, while harness-parity's tier is already running", null, [], new Set(["packages/cezar/test/harness-parity.test.ts"]));
scenario("F: E, but monitoring-turn also imports run.ts directly (the issue's timeline)", null, [], new Set(["packages/cezar/test/harness-parity.test.ts"]), true);
scenario("G: F, but the edited file has a known 20 s duration", s(20), [], new Set(["packages/cezar/test/harness-parity.test.ts"]), true);
