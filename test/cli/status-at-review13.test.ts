import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { liveDaemon } from "./status-at-daemon.js";
import { clean, run, runCommit, testOf, withStore } from "./status-at-kit.js";
import { alive, gone } from "./status-at-processes.js";

/*
 * Review wave-13 (row 023-19 repair), each blocker on the reviewer's
 * fixture, on `$TMPDIR` git fixtures with the real Vitest adapter. B1: a
 * test of an earlier `--run` batch that changes a tracked source leaves
 * the later batches not the commit's, stored nowhere. B2: a stopped batch's
 * completed file is read at the key the gate grew for it. B3: a process a
 * test of an earlier batch started does not outlive its batch. B4: a file
 * only the commit's closure selects keeps its known current state. B5: a
 * source path runs only its readers.
 * Row 023-29 (review wave-18 note 3): the runs at HEAD test the commit
 * side's run alone, at its boundary (`runCommit`).
 */

const SLOWER = { timeout: 180_000 } as const;
const ON = { "squeal.config.json": "{}\n" };
const INCLUDE = {
  "vitest.config.mjs": 'export default { test: { include: ["test/*.test.ts"] } };\n',
};
const options = (f: Fixture, batchFiles?: number) => ({
  cacheRoot: f.cacheRoot,
  install: linkInstall().install,
  ...(batchFiles === undefined ? {} : { batchFiles }),
});
const all = (seconds: number) => ({ allMissing: true, timeoutSeconds: seconds });
const diff = (seconds: number) => ({ allMissing: false, timeoutSeconds: seconds });

type Side = {
  state: string;
  key?: string;
  reason?: string;
  ran?: string;
  origin?: { kind: string; stored?: boolean };
};
type JsonFile = { project: string; path: string; at: Side; now: Side };
const filesOf = (out: string) => JSON.parse(out).files as JsonFile[];
const fileOf = (out: string, path: string) => filesOf(out).find((x) => x.path === path);

/** Variables a fixture's tests read; removed after each test. */
const VARIABLES = ["SQUEAL_R13_PID", "SQUEAL_R13_MARK"] as const;
afterEach(() => {
  for (const name of VARIABLES) delete process.env[name];
});

describe("review wave-13 B1: a batch after a changed checkout is not the commit's", SLOW, () => {
  it(
    "runs z.test.ts after a.test.ts changed src/a.ts, stores nothing of it, and says why",
    SLOWER,
    async () => {
      const f = fixture({
        ...ON,
        ...INCLUDE,
        "src/a.ts": "export const value = 1;\n",
        "test/a.test.ts": [
          'import { writeFileSync } from "node:fs";',
          'import { it } from "vitest";',
          'it("changes next batch input", () => {',
          '  writeFileSync(new URL("../src/a.ts", import.meta.url), "export const value = 2;\\n");',
          "});",
          "",
        ].join("\n"),
        "test/z.test.ts": [
          'import { expect, it } from "vitest";',
          'import { value } from "../src/a";',
          'it("must fail at base", () => expect(value).toBe(2));',
          "",
        ].join("\n"),
      });
      const head = git(f.root, "rev-parse", "HEAD").trim();
      const both = await runCommit(f, { commit: head, run: all(90) }, options(f, 1));
      const value = JSON.parse(both.out);
      expect(fileOf(both.out, "test/a.test.ts")?.at).toMatchObject({
        state: "pass",
        origin: { kind: "run", stored: true },
      });
      expect(fileOf(both.out, "test/z.test.ts")?.at).toMatchObject({
        state: "not comparable",
        reason: "a test of an earlier batch changed src/a.ts",
        ran: "pass",
      });
      expect(value.run).toMatchObject({ ran: 2, stored: 1, changed: "src/a.ts", changedBy: "run" });
      clean(f);
      // The control: a.test.ts is stored now, so the next call runs z alone, in a checkout no
      // test changed: it fails at the commit, and is stored so.
      const alone = await runCommit(f, { commit: head, run: all(90) }, options(f, 1));
      expect(fileOf(alone.out, "test/z.test.ts")?.at).toMatchObject({
        state: "fail",
        origin: { kind: "run", stored: true },
      });
      expect(JSON.parse(alone.out).run).toMatchObject({
        selected: 1,
        ran: 1,
        stored: 1,
        changed: null,
      });
      clean(f);
    },
  );
});

describe("review wave-13 B2: a stopped batch is read where the gate kept it", SLOW, () => {
  it("reports the pass the gate kept at its grown key, as the next lookup reads it", async () => {
    const hold = [
      "export default function setup() {",
      "  return () => new Promise((done) => setTimeout(done, 600_000));",
      "}",
      "",
    ].join("\n");
    const f = fixture({
      ...ON,
      "vitest.config.mjs":
        'export default { test: { include: ["test/*.test.ts"], globalSetup: ["./hold.mjs"] } };\n',
      "hold.mjs": hold,
      "src/a.ts": "export const value = 1;\n",
      "data/a.txt": "a\n",
      "test/a.test.ts": [
        'import { readFileSync } from "node:fs";',
        'import { expect, it } from "vitest";',
        'import { value } from "../src/a";',
        'it("reads", () => {',
        '  const text = readFileSync(new URL("../data/a.txt", import.meta.url), "utf8");',
        '  expect([value, text]).toEqual([1, "a\\n"]);',
        "});",
        "",
      ].join("\n"),
    });
    const head = git(f.root, "rev-parse", "HEAD").trim();
    const stopped = await runCommit(f, { commit: head, run: all(20) }, options(f));
    const at = fileOf(stopped.out, "test/a.test.ts")?.at;
    expect(at).toMatchObject({ state: "pass", origin: { kind: "run", stored: true } });
    expect(JSON.parse(stopped.out).run).toMatchObject({ ran: 1, stored: 1, notRun: 0 });
    clean(f);
    // Row 023-24 (Q2): a clean HEAD without --run is refused; an untracked file makes it compare.
    writeFileSync(join(f.root, "notes.txt"), "draft\n");
    const next = await run(f, { commit: head, json: true }, options(f));
    const looked = fileOf(next.out, "test/a.test.ts")?.at;
    expect(looked).toMatchObject({ state: "pass" });
    // The key the run reported is the key the store holds it at (grown by the runtime read).
    expect(at?.key).toBe(looked?.key);
    clean(f);
  });
});

describe("review wave-13 B3: an earlier batch's processes end with it", SLOW, () => {
  it("leaves no process the first of two batches' test started", async () => {
    const out = join(process.env.TMPDIR ?? "/tmp", `r13-pid-${process.pid}-${Date.now()}`);
    process.env.SQUEAL_R13_PID = out;
    const f = fixture({
      ...ON,
      ...INCLUDE,
      "src/a.ts": "export const value = 1;\n",
      "test/a.test.ts": [
        'import { spawn } from "node:child_process";',
        'import { writeFileSync } from "node:fs";',
        'import { it } from "vitest";',
        'it("starts a process", () => {',
        '  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
        "  child.unref();",
        '  writeFileSync(process.env.SQUEAL_R13_PID ?? "", String(child.pid));',
        "});",
        "",
      ].join("\n"),
      "test/b.test.ts":
        'import { expect, it } from "vitest";\nit("one", () => expect(1).toBe(1));\n',
    });
    const head = git(f.root, "rev-parse", "HEAD").trim();
    let pid = 0;
    try {
      const ran = await runCommit(f, { commit: head, run: all(60) }, options(f, 1));
      expect(JSON.parse(ran.out).run).toMatchObject({ ran: 2, stored: 2 });
      expect(JSON.parse(ran.out).run.batches).toHaveLength(2);
      pid = Number(readFileSync(out, "utf8"));
      expect(pid).toBeGreaterThan(1);
      expect(await gone(pid, 5_000)).toBe(true);
      clean(f);
    } finally {
      if (pid > 1 && alive(pid)) process.kill(pid, "SIGKILL");
    }
  });
});

describe(
  "review wave-13 B4: a file only the commit's closure selects keeps its state now",
  SLOW,
  () => {
    /** A: a.test.ts reads src/a.ts; HEAD: it reads src/b.ts. Both export 1. */
    function moved() {
      const f = fixture({
        ...ON,
        "src/a.ts": "export const value = 1;\n",
        "src/b.ts": "export const value = 1;\n",
        "test/a.test.ts": testOf("a", 1),
      });
      const a = git(f.root, "rev-parse", "HEAD").trim();
      f.commit({ "test/a.test.ts": testOf("b", 1) });
      return { f, a };
    }

    it("reads the stored current pass with no daemon", async () => {
      const { f, a } = moved();
      const head = git(f.root, "rev-parse", "HEAD").trim();
      // HEAD's pass stored by naming the test file.
      await runCommit(f, { commit: head, paths: ["test/a.test.ts"], run: all(60) }, options(f));
      const byName = await run(f, { commit: a, paths: ["test/a.test.ts"], json: true }, options(f));
      const bySource = await run(f, { commit: a, paths: ["src/a.ts"], json: true }, options(f));
      expect(fileOf(byName.out, "test/a.test.ts")?.now).toMatchObject({ state: "pass" });
      expect(fileOf(bySource.out, "test/a.test.ts")?.now).toEqual(
        fileOf(byName.out, "test/a.test.ts")?.now,
      );
      clean(f);
    });

    it("reads the daemon's state of a file it lists", async () => {
      const { f, a } = moved();
      const TEST = ref("test/a.test.ts");
      withStore(f, (store) => {
        const id = liveDaemon(f, store, [TEST]);
        store.results.putMany([
          result({ kind: "file", project: "", testPath: TEST.path }, `daemon-${TEST.path}`, {
            worktreeId: id,
          }),
        ]);
      });
      const bySource = await run(f, { commit: a, paths: ["src/a.ts"], json: true }, options(f));
      expect(fileOf(bySource.out, TEST.path)?.now).toMatchObject({
        state: "pass",
        key: `daemon-${TEST.path}`,
      });
      expect(JSON.parse(bySource.out).now).toEqual({ kind: "daemon", revision: 2 });
      clean(f);
    });
  },
);

describe("review wave-13 B5: a source path runs only its readers", SLOW, () => {
  /** A: a.test.ts reads src/a.ts, b.test.ts reads src/b.ts and marks that it ran; HEAD changes both. */
  function disjoint(mark: string) {
    process.env.SQUEAL_R13_MARK = mark;
    const f = fixture({
      ...ON,
      ...INCLUDE,
      "src/a.ts": "export const value = 1;\n",
      "src/b.ts": "export const value = 1;\n",
      "test/a.test.ts": testOf("a", 1),
      "test/b.test.ts": [
        'import { writeFileSync } from "node:fs";',
        'import { expect, it } from "vitest";',
        'import { value } from "../src/b";',
        'it("marks", () => {',
        '  writeFileSync(process.env.SQUEAL_R13_MARK ?? "", "ran");',
        "  expect(value).toBe(1);",
        "});",
        "",
      ].join("\n"),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({
      "src/a.ts": "export const value = 1; // b\n",
      "src/b.ts": "export const value = 1; // b\n",
    });
    return { f, a };
  }

  for (const [name, runArgs] of [
    ["with --all-missing", all(60)],
    ["with the diff's selection", diff(60)],
  ] as const) {
    it(`keys every file but runs only test/a.test.ts, ${name}`, async () => {
      const mark = join(process.env.TMPDIR ?? "/tmp", `r13-mark-${process.pid}-${Date.now()}`);
      const { f, a } = disjoint(mark);
      const ran = await run(
        f,
        { commit: a, paths: ["src/a.ts"], json: true, run: runArgs },
        options(f),
      );
      expect(filesOf(ran.out).map((x) => x.path)).toEqual(["test/a.test.ts"]);
      expect(JSON.parse(ran.out).run).toMatchObject({ selected: 1, ran: 1, stored: 1 });
      expect(existsSync(mark)).toBe(false);
      clean(f);
    });
  }
});
