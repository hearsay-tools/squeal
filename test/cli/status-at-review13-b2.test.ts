import { realpathSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { statusAtCommand } from "../../src/cli/status-at.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fixture, git, link, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { atHead, clean, RELAUNCH, run, withStore } from "./status-at-kit.js";
import { waitFor } from "./status-at-processes.js";

/*
 * Review wave-13 re-review B2 (the human, 2026-11-19, "A: repair once
 * more"): a `--run` batch stopped at the budget reports what it completed
 * from its own completion record, kept as it ran. On the re-reviewer's
 * fixtures, with the real Vitest adapter: a newer result at another key,
 * written meanwhile by a run in a linked worktree that shares the store,
 * does not change what the stopped run reports about itself; and with
 * coverage off, a completed file reads its outcome, not stored, never
 * `not run`.
 */

const TEST = ref("test/a.test.ts");
const READS = [
  'import { readFileSync } from "node:fs";',
  'import { expect, it } from "vitest";',
  'import { value } from "../src/a";',
  'const text = readFileSync(new URL("../data/a.txt", import.meta.url), "utf8").trim();',
  'it("runtime", () => expect([value, text]).toEqual([1, "a"]));',
  "",
].join("\n");

/** A global setup whose teardown marks that it began, then holds the close for 10 minutes. */
const HOLD = [
  'import { writeFileSync } from "node:fs";',
  "export default function setup() {",
  "  return () => {",
  '    if (process.env.SQUEAL_R13_HELD) writeFileSync(process.env.SQUEAL_R13_HELD, "held");',
  "    return new Promise((done) => setTimeout(done, 600_000));",
  "  };",
  "}",
  "",
].join("\n");
const HELD_CONFIG =
  'export default { test: { include: ["test/*.test.ts"], globalSetup: ["./hold.mjs"] } };\n';
const PLAIN_CONFIG = 'export default { test: { include: ["test/*.test.ts"] } };\n';

const all = (seconds: number) => ({ allMissing: true, timeoutSeconds: seconds });
type Side = {
  state: string;
  key?: string;
  origin?: { kind: string; stored?: boolean; notStored?: string };
};
const atOf = (out: string) =>
  (JSON.parse(out).files as { path: string; at: Side }[]).find((x) => x.path === TEST.path)?.at;

/** Waits until the store holds a result of the test file, at any key. */
async function storedOnce(f: Parameters<typeof withStore>[0]): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    let found = false;
    withStore(f, (store) => {
      found = store.results.newestForTestFile(TEST).length > 0;
    });
    if (found) return;
    if (Date.now() > deadline) throw new Error("the first run kept nothing in 30 s");
    await new Promise((done) => setTimeout(done, 100));
  }
}

afterEach(() => {
  delete process.env.SQUEAL_R13_HELD;
});

describe(
  "review wave-13 re-review B2: a stopped batch reports its own completion record",
  SLOW,
  () => {
    it("keeps its pass when a linked worktree's run stores a newer failure at another key", {
      timeout: 180_000,
    }, async () => {
      const held = join(process.env.TMPDIR ?? "/tmp", `r13b2-held-${process.pid}-${Date.now()}`);
      process.env.SQUEAL_R13_HELD = held;
      const f = fixture({
        "squeal.config.json": "{}\n",
        "vitest.config.mjs": HELD_CONFIG,
        "hold.mjs": HOLD,
        "src/a.ts": "export const value = 1;\n",
        "data/a.txt": "a\n",
        [TEST.path]: READS,
      });
      const a = git(f.root, "rev-parse", "HEAD").trim();
      const b = f.commit({ "data/a.txt": "b\n", "vitest.config.mjs": PLAIN_CONFIG });
      const linked = join(f.dir, "linked") as AbsolutePath;
      git(f.root, "worktree", "add", "-q", "--detach", linked, b);
      link(linked);
      const install = linkInstall().install;
      try {
        // A runs from the main worktree; its gate keeps the pass, then its close holds.
        const first = run(
          f,
          { commit: a, json: true, run: all(30) },
          // Row 023-29: the commit side only; the hold is the commit's.
          { cacheRoot: f.cacheRoot, install, workingTree: false },
        );
        await waitFor(held, 60_000);
        await storedOnce(f);
        // Meanwhile B, from the linked worktree, stores a newer failure at another key.
        delete process.env.SQUEAL_R13_HELD;
        const out: string[] = [];
        const io = {
          stdout: (t: string) => out.push(t),
          stderr: () => {},
          cwd: realpathSync(linked),
          relaunch: RELAUNCH,
        };
        await statusAtCommand({ commit: b, paths: [], json: true, run: all(60) }, io, {
          cacheRoot: f.cacheRoot,
          install,
          ...atHead({ ...f, root: realpathSync(linked) as AbsolutePath }),
        });
        const atB = atOf(out.join(""));
        expect(atB).toMatchObject({ state: "fail", origin: { kind: "run", stored: true } });

        const stopped = await first;
        const atA = atOf(stopped.out);
        expect(atA).toMatchObject({ state: "pass", origin: { kind: "run", stored: true } });
        expect(atA?.key).not.toBe(atB?.key);
        expect(JSON.parse(stopped.out).run).toMatchObject({ ran: 1, stored: 1, notRun: 0 });
        // The next lookup reads the same pass at the same key.
        const next = await run(f, { commit: a, json: true }, { cacheRoot: f.cacheRoot, install });
        expect(atOf(next.out)).toMatchObject({ state: "pass", key: atA?.key });
        // The newest result of the file in the store is B's failure.
        withStore(f, (store) => {
          const newest = store.results.newestForTestFile(TEST);
          expect(newest[0]?.key).toBe(atB?.key);
        });
      } finally {
        git(f.root, "worktree", "remove", "--force", linked);
      }
      clean(f);
    });

    it("reports a completed file's outcome, not stored, with coverage off", async () => {
      const f = fixture({
        "squeal.config.json": '{ "coverage": { "enabled": false } }\n',
        "vitest.config.mjs": HELD_CONFIG,
        "hold.mjs": HOLD,
        [TEST.path]: 'import { expect, it } from "vitest";\nit("one", () => expect(1).toBe(1));\n',
      });
      const a = git(f.root, "rev-parse", "HEAD").trim();
      const stopped = await run(
        f,
        { commit: a, json: true, run: all(20) },
        // Row 023-29: A is HEAD; the tree is made dirty, and only the commit side runs.
        { cacheRoot: f.cacheRoot, install: linkInstall().install, ...atHead(f) },
      );
      expect(atOf(stopped.out)).toMatchObject({
        state: "pass",
        origin: {
          kind: "run",
          stored: false,
          notStored: "the gate keeps a result only with coverage on",
        },
      });
      expect(JSON.parse(stopped.out).run).toMatchObject({
        ran: 1,
        stored: 0,
        notRun: 0,
        timedOut: true,
      });
      clean(f);
    });
  },
);
