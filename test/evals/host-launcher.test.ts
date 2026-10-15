import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  atomicMarkdown,
  atomicTrend,
  brokenCondition,
  cellRecord,
  HOST_LAUNCHER_FROM,
  type Json,
} from "../../evals/lib/index.mjs";

// 006-62, finding 3: from 2026-10-14 15:47Z the host's terminal launcher came first on a cell's
// PATH, and a Claude cell's bare `squeal` found no plugin. Claude cells of runs from
// HOST_LAUNCHER_FROM that do not record the pinned plugin's `squeal` are a broken condition, as
// the old root's are: marked, and counted by no flag or scoreboard. Codex cells stay in.

const RESULTS = join(import.meta.dirname, "../../evals/results");
const HAIKU = "claude claude-haiku-5-5";
const LUNA = "codex gpt-6-luna";
const of = (k: number, n = 10) => Array.from({ length: n }, (_, i) => i < k);

/** One atomic run of `version` on a2-slow: ten Haiku and ten luna cells, `met` each. */
function run(version: string, id: string, met: boolean[], extra: Record<string, Json> = {}) {
  const cells = (["claude", "codex"] as const).flatMap((harness) =>
    met.map((m, i) => ({
      id: `a2-slow.p0.${harness === "claude" ? "claude-claude-haiku-5-5" : "codex-gpt-6-luna"}.e-medium.r${i + 1}`,
      task: "a2-slow",
      harness,
      model: harness === "claude" ? "claude-haiku-5-5" : "gpt-6-luna",
      rep: i + 1,
      claim: "fail",
      truthPass: false,
      forbiddenEdit: false,
      atomic: { measures: { "claim-true": m } },
      ...extra,
    })),
  );
  return {
    name: `2026-10-14-${version}.${id}.atomic`,
    data: {
      kind: "atomic",
      date:
        id.slice(0, 4) === "2026" ? `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}` : "",
      run: id,
      squealVersion: version,
      commit: "c00435c9e2baa51418f054c9990f2eae8dba6b1a",
      conditions: { tasks: { "a2-slow": { prompt: "6c2684281064", knobs: {} } } },
      scenarios: { "a2-slow": { turns: 1, measures: ["claim-true"], breaks: [] } },
      cells,
    } as Json,
  };
}

describe("the host launcher's broken condition", () => {
  const before = run("0.1.168", "20261014T131649Z-746295", of(10));
  const broken = run("0.1.179", "20261014T212723Z-dd4056", of(0));
  const fixed = run("0.1.190", "20261016T080000Z-aaaaaa", of(10), { squealPath: "pinned" });

  it("marks Claude cells from HOST_LAUNCHER_FROM without the pinned squeal; Codex cells stay in", () => {
    expect(HOST_LAUNCHER_FROM).toBe("20261014T154710Z");
    const t = atomicTrend([before, broken, fixed]);
    const group = (model: string) => t.groups.find((g) => g.model === model);
    expect(group(HAIKU)?.runs.map((r) => r.broken)).toEqual([null, "host launcher", null]);
    expect(group(LUNA)?.runs.map((r) => r.broken)).toEqual([null, null, null]);
    // 10 of 10 to 0 of 10 flags luna only; Haiku's broken run is counted by no flag.
    expect(group(HAIKU)?.runs.flatMap((r) => r.flags)).toEqual([]);
    expect(group(LUNA)?.runs[1]?.flags.map((f) => f.measure)).toEqual(["claim-true"]);
    const board = t.scoreboard.filter((s) => s.measure === "claim-true");
    expect(board.map((s) => [s.model, s.rate])).toEqual([
      [HAIKU, { k: 20, n: 20 }],
      [LUNA, { k: 20, n: 30 }],
    ]);
    const md = atomicMarkdown([before, broken, fixed]);
    expect(md).toContain(
      "| Measure | 20261014T131649Z-746295 (0.1.168) | 20261014T212723Z-dd4056 (0.1.179) (host launcher) | 20261016T080000Z-aaaaaa (0.1.190) |",
    );
    expect(md.match(/\(host launcher\) \|/g)).toHaveLength(1);
  });

  it("keeps the old root's mark before it, and none for a run that records the pinned squeal", () => {
    const claude = (squealPath?: string) => [
      { harness: "claude", ...(squealPath && { squealPath }) },
    ];
    expect(brokenCondition("20261012T070705Z-6eec71", claude())).toBe("old root");
    expect(brokenCondition("20261014T131649Z-746295", claude())).toBeNull();
    expect(brokenCondition("20261014T154710Z-000000", claude())).toBe("host launcher");
    expect(brokenCondition("20261015T071439Z-65314d", claude("pinned"))).toBeNull();
    expect(brokenCondition("20261015T071439Z-65314d", [{ harness: "codex" }])).toBeNull();
  });

  it("is what a new cell's record carries once its bare squeal is the pin's", () => {
    const g = { id: "x", task: "a2-slow", harness: "claude", squealPath: "pinned" };
    expect(cellRecord(g as never).squealPath).toBe("pinned");
    expect(cellRecord({ ...g, squealPath: undefined } as never)).not.toHaveProperty("squealPath");
  });

  it("marks the committed runs' Claude cells from 2026-10-14 15:47Z, never their Codex cells", () => {
    const runs = readdirSync(RESULTS)
      .filter((f) => f.endsWith(".atomic.json"))
      .map((f) => ({
        name: f.replace(/\.json$/, ""),
        data: JSON.parse(readFileSync(join(RESULTS, f), "utf8")) as Json,
      }));
    const marked = new Set<string>();
    for (const g of atomicTrend(runs).groups)
      for (const r of g.runs)
        if (r.broken === "host launcher") {
          expect(g.model.startsWith("claude ")).toBe(true);
          marked.add(r.run);
        }
    for (const id of [
      "20261014T164503Z-b3bbc5",
      "20261014T212723Z-dd4056",
      "20261015T071439Z-65314d",
    ])
      expect(marked).toContain(id);
    expect([...marked].every((id) => id >= HOST_LAUNCHER_FROM)).toBe(true);
  });
});
