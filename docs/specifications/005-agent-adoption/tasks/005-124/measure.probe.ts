// Row 005-124 probe (throwaway, kept as evidence): one Stop hook as Claude Code runs it, on a
// worktree of 30,000 known states (300 files of 100 checks), quiet, with news and blocking; the
// wall time of `runHook("stop")` and its full states lists. Writes only under the OS temp dir.
// Not a test: run it as the only file of a Vitest run (it needs the test helpers' afterEach):
//   timeout 900 node_modules/.bin/vitest run --config docs/specifications/005-agent-adoption/tasks/005-124/vitest.probe.config.ts
import { loadavg } from "node:os";
import { expect, it, vi } from "vitest";
import { ensureWriteMarkers } from "../../../../../src/core/store/write-markers.js";
import type { ResultRecord } from "../../../../../src/core/types/store-records.js";
import { runHook } from "../../../../../src/harness/claude-code/hooks.js";
import type { HookDeps } from "../../../../../src/harness/shared/hook.js";
import { recorded, squealRepo } from "../../../../../test/harness/helpers.js";
import { check, result } from "../../../../../test/state/helpers.js";

const lists = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../../../../src/core/store/repos/states.js", async (original) => {
  const actual = await original<typeof import("../../../../../src/core/store/repos/states.js")>();
  return {
    ...actual,
    createKnownStateRepo: (...args: Parameters<typeof actual.createKnownStateRepo>) => {
      const repo = actual.createKnownStateRepo(...args);
      return {
        ...repo,
        list: (...a: Parameters<typeof repo.list>) => {
          if (a[1] === undefined) lists.count++;
          return repo.list(...a);
        },
      };
    },
  };
});

const ROUNDS = Number(process.env.ROUNDS ?? 9);
const FILES = 300;
const PER_FILE = 100;
const deps = (): HookDeps => ({ env: {}, ensureDaemon: async () => "alive" });
const fileResults = (f: number, outcome: "pass" | "fail"): ResultRecord[] =>
  Array.from({ length: PER_FILE }, (_, i) =>
    result(check(`case ${i}`, { project: "", path: `src/t${f}.test.ts` }), outcome),
  );
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

it("times three Stop kinds at 30,000 states", { timeout: 800_000 }, async () => {
  const r = squealRepo();
  ensureWriteMarkers(r.store);
  r.apply(...Array.from({ length: FILES }, (_, f) => fileResults(f, "pass")).flat());
  expect(r.store.knownStates.list(r.worktreeId).length).toBeGreaterThanOrEqual(FILES * PER_FILE);
  await runHook("session-start", recorded("session-start", r.root), deps());
  const stop = async () => {
    lists.count = 0;
    const started = performance.now();
    const out = await runHook("stop", recorded("stop", r.root), deps());
    return { ms: performance.now() - started, lists: lists.count, out: out.stdout };
  };
  const report: Record<string, { ms: number[]; lists: number[]; said: string }> = {};
  const take = (kind: string, s: Awaited<ReturnType<typeof stop>>, said: string) => {
    report[kind] ??= { ms: [], lists: [], said };
    report[kind].ms.push(s.ms);
    report[kind].lists.push(s.lists);
  };
  await stop();
  for (let i = 0; i < ROUNDS; i++) {
    const quiet = await stop();
    expect(quiet.out).toBe("");
    take("quiet", quiet, "silent");
    // News: one file of 100 checks goes to fail, then back to pass for the next round.
    r.apply(...fileResults(1 + (i % 50), "fail"));
    const news = await stop();
    expect(news.out).toContain("PASS -> FAIL");
    take("news", news, "news");
    r.apply(...fileResults(1 + (i % 50), "pass"));
    await stop();
  }
  r.apply(r.fail()); // src/math.test.ts has a current key; the 300 files have none
  r.policy({ stop: { blockOnKnownFailures: true } });
  for (let i = 0; i < ROUNDS; i++) {
    const block = await stop();
    expect(JSON.parse(block.out)).toMatchObject({ decision: "block" });
    take("block", block, "block");
  }
  const lines = Object.entries(report).map(
    ([kind, { ms, lists: l }]) =>
      `${kind}: median ${median(ms).toFixed(0)} ms (min ${Math.min(...ms).toFixed(0)}, max ${Math.max(...ms).toFixed(0)}), lists ${[...new Set(l)].join("/")}`,
  );
  console.log(`load ${loadavg().map((x) => x.toFixed(1)).join(" ")}, rounds ${ROUNDS}\n${lines.join("\n")}`);
});
