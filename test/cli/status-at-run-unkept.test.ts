import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunAnswer } from "../../src/cli/status-at-run-child.js";
import { type DaemonPorts, runNow } from "../../src/cli/status-at-run-now.js";
import { unkeptNow } from "../../src/cli/status-at-run-unkept.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { clean, RELAUNCH, run } from "./status-at-kit.js";

/*
 * Row 023-34 (T4, lessons round 5; spec 023 D4.11): a selected file the
 * gate runs on both sides and keeps on neither (it reads a path first seen
 * during the run, as round 5's two lint files did) is compared from this
 * call's runs, marked "(this run, not stored)", and stored on neither side.
 * Before the row its working-tree side read "no result", so it was unknown.
 */

const TEST = ref("test/a.test.ts");

/**
 * Reads a path of a new name in each run, which no commit holds: a path
 * first seen during every run, so the gate keeps it on neither side.
 */
const reading = (value: number) =>
  [
    'import { readFileSync } from "node:fs";',
    'import { expect, it } from "vitest";',
    'import { value } from "../src/a";',
    "let manifest = null;",
    'const name = "../src/m-" + process.pid + "-" + Date.now() + ".json";',
    'try { manifest = readFileSync(new URL(name, import.meta.url), "utf8"); } catch {}',
    `it("value", () => { expect(manifest).toBeNull(); expect(value).toBe(${value}); });`,
    "",
  ].join("\n");

function unkeptFix() {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 1;\n",
    [TEST.path]: reading(1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: reading(2) });
  return { f, a, options: { cacheRoot: f.cacheRoot, install: linkInstall().install } };
}

describe("a file kept on neither side compares from this run (row 023-34, T4)", SLOW, () => {
  it("reads pass -> pass (this run, not stored), stores nothing, and JSON says so", async () => {
    const { f, a, options } = unkeptFix();
    const runArgs = { allMissing: false, timeoutSeconds: 600 };
    const text = await run(f, { commit: a, run: runArgs }, options);
    expect(text.out, text.err).toContain("test/a.test.ts: pass -> pass (this run, not stored)");
    expect(text.out).toContain("0 pass -> fail, 0 fail -> pass, 1 unchanged, 0 unknown");
    expect(text.code).toBe(0);
    clean(f);

    // Never stored: the next call without `--run` has no result on either side.
    const after = await run(f, { commit: a, json: true }, options);
    const read = JSON.parse(after.out);
    expect(read.files[0]).toMatchObject({
      at: { state: "no result" },
      now: { state: "no result" },
    });

    const json = await run(f, { commit: a, json: true, run: runArgs }, options);
    const report = JSON.parse(json.out);
    expect(report.files[0]).toMatchObject({
      change: "unchanged",
      at: { state: "pass", origin: { kind: "run", stored: false } },
      now: { state: "pass", origin: { kind: "run", stored: false } },
    });
    expect(report.files[0].now.origin.notStored).toContain("first seen during the run");
    clean(f);
  });
});

describe("the working tree's unkept files go through the gate, not the daemon (T4)", SLOW, () => {
  it("asks the daemon for the rest only and reads this run's outcome for the unkept one", async () => {
    const OTHER = ref("test/b.test.ts");
    const f = fixture({
      "squeal.config.json": "{}\n",
      "src/a.ts": "export const value = 1;\n",
      [TEST.path]: reading(1),
      [OTHER.path]: reading(1),
    });
    const asked: string[][] = [];
    const ports: DaemonPorts = {
      ask: async (_group, paths) => {
        asked.push([...paths]);
        return { coveredId: null };
      },
      wait: async () => null,
    };
    const end = await runNow({
      root: f.root,
      commonDir: join(f.root, ".git") as AbsolutePath,
      files: [TEST, OTHER],
      daemon: true,
      endMs: performance.now() + 120_000,
      timeoutSeconds: 120,
      env: { ...process.env },
      relaunch: RELAUNCH,
      forward: () => {},
      ports,
      alone: new Set([testFileId(TEST)]),
      keyOf: () => "k-now",
    });
    expect(asked).toEqual([[OTHER.path]]);
    expect(end.how).toBe("daemon");
    expect(end.states.get(testFileId(TEST))).toMatchObject({
      state: "pass",
      key: "k-now",
      origin: { kind: "run", stored: false },
    });
    expect(end.states.has(testFileId(OTHER))).toBe(false);
  });
});

describe("unkeptNow reads only what this call ran (review wave-20 N1)", () => {
  it("gives a stored or parts answer no this-run state", () => {
    const root = mkdtempSync(join(tmpdir(), "squeal-n1-")) as AbsolutePath;
    try {
      const answer = (from: "run" | "store" | "parts") =>
        ({
          result: {
            runs: [
              {
                runner: "vitest",
                path: TEST.path,
                outcome: "passed",
                from,
                failed: [],
                skipped: false,
              },
            ],
            timedOut: false,
            budgetSeconds: 60,
            notKept: [{ path: TEST.path, reason: "it read paths first seen during the run" }],
            kept: [],
          },
        }) as RunAnswer;
      const keyOf = () => "k-now";
      expect(unkeptNow(root, [TEST], answer("parts"), keyOf).size).toBe(0);
      expect(unkeptNow(root, [TEST], answer("store"), keyOf).size).toBe(0);
      expect(unkeptNow(root, [TEST], answer("run"), keyOf).get(testFileId(TEST))).toMatchObject({
        state: "pass",
        origin: { kind: "run", stored: false },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
