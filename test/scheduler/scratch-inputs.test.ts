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
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher, StatCache, seedStatCache } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import {
  DEFAULT_POLICY,
  type NodeTestProject,
  type Policy,
  type Store,
} from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Lessons defect 10 (task 004-47): a test that writes scratch files into a
 * gitignored directory its declared inputs cover settles. A gitignored file
 * enters no key from a declaration, a slow file's build output included
 * (spec 004 D5 as amended 2026-10-18, task 004-81), so no run feeds its own
 * inputs: its result is stored, and no revision follows within two interval
 * passes.
 * A store a daemon from 0.1.60 to 0.1.73 wrote, which hashed such scratch
 * as a declared input, settles as a fresh one does (004-50,
 * reviews/wave-5.5.md B1).
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

/** A slow file declaring a gitignored `dist/`, beside the test's own declarations; the start runs the files. */
function policy(inputs: Record<string, string[]>, extra: Partial<Policy> = {}): Partial<Policy> {
  return {
    ...RUN_MISSING,
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

/** Persists `paths`' hashes as a predecessor's listing of gitignored declared inputs did. */
async function seedPredecessor(store: Store, root: string, paths: string[]): Promise<void> {
  const cache = new StatCache();
  await seedStatCache(cache, root, paths, { objectFormat: "sha1" });
  store.transaction(() => cache.flush(store.fileHashes, worktreeIdFor(root)));
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
    // The slow file's gitignored build is no input either (004-81).
    expect(h.scheduler.extraFiles()).not.toContain("dist/index.js");
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

  it("lists no ignored file a slow file declares, its build or scratch under a slow glob (004-81)", async () => {
    const r = repo("test/.tmp/", {});
    mkdirSync(join(r.main, "test/.tmp"));
    writeFileSync(join(r.main, "test/.tmp/out.txt"), "scratch\n");
    const store = openRepoStore(r.commonDir);
    const h = await openHarness(r.main, store, r.commonDir, {
      policy: {
        ...RUN_MISSING,
        slow: { ...DEFAULT_POLICY.slow, include: ["test/s*.test.ts"] },
        inputs: { [STRINGS]: ["dist/**", "test/.tmp/**"] },
      },
      slow: calm(),
    });
    await h.scheduler.start();
    await expect.poll(() => h.runsOf(STRINGS).length, { timeout: 60_000 }).toBe(1);
    await h.scheduler.idle();
    await twoIntervals(h);
    expect(h.scheduler.extraFiles()).not.toContain("dist/index.js");
    expect(h.scheduler.extraFiles()).not.toContain("test/.tmp/out.txt");
    expect(h.runsOf(STRINGS)).toHaveLength(1);
  });

  it.each([
    ["a fresh store", false],
    ["a store a predecessor cached the scratch file in", true],
  ])(
    "stores a fast file's run that rewrites an existing ignored scratch file, from %s",
    async (_, warm) => {
      const SCRATCH = "fixtures/.tmp/out.txt";
      const r = repo("fixtures/.tmp/", { "fixtures/data.txt": "data\n" });
      mkdirSync(join(r.main, "fixtures/.tmp"));
      writeFileSync(join(r.main, SCRATCH), "scratch\n");
      const store = openRepoStore(r.commonDir);
      if (warm) {
        await seedPredecessor(store, r.main, [SCRATCH]);
        expect(store.fileHashes.list(worktreeIdFor(r.main)).map((row) => row.path)).toContain(
          SCRATCH,
        );
      }
      const h = await openHarness(r.main, store, r.commonDir, {
        policy: policy({ [MATH]: ["fixtures/**"] }),
        slow: calm(),
      });
      // Each run of the fast file writes new bytes into the same scratch file.
      h.runner.beforeRun = (files) => {
        if (files.some((f) => f.path === MATH)) h.write(SCRATCH, `${Math.random()}\n`);
      };
      await h.scheduler.start();
      await expect.poll(() => h.runsOf(STRINGS).length, { timeout: 60_000 }).toBe(1);
      await expect.poll(() => h.keyOf(MATH) !== null && h.runsOf(MATH).length > 0).toBe(true);
      await h.scheduler.idle();
      expect(h.runsOf(MATH)).toHaveLength(1);
      const revision = h.scheduler.status().revision;

      await twoIntervals(h);
      expect(h.scheduler.status().revision).toBe(revision);
      expect(h.runsOf(MATH)).toHaveLength(1);
      expect(h.scheduler.extraFiles()).not.toContain(SCRATCH);
      expect(h.scheduler.extraFiles()).not.toContain("dist/index.js");
      expect([...h.scheduler.trackedPaths()]).not.toContain(SCRATCH);
      const states = h.sink.states().filter((s) => JSON.stringify(s.check).includes(MATH));
      expect(states.length).toBeGreaterThan(0);
      for (const state of states) expect(state.validity).toBe("current");
    },
  );

  it("tracks a dropped gitignored file again when a closure names it, rewritten while no daemon ran", async () => {
    const GEN = "test/gen.test.ts";
    const CLIENT = "src/gen/client.ts";
    // The fixture gitignores `src/gen/`; a fast file's declaration covers it.
    const r = repo("", {});
    const store = openRepoStore(r.commonDir);
    const options = { policy: policy({ [MATH]: ["src/**"] }), slow: calm() };
    const first = await openHarness(r.main, store, r.commonDir, options);
    await first.scheduler.start();
    await expect.poll(() => first.runsOf(STRINGS).length, { timeout: 60_000 }).toBe(1);
    await first.scheduler.idle();
    expect(first.scheduler.extraFiles()).toContain(CLIENT);
    await first.scheduler.close();
    await first.runner.close();

    writeFileSync(join(r.main, CLIENT), 'export const client = () => "o" + "k";\n');
    const second = await openHarness(r.main, store, r.commonDir, options);
    await second.scheduler.start();
    await expect.poll(() => second.runsOf(GEN).length, { timeout: 60_000 }).toBe(1);
    await second.scheduler.idle();
    expect(second.runner.runs.flatMap((run) => run.files.map((f) => f.path))).toEqual([GEN]);
    expect(second.scheduler.extraFiles()).toContain(CLIENT);

    // Watched again: an edit reruns the file that imports it.
    second.write(CLIENT, 'export const client = () => "ok" as string;\n');
    await second.batch(CLIENT);
    await second.scheduler.idle();
    expect(second.runsOf(GEN)).toHaveLength(2);
    expect(second.runsOf(MATH)).toHaveLength(0);
  });
});

describe("a removed project's saved closures (row 011-36)", SLOW, () => {
  it("keep no ignored build named: one daemon start stops hashing and watching it", async () => {
    const BUILD = "pkg/dist/lib.js";
    const TYPES = "pkg/dist/lib.d.ts";
    const CLIENT = "src/gen/client.ts";
    const test = [
      'import { test } from "node:test";',
      'import { lib } from "../dist/lib.js";',
      'test("imports the build", () => lib());',
      "",
    ].join("\n");
    // `dist/` is gitignored at any depth; the fixture gitignores `src/gen/` too.
    const r = repo("", { "pkg/test/lib.test.mjs": test });
    mkdirSync(join(r.main, "pkg/dist"));
    writeFileSync(join(r.main, BUILD), "export const lib = () => 1;\n");
    writeFileSync(join(r.main, TYPES), "export declare const lib: () => number;\n");
    const project: NodeTestProject = {
      name: "pkg",
      cwd: "pkg",
      node: process.execPath,
      argv: [],
      env: {},
      include: ["test/*.test.mjs"],
    };
    const store = openRepoStore(r.commonDir);
    const first = await openHarness(r.main, store, r.commonDir, {
      nodeTest: [project],
      policy: { nodeTest: [project] },
      slow: calm(),
    });
    await first.scheduler.start();
    await first.scheduler.idle();
    expect(first.scheduler.extraFiles()).toEqual(expect.arrayContaining([BUILD, CLIENT]));
    await first.scheduler.close();
    await first.runner.close();
    // As cezar's store kept them: the build's types hashed under a declaration since removed.
    await seedPredecessor(store, r.main, [TYPES]);

    // The project is removed: its test file's saved closure still names the build.
    const h = await openHarness(r.main, store, r.commonDir, { slow: calm() });
    await h.scheduler.start();
    await h.scheduler.idle();
    const revision = h.scheduler.status().revision;
    expect(h.scheduler.extraFiles()).toContain(CLIENT);
    expect(h.scheduler.extraFiles()).not.toContain(BUILD);
    expect(h.scheduler.extraFiles()).not.toContain(TYPES);
    const stored = store.fileHashes.list(worktreeIdFor(r.main)).map((row) => row.path);
    expect(stored).toContain(CLIENT);
    expect(stored).not.toContain(BUILD);
    expect(stored).not.toContain(TYPES);

    // A rebuild makes no revision: nothing hashes the build now.
    h.write(BUILD, "export const lib = () => 2;\n");
    h.write(TYPES, "export declare const lib: () => 2;\n");
    const all = [...h.scheduler.trackedPaths(), ...h.scheduler.extraFiles()];
    const paths = await statCandidates(all, createFsHasher(r.main, "sha1"));
    await h.scheduler.handleBatch({ trigger: "interval", paths });
    await h.scheduler.idle();
    expect(h.scheduler.status().revision).toBe(revision);
  });
});

describe("a predecessor's saved closure (reviews/wave-5.6.md S1)", SLOW, () => {
  it("naming dropped scratch keeps it unwatched, and no revision follows a full pass", async () => {
    const SCRATCH = "fixtures/.tmp/out.txt";
    const r = repo("fixtures/.tmp/", { "fixtures/data.txt": "data\n" });
    mkdirSync(join(r.main, "fixtures/.tmp"));
    writeFileSync(join(r.main, SCRATCH), "scratch\n");
    const store = openRepoStore(r.commonDir);
    const options = { policy: policy({ [MATH]: ["fixtures/**"] }), slow: calm() };
    const first = await openHarness(r.main, store, r.commonDir, options);
    await first.scheduler.start();
    await expect.poll(() => first.runsOf(STRINGS).length, { timeout: 60_000 }).toBe(1);
    await first.scheduler.idle();
    const ref = first.runner.runs.flatMap((run) => run.files).find((f) => f.path === MATH);
    await first.scheduler.close();
    await first.runner.close();

    // As a daemon from 0.1.60 to 0.1.73 left it: the scratch hashed, and in the saved closure.
    await seedPredecessor(store, r.main, [SCRATCH]);
    const saved = ref === undefined ? null : store.testFiles.get(ref);
    if (saved === null) throw new Error("no saved closure of the fast file");
    const closure = { ...saved.closure, paths: [...saved.closure.paths, SCRATCH].sort() };
    store.testFiles.put({ ...saved, closure });

    const h = await openHarness(r.main, store, r.commonDir, options);
    h.runner.beforeRun = (files) => {
      if (files.some((f) => f.path === MATH)) h.write(SCRATCH, `${Math.random()}\n`);
    };
    await h.scheduler.start();
    await h.scheduler.idle();
    const revision = h.scheduler.status().revision;
    const runs = h.runsOf(MATH).length;
    // A run of the fast file, or anything else, rewrites the scratch.
    h.write(SCRATCH, `${Math.random()}\n`);

    // A full pass, as the change feed's: every tracked and extra path is a candidate.
    const all = [...h.scheduler.trackedPaths(), ...h.scheduler.extraFiles()];
    const paths = await statCandidates(all, createFsHasher(r.main, "sha1"));
    await h.scheduler.handleBatch({ trigger: "interval", paths });
    await h.scheduler.idle();
    expect(h.scheduler.status().revision).toBe(revision);
    expect(h.runsOf(MATH)).toHaveLength(runs);
    expect(h.scheduler.extraFiles()).not.toContain(SCRATCH);
    expect(h.scheduler.extraFiles()).not.toContain("dist/index.js");
    expect([...h.scheduler.trackedPaths()]).not.toContain(SCRATCH);
    expect(store.fileHashes.list(worktreeIdFor(r.main)).map((row) => row.path)).not.toContain(
      SCRATCH,
    );
  });
});
