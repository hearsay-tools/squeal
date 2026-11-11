import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type BasePrepares,
  type PrepareContext,
  prepareEntry,
  preparesOf,
} from "../../../src/core/code/gate/prepare.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { NodeTestPrepare, NodeTestProject } from "../../../src/core/types/policy.js";

/*
 * Spec 020 D15.2, D15.3 (row 020-16b): an entry's `prepare` runs as the
 * base declares it, once, in the entry's directory with its `env`, inside
 * the budget and its own `timeoutSeconds`. A failure or a timeout keeps the
 * entry's files from running; a declaration only at the head does not run.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch(): AbsolutePath {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-prepare-")));
  roots.push(root);
  return root as AbsolutePath;
}

const node = (script: string): NodeTestPrepare["command"] => [process.execPath, "-e", script];
const PATHS = ["test/e2e/bin.test.mjs"];

function entry(prepare?: NodeTestPrepare, more: Partial<NodeTestProject> = {}): NodeTestProject {
  return {
    name: "package",
    argv: [],
    env: {},
    include: ["test/e2e/*.test.mjs"],
    ...(prepare === undefined ? {} : { prepare }),
    ...more,
  };
}

interface Seen {
  readonly notes: string[];
  output: string;
}

function context(root: AbsolutePath, base: BasePrepares | undefined, budgetMs = 60_000) {
  const seen: Seen = { notes: [], output: "" };
  const ctx: PrepareContext = {
    root,
    deadline: performance.now() + budgetMs,
    base,
    note: (text) => seen.notes.push(text),
    output: (text) => {
      seen.output += text;
    },
  };
  return { ctx, seen };
}

const based = (prepare: NodeTestPrepare): BasePrepares => preparesOf([entry(prepare)]);

describe("prepareEntry (spec 020 D15)", () => {
  it("gives null when neither the base nor the head declares one", async () => {
    const { ctx, seen } = context(scratch(), new Map());
    expect(await prepareEntry(entry(), PATHS, ctx)).toBeNull();
    expect(seen.notes).toEqual([]);
  });

  it("runs the base's command in the entry's directory, with its env, and hands over the output", async () => {
    const root = scratch();
    mkdirSync(join(root, "pkg"));
    const command = node("console.log(process.cwd(), process.env.PREPARE_MARK)");
    // The head's own command differs: the base's runs.
    const head = entry(
      { command: node("process.exit(9)") },
      { cwd: "pkg", env: { PREPARE_MARK: "m1" } },
    );
    const { ctx, seen } = context(root, based({ command }));
    const prepared = await prepareEntry(head, PATHS, ctx);
    expect(prepared?.run).toMatchObject({
      project: "package",
      command,
      outcome: "passed",
      exit: 0,
      notRun: [],
    });
    expect(prepared?.run.durationMs).toEqual(expect.any(Number));
    expect(prepared?.budgetEnded).toBe(false);
    expect(seen.output).toBe(`${join(root, "pkg")} m1\n`);
    expect(seen.notes).toEqual([`node:test entry "package": prepare: ${command.join(" ")}`]);
  });

  it("keeps the files from running when the command fails", async () => {
    const { ctx, seen } = context(scratch(), based({ command: node("process.exit(3)") }));
    const prepared = await prepareEntry(entry(), PATHS, ctx);
    expect(prepared?.run).toMatchObject({ outcome: "failed", exit: 3, notRun: PATHS });
    expect(seen.notes[1]).toMatch(
      /^node:test entry "package": prepare exited 3 after \d+\.\d s: its 1 selected test file does not run$/,
    );
  });

  it("reads failed when the command cannot start", async () => {
    const { ctx, seen } = context(scratch(), based({ command: ["squeal-no-such-command-x9"] }));
    const prepared = await prepareEntry(entry(), PATHS, ctx);
    expect(prepared?.run).toMatchObject({ outcome: "failed", exit: null, notRun: PATHS });
    expect(seen.notes[1]).toMatch(/prepare could not start: .*ENOENT/);
  });

  it("stops the command at its own timeoutSeconds", async () => {
    const command = node("setTimeout(() => {}, 60000)");
    const { ctx, seen } = context(scratch(), based({ command, timeoutSeconds: 0.3 }));
    const started = performance.now();
    const prepared = await prepareEntry(entry(), PATHS, ctx);
    expect(performance.now() - started).toBeLessThan(20_000);
    expect(prepared).toMatchObject({
      run: { outcome: "timed-out", exit: null, notRun: PATHS },
      budgetEnded: false,
    });
    expect(seen.notes[1]).toContain("did not finish within its timeoutSeconds, 0.3");
  });

  it("stops the command at the budget's end, and names the budget", async () => {
    const command = node("setTimeout(() => {}, 60000)");
    const { ctx, seen } = context(scratch(), based({ command, timeoutSeconds: 600 }), 300);
    const prepared = await prepareEntry(entry(), PATHS, ctx);
    expect(prepared).toMatchObject({ run: { outcome: "timed-out" }, budgetEnded: true });
    expect(seen.notes[1]).toContain("did not finish within the budget");
  });

  it("does not start once the budget is spent", async () => {
    const root = scratch();
    const command = node("require('node:fs').writeFileSync('ran', '')");
    const { ctx } = context(root, based({ command }), -1);
    const prepared = await prepareEntry(entry(), PATHS, ctx);
    expect(prepared).toMatchObject({
      run: { outcome: "timed-out", durationMs: 0 },
      budgetEnded: true,
    });
    expect(existsSync(join(root, "ran"))).toBe(false);
  });

  it("kills what the command left running when it exits", async () => {
    // The child inherits the pipes and would hold them open for 60 s.
    const command = node(
      "require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'inherit' }); setTimeout(() => process.exit(0), 200)",
    );
    const { ctx } = context(scratch(), based({ command }));
    const started = performance.now();
    const prepared = await prepareEntry(entry(), PATHS, ctx);
    expect(prepared?.run.outcome).toBe("passed");
    expect(performance.now() - started).toBeLessThan(20_000);
  });

  it("does not run a declaration the base lacks, and says to land it first", async () => {
    const root = scratch();
    const command = node("require('node:fs').writeFileSync('ran', '')");
    for (const base of [undefined, new Map()]) {
      const { ctx, seen } = context(root, base);
      const prepared = await prepareEntry(entry({ command }), PATHS, ctx);
      expect(prepared).toEqual({
        run: {
          project: "package",
          command,
          outcome: "not-at-base",
          exit: null,
          durationMs: null,
          notRun: PATHS,
        },
        budgetEnded: false,
      });
      expect(seen.notes).toEqual([
        `node:test entry "package" declares a prepare command that the base does not, so it does not run and its 1 selected test file does not run. Land the declaration on the base branch first: the gate runs the base's prepare.`,
      ]);
    }
    expect(existsSync(join(root, "ran"))).toBe(false);
  });
});
