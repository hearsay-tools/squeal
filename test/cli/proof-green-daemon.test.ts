import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import { idOf } from "../../src/cli/status-at-after.js";
import { commonDirOf, resultsAt, withStores } from "../../src/core/commit/at-keys-checkout.js";
import { sideKeys } from "../../src/core/commit/at-keys-side.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fixture, git, keying, link, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { prove } from "./proof-kit.js";
import { clean, testOf } from "./status-at-kit.js";
import { inProcessCommitDaemons } from "./status-at-real-daemon.js";

/*
 * Row 023-42 (spec 023 D7.6): a proof's green side with no condition and
 * no repeat reads and runs on the commit daemon at HEAD, the commit
 * worktree `status --at` uses, kept alive here across calls: the first
 * call's green side runs there and is stored at the daemon's key, which
 * is the key the temporary checkout at HEAD gives (D2, read both ways);
 * the second reads it, with no run and no second daemon. The green side is
 * the committed HEAD whatever the working tree holds. A side under a
 * condition, or repeated, stays in the call and starts no daemon. A
 * daemon still setting up at the deadline reads `not run (budget)` with
 * the rerun line.
 */

const TEST = ref("test/a.test.ts");
const ON = { "squeal.config.json": "{}\n" };

/** Commit A holds the bug (`value` 1); HEAD fixes it and adds the test that expects 2. */
function sourceFix() {
  const f = fixture({ ...ON, "src/a.ts": "export const value = 1;\n" });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  const head = f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: testOf("a", 2) });
  return { f, a, head };
}

/** Commit daemons in this process that live across the test's calls; stopped at its end. */
function kept(install = linkInstall().install) {
  const kit = inProcessCommitDaemons({ install });
  onTestFinished(() => kit.stop());
  return kit;
}

describe("squeal proof's green side on the commit daemon (row 023-42, D7.6)", SLOW, () => {
  it("runs green there first, then reads its stored result at the temporary checkout's key", async () => {
    const { f, a, head } = sourceFix();
    const kit = kept();
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: kit.daemons,
    };

    const first = await prove(f, { files: [TEST.path], base: a, json: false }, options);
    expect(first.code, first.why).toBe(0);
    expect(first.err).toContain(`the green side on the commit daemon at ${head.slice(0, 9)}`);
    expect(first.out).toMatch(/green: pass, run by this command, stored/);
    expect(kit.started).toHaveLength(1);
    const tree = kit.started[0] as AbsolutePath;

    // D2: the daemon's key is the temporary checkout's, and each reads the same stored pass.
    const daemonKey = await withStores(commonDirOf(f.root), async (main) => {
      const [row] = main?.testFileKeys.list(idOf(tree), [TEST]) ?? [];
      const stored = main === null || !row?.key ? [] : resultsAt(main, TEST, row.key);
      expect(stored.map((r) => [r.outcome, r.provenance.worktreeId])).toContainEqual([
        "pass",
        idOf(tree),
      ]);
      return row?.key ?? null;
    });
    const checkout = await sideKeys({
      ...keying(f),
      root: f.root,
      code: head,
      tests: head,
      files: [TEST],
    });
    const at = [...checkout.values()][0];
    expect(at !== undefined && "key" in at ? at.key : at).toBe(daemonKey);
    expect(at !== undefined && "key" in at ? at.stored.map((r) => r.outcome) : []).toContain(
      "pass",
    );

    // The second call reads it there: no run on either side, the same daemon.
    const second = await prove(f, { files: [TEST.path], base: a }, options);
    expect(second.code, second.why).toBe(0);
    expect(second.files[0]).toMatchObject({
      verdict: "proven",
      red: { end: "fail", from: "store" },
      green: { end: "pass", from: "store", runs: 0 },
    });
    expect(second.report.runs).toBe(0);
    expect(kit.started).toEqual([tree]);
    await kit.stop();
    clean(f);
  });

  it("proves the committed HEAD when the working tree changes the code the test loads", async () => {
    const { f, a, head } = sourceFix();
    writeFileSync(join(f.root, "src/a.ts"), "export const value = 5;\n");
    const kit = kept();
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: kit.daemons,
    };
    const result = await prove(f, { files: [TEST.path], base: a }, options);
    expect(result.code, result.why).toBe(0);
    expect(result.report.dirty).toEqual(["src/a.ts"]);
    expect(result.files[0]).toMatchObject({
      verdict: "proven",
      green: { end: "pass", from: "run" },
    });
    const tree = kit.started[0] as AbsolutePath;
    expect(readFileSync(join(tree, "src/a.ts"), "utf8")).toBe(
      git(f.root, "show", `${head}:src/a.ts`),
    );
    await kit.stop();
    clean(f);
  });

  it.each([
    ["an --env condition", { env: [{ name: "PROOF_MODE", value: null }] }],
    ["--repeat 2", { repeat: 2 }],
  ])("keeps the green side in the call under %s: no commit daemon", async (_, more) => {
    const { f, a } = sourceFix();
    const kit = kept();
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: kit.daemons,
    };
    const result = await prove(f, { files: [TEST.path], base: a, ...more }, options);
    expect(result.code, result.why).toBe(0);
    expect(result.files[0]?.green).toMatchObject({ end: "pass", from: "run", stored: false });
    expect(kit.started).toEqual([]);
    clean(f);
  });

  it("reads not run (budget), with the rerun line, while the commit daemon still installs", async () => {
    const { f, a } = sourceFix();
    const barrier = join(realpathSync(mkdtempSync(join(tmpdir(), "sq-held-"))), "release");
    const held = async (tree: AbsolutePath) => {
      while (!existsSync(barrier)) await sleep(100);
      link(tree);
      return { ok: true as const, command: "held", ms: 0 };
    };
    // The install is released before the daemon stops, so its stop does not wait on it.
    const kit = inProcessCommitDaemons({ install: held });
    onTestFinished(async () => {
      writeFileSync(barrier, "");
      await kit.stop();
      rmSync(dirname(barrier), { recursive: true, force: true });
    });
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: kit.daemons,
    };
    const started = Date.now();
    const result = await prove(f, { files: [TEST.path], base: a, timeoutSeconds: 6 }, options);
    expect(Date.now() - started).toBeLessThan(6_000 + 4_000);
    expect(result.code, result.why).toBe(3);
    expect(result.files[0]).toMatchObject({ verdict: "not comparable", reason: "budget" });
    expect(result.report.notRun).toBe(1);
    expect(result.report.rerun).toContain("--timeout 60");
  });
});
