import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type NodeTestProject, type Policy } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Lessons defect 10 (task 004-47): a test that writes scratch files into a
 * gitignored directory its declared inputs cover settles. Gitignored files
 * enter keys only as a slow file's declared artifact (spec 004 D5), never
 * under a directory a slow glob covers (D6), so no run feeds its own inputs:
 * its result is stored, and no revision follows within two interval passes.
 */

const STRINGS = "test/strings.test.ts";
const MATH = "test/math.test.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A slow file whose artifact is a gitignored `dist/`, beside the test's own declarations. */
function policy(inputs: Record<string, string[]>, extra: Partial<Policy> = {}): Partial<Policy> {
  return {
    slow: { ...DEFAULT_POLICY.slow, include: [STRINGS] },
    inputs: { [STRINGS]: ["dist/**"], ...inputs },
    ...extra,
  };
}

const calm = () => ({
  slotDir: scratch("squeal-004-47-slot-"),
  recheckMs: 50,
  load: () => [0],
  cpus: () => 1,
});

/** The `basic` fixture with `dist/` and `ignore` gitignored, committed so, and a build in `dist/`. */
function repo(ignore: string, tracked: Record<string, string>) {
  const r = createRepo();
  appendFileSync(join(r.main, ".gitignore"), `dist/\n${ignore}\n`);
  for (const [path, text] of Object.entries(tracked)) {
    mkdirSync(join(r.main, path, ".."), { recursive: true });
    writeFileSync(join(r.main, path), text);
  }
  git(r.main, ["add", "-A"]);
  git(r.main, ["commit", "-qm", "scratch"]);
  mkdirSync(join(r.main, "dist"));
  writeFileSync(join(r.main, "dist/index.js"), "export const build = 'a';\n");
  return r;
}

/** Two interval passes, as the daemon's every 30 s, each followed by the work it made. */
async function twoIntervals(h: Harness): Promise<void> {
  for (let pass = 0; pass < 2; pass += 1) {
    await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await h.scheduler.idle();
  }
}

describe("a test writing scratch files under its declared inputs (lessons defect 10)", SLOW, () => {
  it("stores a fast Vitest file's run that makes and deletes ignored files there, and no revision follows", async () => {
    const r = repo("scratch/.tmp/", { "scratch/data.txt": "data\n" });
    const store = openRepoStore(r.commonDir);
    const h = await openHarness(r.main, store, r.commonDir, {
      policy: policy({ [MATH]: ["scratch/**"] }),
      slow: calm(),
    });
    // Each run of the file makes a scratch directory and deletes the one before.
    let previous: string | null = null;
    h.runner.beforeRun = (files) => {
      if (!files.some((f) => f.path === MATH)) return;
      if (previous !== null) rmSync(join(r.main, previous), { recursive: true, force: true });
      previous = `scratch/.tmp/${Math.random().toString(36).slice(2)}`;
      h.write(`${previous}/out.txt`, "scratch\n");
    };
    await h.scheduler.start();
    await expect.poll(() => h.runsOf(STRINGS).length, { timeout: 60_000 }).toBe(1);
    await h.scheduler.idle();
    expect(h.runsOf(MATH)).toHaveLength(1);
    const revision = h.scheduler.status().revision;
    const key = h.keyOf(MATH);

    await twoIntervals(h);
    expect(h.scheduler.status().revision).toBe(revision);
    expect(h.runsOf(MATH)).toHaveLength(1);
    expect(h.keyOf(MATH)).toBe(key);
    expect(h.scheduler.extraFiles().filter((p) => p.startsWith("scratch/"))).toEqual([]);
    // The slow file's artifact is still keyed by its gitignored build.
    expect(h.scheduler.extraFiles()).toContain("dist/index.js");
    const states = h.sink.states().filter((s) => JSON.stringify(s.check).includes(MATH));
    expect(states.length).toBeGreaterThan(0);
    for (const state of states) expect(state.validity).toBe("current");
  });

  it("stores a node:test file's run that leaves an ignored .tmp directory in its fixtures, and no revision follows", async () => {
    const markers = scratch("squeal-004-47-markers-");
    const runs = join(markers, "runs");
    // As test/runners/node-test: a scratch directory per run under the fixtures it declares.
    const test = [
      'import { mkdirSync, readdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";',
      'import { randomUUID } from "node:crypto";',
      'import { join } from "node:path";',
      'import { test } from "node:test";',
      'const tmp = join(import.meta.dirname, "../fixtures/.tmp");',
      'test("writes scratch", () => {',
      `  appendFileSync(${JSON.stringify(runs)}, "x");`,
      "  mkdirSync(tmp, { recursive: true });",
      "  for (const old of readdirSync(tmp)) rmSync(join(tmp, old), { recursive: true, force: true });",
      "  mkdirSync(join(tmp, randomUUID()));",
      '  writeFileSync(join(tmp, randomUUID() + ".txt"), "scratch\\n");',
      "});",
      "",
    ].join("\n");
    const r = repo("nt/fixtures/.tmp/", {
      "nt/test/scratch.test.mjs": test,
      "nt/fixtures/data.txt": "data\n",
    });
    const project: NodeTestProject = {
      name: "nt",
      cwd: "nt",
      node: process.execPath,
      argv: [],
      env: {},
      include: ["test/*.test.mjs"],
    };
    const store = openRepoStore(r.commonDir);
    const h = await openHarness(r.main, store, r.commonDir, {
      nodeTest: [project],
      policy: policy({ "nt/test/**": ["nt/fixtures/**"] }, { nodeTest: [project] }),
      slow: calm(),
    });
    const ran = () => {
      try {
        return readFileSync(runs, "utf8").length;
      } catch {
        return 0;
      }
    };
    await h.scheduler.start();
    await expect.poll(ran, { timeout: 60_000 }).toBe(1);
    await expect.poll(() => h.runsOf(STRINGS).length, { timeout: 60_000 }).toBe(1);
    await h.scheduler.idle();
    const revision = h.scheduler.status().revision;

    await twoIntervals(h);
    expect(h.scheduler.status().revision).toBe(revision);
    expect(ran()).toBe(1);
    expect(h.scheduler.extraFiles().filter((p) => p.startsWith("nt/"))).toEqual([]);
    const states = h.sink.states().filter((s) => JSON.stringify(s.check).includes("scratch.test"));
    expect(states.length).toBeGreaterThan(0);
    for (const state of states) expect(state.validity).toBe("current");
  });

  it("lists no ignored file under a directory a slow glob covers, even in a slow file's declared inputs (D6)", async () => {
    const r = repo("test/.tmp/", {});
    mkdirSync(join(r.main, "test/.tmp"));
    writeFileSync(join(r.main, "test/.tmp/out.txt"), "scratch\n");
    const store = openRepoStore(r.commonDir);
    const h = await openHarness(r.main, store, r.commonDir, {
      policy: {
        slow: { ...DEFAULT_POLICY.slow, include: ["test/s*.test.ts"] },
        inputs: { [STRINGS]: ["dist/**", "test/.tmp/**"] },
      },
      slow: calm(),
    });
    await h.scheduler.start();
    await expect.poll(() => h.runsOf(STRINGS).length, { timeout: 60_000 }).toBe(1);
    await h.scheduler.idle();
    await twoIntervals(h);
    expect(h.scheduler.extraFiles()).toContain("dist/index.js");
    expect(h.scheduler.extraFiles()).not.toContain("test/.tmp/out.txt");
    expect(h.runsOf(STRINGS)).toHaveLength(1);
  });
});
