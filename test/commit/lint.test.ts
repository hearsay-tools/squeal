import { describe, expect, it } from "vitest";
import {
  type CommitSide,
  type LintView,
  lintCounts,
  readLintCounts,
} from "../../src/core/commit/lint.js";
import { committedBlobs } from "../../src/core/commit/tree.js";
import { holdsBlob, type KeyInputs } from "../../src/core/lint/pass/keys.js";
import {
  inputsKey,
  lintScope,
  readInputs,
  writeCursor,
  writeInputs,
  writeProgram,
} from "../../src/core/lint/pass/records.js";
import type { LintKnownState } from "../../src/core/types/lint.js";
import { check, commonDir, finding, LINT_ON, open } from "../lint/helpers.js";
import { FakeProvider, lintPass, lintTree, outcomes, storeOf } from "../lint/pass/helpers.js";

/*
 * Rows 019-13 slice 2 and 019-21 (spec 019 D5 step 2, review 0.1.396 B2):
 * lint checks in a commit's report, file-local only. A check counts when it
 * is judged, not stale and not `unknown`, at the committed blob of its file,
 * and the config its tool's keys were made of is the committed config; a
 * whole-program check counts only while no file whose bytes its keys hold
 * differs between the commit and the working tree. Row 019-28: only the
 * checks of the files the commit changed count.
 */

const W = "w1";
const CONFIG = "eslint.config.js";

function state(
  path: string,
  outcome: LintKnownState["outcome"],
  overrides: Partial<LintKnownState> = {},
  blob = `blob-${path}`,
): LintKnownState {
  const judged = {
    key: `key-${path}`,
    outcome: outcome === "pass" ? ("pass" as const) : ("fail" as const),
    fingerprint: null,
    blob,
    revision: 1,
  };
  return {
    worktreeId: W,
    check: check(path),
    outcome,
    judged: outcome === "unknown" ? null : judged,
    stale: false,
    reason: null,
    changedAt: 1,
    ...overrides,
  };
}

/** The inputs the keys were made of: the config at its committed blob unless given. */
const made = (blob: string | null = `blob-${CONFIG}`, installed = false): KeyInputs => ({
  files: [[CONFIG, blob]],
  installed,
});

const view = (
  states: readonly LintKnownState[],
  whole: readonly string[] = [],
  findings: Record<string, number | null> = {},
  inputs: KeyInputs | null = made(),
): LintView => ({
  states,
  wholeProgram: (s) => whole.includes(s.check.path),
  segmentHolds: (_, path) => holdsBlob(path, new Set([".vue"])),
  findings: (s) => (s.check.path in findings ? (findings[s.check.path] ?? null) : 1),
  inputs: () => inputs,
});

const committedOf = (...paths: string[]) =>
  new Map([CONFIG, ...paths].map((p) => [p, `blob-${p}`]));

/** The commit's side; `changed` defaults to every committed file, as a first report has it. */
const side = (
  committed: ReadonlyMap<string, string>,
  differing: readonly string[] = [],
  environment = false,
  changed: readonly string[] = [...committed.keys()],
): CommitSide => ({
  committed,
  differing: new Set(differing),
  environment,
  changed: new Set(changed),
});

describe("lintCounts (019-13 slice 2, 019-21)", () => {
  it("counts the findings of failures at the committed blob; a pass adds none", () => {
    const v = view(
      [state("src/a.ts", "fail"), state("src/b.ts", "fail"), state("src/c.ts", "pass")],
      [],
      {
        "src/a.ts": 2,
        "src/b.ts": 3,
      },
    );
    expect(lintCounts(v, side(committedOf("src/a.ts", "src/b.ts", "src/c.ts")))).toEqual({
      findings: 5,
      notDetermined: 0,
      running: 0,
    });
  });

  it("not determined: another blob, stale, unknown, or findings not stored", () => {
    const v = view(
      [
        state("src/a.ts", "fail", {}, "blob-worktree"),
        state("src/b.ts", "fail", { stale: true }),
        state("src/c.ts", "unknown"),
        state("src/d.ts", "fail"),
        state("src/e.ts", "fail"),
      ],
      [],
      { "src/d.ts": null },
    );
    const committed = committedOf("src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts");
    expect(lintCounts(v, side(committed, ["src/a.ts"]))).toEqual({
      findings: 1,
      notDetermined: 4,
      running: 0,
    });
  });

  it("pending at a file that does not differ is running; at one that differs, not determined", () => {
    const v = view([state("src/a.ts", "pending"), state("src/b.ts", "pending")]);
    expect(lintCounts(v, side(committedOf("src/a.ts", "src/b.ts"), ["src/b.ts"]))).toEqual({
      findings: 0,
      notDetermined: 1,
      running: 1,
    });
  });

  it("a whole-program check counts while nothing differs, and is not determined once a file its keys hold the bytes of does", () => {
    const v = view([state("src/a.ts", "fail"), state("src/b.ts", "fail")], ["src/a.ts"]);
    const committed = committedOf("src/a.ts", "src/b.ts");
    expect(lintCounts(v, side(committed))).toEqual({
      findings: 2,
      notDetermined: 0,
      running: 0,
    });
    const notDetermined = { findings: 1, notDetermined: 1, running: 0 };
    for (const path of ["src/other.ts", "data.json", "src/view.vue"]) {
      expect(lintCounts(v, side(committed, [path])), path).toEqual(notDetermined);
    }
  });

  it("an untracked or unstaged file whose bytes no key holds makes nothing not determined (019-28, P4)", () => {
    const v = view([state("src/a.ts", "fail"), state("src/b.ts", "fail")], ["src/a.ts"]);
    const committed = committedOf("src/a.ts", "src/b.ts", "README.md");
    expect(lintCounts(v, side(committed, ["notes.md", "README.md", "run.log"]))).toEqual(
      lintCounts(v, side(committed)),
    );
  });

  it("only the checks of the files the commit changed and holds count (019-28, P4)", () => {
    const v = view([
      state("src/a.ts", "fail"),
      state("src/b.ts", "pending"),
      state("src/c.ts", "unknown"),
      state("src/d.ts", "pending"),
      state("src/gone.ts", "fail"),
    ]);
    const committed = committedOf("src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts");
    const changed = ["src/a.ts", "src/b.ts", "src/gone.ts"];
    // c was never linted and d waits: neither is the commit's change.
    expect(lintCounts(v, side(committed, [], false, changed))).toEqual({
      findings: 1,
      notDetermined: 0,
      running: 1,
    });
    expect(lintCounts(v, side(committed, [], false, []))).toEqual({
      findings: 0,
      notDetermined: 0,
      running: 0,
    });
  });

  it("keys made of a config that is not the committed one, or of no record, are not the commit's", () => {
    const states = [
      state("src/a.ts", "fail"),
      state("src/b.ts", "pass"),
      state("src/c.ts", "pending"),
    ];
    const committed = committedOf("src/a.ts", "src/b.ts", "src/c.ts");
    const none = { findings: 0, notDetermined: 3, running: 0 };
    // The source blobs are the commit's: only the config tells the results apart.
    expect(lintCounts(view(states, [], {}, made("blob-edited")), side(committed))).toEqual(none);
    expect(lintCounts(view(states, [], {}, made(null)), side(committed))).toEqual(none);
    expect(lintCounts(view(states, [], {}, null), side(committed))).toEqual(none);
    // A config the commit does not hold, and the keys read none: the same.
    const without = new Map([...committed].filter(([p]) => p !== CONFIG));
    expect(lintCounts(view(states, [], {}, made(null)), side(without))).toEqual({
      findings: 1,
      notDetermined: 0,
      running: 1,
    });
  });

  it("keys holding the install fingerprint are not the commit's while an environment input differs", () => {
    const v = view([state("src/a.ts", "fail")], [], {}, made(undefined, true));
    const committed = committedOf("src/a.ts");
    expect(lintCounts(v, side(committed, ["patches/x.patch"], true))).toMatchObject({
      findings: 0,
      notDetermined: 1,
    });
    expect(lintCounts(v, side(committed))).toMatchObject({ findings: 1, notDetermined: 0 });
    const plain = view([state("src/a.ts", "fail")]);
    expect(lintCounts(plain, side(committed, ["patches/x.patch"], true))).toMatchObject({
      findings: 1,
    });
  });
});

describe("readLintCounts from the lint store (019-13 slice 2)", () => {
  it("reads states, stored findings, the program's files and the recorded inputs per tool", () => {
    const dir = commonDir();
    const store = open(dir);
    const failing = state("src/a.ts", "fail");
    const whole = state("src/b.ts", "fail");
    store.states.upsertMany([failing, whole]);
    for (const s of [failing, whole]) {
      store.results.put(
        {
          check: s.check,
          key: s.judged?.key ?? "",
          outcome: "fail",
          findings: [finding("r", "one"), finding("r", "two", 2)],
          fingerprint: null,
          toolVersion: "1",
          lintedAt: 1,
        },
        1,
      );
    }
    const scope = lintScope(W, "eslint");
    writeProgram(store.meta, scope, { segment: "s", files: ["src/b.ts"], extensions: [] });
    writeCursor(store.meta, scope, { revision: 1, environment: "e1" });
    writeInputs(store.meta, scope, { environment: "e1", ...made() });
    const committed = committedOf("src/a.ts", "src/b.ts");
    expect(readLintCounts(dir, LINT_ON.lint, W, side(committed))).toEqual({
      findings: 4,
      notDetermined: 0,
      running: 0,
    });
    expect(readLintCounts(dir, LINT_ON.lint, W, side(committed, ["src/c.ts"]))).toEqual({
      findings: 2,
      notDetermined: 1,
      running: 0,
    });
    // A cursor an older daemon moved, with no record of its own: no evidence.
    writeCursor(store.meta, scope, { revision: 2, environment: "e2" });
    expect(readLintCounts(dir, LINT_ON.lint, W, side(committed))).toEqual({
      findings: 0,
      notDetermined: 2,
      running: 0,
    });
  });

  it("no lint part while lint is off or no store exists", () => {
    const dir = commonDir();
    expect(readLintCounts(dir, LINT_ON.lint, W, side(new Map()))).toBeUndefined();
    open(dir);
    const off = { ...LINT_ON.lint, enabled: false };
    expect(readLintCounts(dir, off, W, side(new Map()))).toBeUndefined();
    expect(readLintCounts(dir, LINT_ON.lint, W, side(new Map()))).toEqual({
      findings: 0,
      notDetermined: 0,
      running: 0,
    });
  });
});

describe("lint evidence through the lint pass (019-21, review 0.1.396 B2)", () => {
  /** The counts of the commit `head` of `tree`, with `differing` left unstaged. */
  async function countsAt(
    tree: ReturnType<typeof lintTree>,
    head: string,
    differing: readonly string[],
  ) {
    const committed = await committedBlobs(tree.root, head);
    return readLintCounts(tree.commonDir, LINT_ON.lint, tree.id, side(committed, differing));
  }

  it("an unchanged config counts; a rule change left unstaged is not determined once linted", async () => {
    const tree = lintTree().write("src/a.js", "bad no-undef\n").write("src/b.js", "ok\n");
    tree.revise();
    const provider = new FakeProvider();
    const { pass, errors } = lintPass(tree, provider);
    pass.nudge();
    await pass.idle();
    const store = storeOf(tree);
    expect(outcomes(store, tree)).toEqual({ "src/a.js": "fail", "src/b.js": "pass" });
    expect(readInputs(store.meta, lintScope(tree.id, "eslint"))?.files).toEqual([
      [CONFIG, tree.source.file(CONFIG)?.hash],
    ]);
    const head = tree.commit();

    // `b` is edited and linted, left unstaged: `a`'s result is the commit's, under its config.
    tree.write("src/b.js", "bad semi\n");
    tree.revise();
    pass.nudge();
    await pass.idle();
    expect(await countsAt(tree, head, ["src/b.js"])).toEqual({
      findings: 1,
      notDetermined: 1,
      running: 0,
    });

    // A config edit not yet linted: the results are still the committed config's.
    provider.off.add("no-undef");
    tree.write(CONFIG, "export default [{ rules: { 'no-undef': 'off' } }];\n");
    expect(await countsAt(tree, head, ["src/b.js", CONFIG])).toEqual({
      findings: 1,
      notDetermined: 1,
      running: 0,
    });

    // Linted under the edited config, left unstaged: `a` passes there, which is not the commit's.
    tree.revise();
    pass.nudge();
    await pass.idle();
    expect(outcomes(store, tree)).toEqual({ "src/a.js": "pass", "src/b.js": "fail" });
    expect(await countsAt(tree, head, ["src/b.js", CONFIG])).toEqual({
      findings: 0,
      notDetermined: 2,
      running: 0,
    });

    // The edited config committed: its results are the new commit's.
    const next = tree.commit(CONFIG);
    expect(await countsAt(tree, next, ["src/b.js"])).toEqual({
      findings: 0,
      notDetermined: 1,
      running: 0,
    });
    expect(errors).toEqual([]);
    await pass.close();
  });

  it("a store with no record of the inputs, as an older daemon left it, is no evidence", async () => {
    const tree = lintTree().write("src/a.js", "bad no-undef\n");
    tree.revise();
    const { pass } = lintPass(tree, new FakeProvider());
    pass.nudge();
    await pass.idle();
    const head = tree.commit();
    expect(await countsAt(tree, head, [])).toEqual({ findings: 1, notDetermined: 0, running: 0 });
    const store = storeOf(tree);
    store.meta.delete(inputsKey(lintScope(tree.id, "eslint")));
    expect(await countsAt(tree, head, [])).toEqual({ findings: 0, notDetermined: 1, running: 0 });
    await pass.close();
  });
});
