import { describe, expect, it } from "vitest";
import { release } from "../../../src/core/lint/pass/commit-entry.js";
import { lintScope } from "../../../src/core/lint/pass/records.js";
import { registerLint, tellLint } from "../../../src/core/lint/surface/deliver.js";
import type { CheckGroup } from "../../../src/core/types/check-groups.js";
import type { Policy } from "../../../src/core/types/policy.js";
import type { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir, LINT_ON } from "../helpers.js";
import { consumer, said, sourceOf } from "../surface/helpers.js";
import { FakeProvider, lintPass, lintTree, outcomes, storeOf } from "./helpers.js";

/*
 * Review 0.1.402 B1 (row 019-43): a commit's released check is news even
 * when its result is a stored result another worktree made, found by a
 * first or config keying or by an edit's keying before the commit. The
 * agent is told its FAIL lint line once; a consumer that holds the finding
 * already is not told again. A held file that never lints keeps the
 * keying's summary away, so the summary cannot stand in for the entry.
 */

const AT_COMMIT: CheckGroup = { name: "lint", lint: true, at: "commit" };
const HELD: Policy = { ...LINT_ON, checks: [AT_COMMIT] };
const DONOR_CONFIG = "export default [{ rules: {} }];\n";
const ALL_OWN = () => null;

/** A pass over `tree` run to its end, then closed. */
async function passOnce(tree: FakeWorktree, provider: FakeProvider, policy: Policy) {
  const { pass, errors } = lintPass(tree, provider, { policy: () => policy });
  pass.nudge();
  await pass.idle();
  await pass.close();
  expect(errors).toEqual([]);
}

/** A donor worktree that stores the failing result of `src/a.js` under `config`. */
async function donor(dir: string, config: string) {
  const tree = lintTree("donor", dir)
    .write("eslint.config.js", config)
    .write("src/a.js", "bad no-undef\n");
  tree.revise();
  await passOnce(tree, new FakeProvider(), LINT_ON);
}

/** A target worktree in `dir` held for a commit, its first keying done, and a consumer registered. */
async function target(dir: string) {
  const tree = lintTree("target", dir).write("src/a.js", "ok\n").write("src/b.js", "ok\n");
  tree.revise();
  const provider = new FakeProvider();
  await passOnce(tree, provider, HELD);
  const source = sourceOf(tree, () => HELD);
  const me = consumer(tree);
  registerLint(source, me, 1_000);
  const releaseA = () => {
    const blob = tree.source.file("src/a.js")?.hash ?? "";
    release(storeOf(tree).meta, lintScope(tree.id, "eslint"), new Map([["src/a.js", blob]]));
  };
  return { tree, provider, source, me, releaseA };
}

describe("a commit's stored-result hit is news (review 0.1.402 B1)", () => {
  it("a config keying's hit of a released check: told once, with a held miss beside it", async () => {
    const dir = commonDir();
    await donor(dir, DONOR_CONFIG);
    const { tree, provider, source, me, releaseA } = await target(dir);

    // The commit changes the config and `a.js` to the donor's; it releases `a.js`.
    tree.write("eslint.config.js", DONOR_CONFIG).write("src/a.js", "bad no-undef\n");
    tree.revise();
    releaseA();
    await passOnce(tree, provider, HELD);
    expect(provider.calls, "the donor's result is a hit").toEqual([]);
    expect(outcomes(storeOf(tree), tree)).toEqual({ "src/a.js": "fail", "src/b.js": "pending" });

    const told = tellLint(source, me, 2_000, ALL_OWN);
    expect(told?.summary, "the held miss keeps the summary away").toBeUndefined();
    expect(told?.entries.map(said)).toEqual(["first-seen-fail src/a.js +no-undef"]);
    expect(tellLint(source, me, 2_100, ALL_OWN), "once").toBeNull();
    const late = consumer(tree, "s2");
    registerLint(source, late, 2_200);
    expect(tellLint(source, late, 2_300, ALL_OWN), "seeded by count").toBeNull();
  });

  it("an edit's hit judged before the commit: the commit's release tells it once", async () => {
    const dir = commonDir();
    await donor(dir, "export default [];\n");
    const { tree, provider, source, me, releaseA } = await target(dir);

    // The agent's edit makes `a.js` the donor's text: a quiet file, its hit records no transition.
    tree.write("src/a.js", "bad no-undef\n");
    tree.revise();
    await passOnce(tree, provider, HELD);
    expect(outcomes(storeOf(tree), tree)).toEqual({ "src/a.js": "fail", "src/b.js": "pending" });
    expect(tellLint(source, me, 2_000, ALL_OWN), "no news before the commit").toBeNull();

    releaseA();
    await passOnce(tree, provider, HELD);
    expect(provider.calls).toEqual([]);
    expect(tellLint(source, me, 2_100, ALL_OWN)?.entries.map(said)).toEqual([
      "first-seen-fail src/a.js +no-undef",
    ]);
    expect(tellLint(source, me, 2_200, ALL_OWN), "once").toBeNull();

    // A second commit of the same bytes tells nothing again.
    releaseA();
    await passOnce(tree, provider, HELD);
    expect(tellLint(source, me, 2_300, ALL_OWN)).toBeNull();
  });

  it("a config keying after the commit's lint, before any delivery: its cut hides nothing", async () => {
    const dir = commonDir();
    const { tree, provider, source, me, releaseA } = await target(dir);
    tree.write("src/a.js", "bad no-undef\n");
    tree.revise();
    await passOnce(tree, provider, HELD);
    releaseA();
    await passOnce(tree, provider, HELD);
    expect(outcomes(storeOf(tree), tree)).toEqual({ "src/a.js": "fail", "src/b.js": "pending" });

    // The config changes before the agent hears of it: a.js lints again, with the same finding.
    tree.write("eslint.config.js", DONOR_CONFIG);
    tree.revise();
    await passOnce(tree, provider, HELD);
    expect(provider.calls.flat()).toEqual(["src/a.js", "src/a.js"]);
    expect(outcomes(storeOf(tree), tree)).toEqual({ "src/a.js": "fail", "src/b.js": "pending" });

    const told = tellLint(source, me, 2_000, ALL_OWN);
    expect(told?.summary).toBeUndefined();
    expect(told?.entries.map(said)).toEqual(["first-seen-fail src/a.js +no-undef"]);
    expect(tellLint(source, me, 2_100, ALL_OWN), "once").toBeNull();
  });
});
