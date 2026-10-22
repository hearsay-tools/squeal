import { describe, expect, it, onTestFinished } from "vitest";
import { createDelivery } from "../../src/core/delivery/index.js";
import type { Consumer } from "../../src/core/types/index.js";
import { fixedStatus } from "../delivery/fakes.js";
import { openTestStore, SLOW } from "./helpers.js";
import { type Entry, type ReloadRepo, reloadRepo, touch } from "./reload-projects-kit.js";

/*
 * Row 011-78 (011 C10, *Projects at a reload*; `tasks/011-62/design.md` R1,
 * tests 1 to 4 and 6), through a real daemon with node:test projects: a
 * `squeal.config.json` change that removes, adds, renames or changes a
 * project takes effect at that revision, with no restart.
 */

const KEEP: Entry = { name: "keep", cwd: "keep", env: { MODE: "a" } };
const GONE: Entry = { name: "gone", cwd: "gone" };
const KEEP_FILE = "keep/keep.test.mjs";
const GONE_FILE = "gone/gone.test.mjs";

/** The baseline, `gone`'s new failure re-run once (001 D6 as amended, task 001-171). */
async function baseline(repo: ReloadRepo, files: number): Promise<void> {
  await repo.until("gone's new failure re-ran", () => repo.runs("gone") === 2);
  await repo.ran("the baseline", files);
}

/** The projects of the worktree's known failures (`Known failures`). */
const failing = (repo: ReloadRepo) =>
  repo.states().flatMap((s) => (s.outcome === "fail" ? [s.check.project] : []));

describe("a reload reconciles the node:test projects (row 011-78)", SLOW, () => {
  it("forgets a removed project, tells its failure once as resolved and keeps the rest", async () => {
    const repo = await reloadRepo([KEEP, GONE], {
      [KEEP_FILE]: { name: "keep", body: { mode: "a" } },
      [GONE_FILE]: { name: "gone", body: { fail: true } },
    });
    await baseline(repo, 2);
    expect(failing(repo)).toEqual(["gone"]);
    const store = openTestStore(repo);
    onTestFinished(() => store.close());
    const delivery = createDelivery(store, { status: fixedStatus() });
    const consumer: Consumer = { worktreeId: repo.worktreeId, sessionId: "s1", agentId: "main" };
    await delivery.register(consumer);
    await delivery.onToolBoundary(consumer);
    const kept = { key: repo.row(KEEP_FILE)?.key, states: repo.states("keep") };

    repo.config([KEEP]);
    await repo.until(
      "gone forgotten",
      () => repo.row(GONE_FILE) === undefined && repo.states("gone").length === 0,
    );
    expect(failing(repo)).toEqual([]);
    expect((await delivery.onToolBoundary(consumer))?.entries).toMatchObject([
      { kind: "fail-retired", check: { project: "gone", testPath: GONE_FILE } },
    ]);
    expect(await delivery.onToolBoundary(consumer)).toBeNull();

    touch(repo, GONE_FILE);
    await repo.settle();
    expect(repo.row(GONE_FILE)).toBeUndefined();
    expect(repo.runs("gone")).toBe(2);
    expect(await repo.retry(GONE_FILE)).toEqual({
      code: 1,
      stdout: expect.stringContaining(
        `Not retried: ${GONE_FILE} is not a test file Squeal has keyed in this worktree.`,
      ),
    });
    expect({ key: repo.row(KEEP_FILE)?.key, states: repo.states("keep") }).toEqual(kept);
    expect(repo.runs("keep")).toBe(1);
  });

  it("lists an added project and runs its file once", async () => {
    const repo = await reloadRepo([KEEP], {
      [KEEP_FILE]: { name: "keep", body: { mode: "a" } },
      "added/added.test.mjs": { name: "added" },
    });
    await repo.ran("the baseline", 1);

    repo.config([KEEP, { name: "added", cwd: "added" }]);
    await repo.until("added runs", () =>
      repo.states("added").some((s) => s.outcome === "pass" && s.validity === "current"),
    );
    await repo.settle();
    expect(repo.rows().map((row) => row.testFile)).toEqual([
      { project: "added", path: "added/added.test.mjs" },
      { project: "keep", path: KEEP_FILE },
    ]);
    expect([repo.runs("added"), repo.runs("keep")]).toEqual([1, 1]);
  });

  it("recreates a changed project: its env and include re-key it, its slow flag does not", async () => {
    const repo = await reloadRepo([KEEP], {
      [KEEP_FILE]: { name: "keep", body: { mode: "a" } },
      "keep/more/more.test.mjs": { name: "more" },
    });
    await repo.ran("the baseline", 1);
    const before = repo.row(KEEP_FILE)?.key;

    // The probe's C1: an `env` the PASS does not hold under.
    repo.config([{ ...KEEP, env: { MODE: "b" } }]);
    await repo.until("keep fails under MODE b", () => failing(repo).includes("keep"));
    expect(repo.row(KEEP_FILE)?.key).not.toBe(before);

    const widened: Entry = {
      ...KEEP,
      env: { MODE: "b" },
      include: ["*.test.mjs", "more/*.test.mjs"],
    };
    repo.config([widened]);
    await repo.until("more runs", () => repo.runs("more") === 1);
    await repo.ran("the widened listing", 2);
    await repo.settle();
    const keys = repo.rows().map((row) => row.key);
    const runs = [repo.runs("keep"), repo.runs("more")];

    repo.config([{ ...widened, slow: true }]);
    await repo.settle();
    expect(repo.rows().map((row) => row.key)).toEqual(keys);
    expect([repo.runs("keep"), repo.runs("more")]).toEqual(runs);
  });

  it("runs a renamed project under its new name, and two swapped names without a conflict", async () => {
    const repo = await reloadRepo([{ name: "a", cwd: "one" }, { name: "b", cwd: "two" }, GONE], {
      "one/one.test.mjs": { name: "one" },
      "two/two.test.mjs": { name: "two" },
      [GONE_FILE]: { name: "gone", body: { fail: true } },
    });
    await baseline(repo, 3);

    // The probe's C2.
    repo.config([
      { name: "a", cwd: "one" },
      { name: "b", cwd: "two" },
      { ...GONE, name: "gone2" },
    ]);
    await repo.until("gone2 fails", () => failing(repo).includes("gone2"));
    expect(failing(repo)).toEqual(["gone2"]);
    expect(repo.states("gone")).toEqual([]);
    expect(repo.row(GONE_FILE)?.testFile.project).toBe("gone2");

    repo.config([
      { name: "b", cwd: "one" },
      { name: "a", cwd: "two" },
      { ...GONE, name: "gone2" },
    ]);
    await repo.until("the swap runs", () => repo.runs("one") === 2 && repo.runs("two") === 2);
    await repo.ran("the swapped listing", 3);
    expect(repo.rows().map((row) => row.testFile)).toEqual([
      { project: "a", path: "two/two.test.mjs" },
      { project: "b", path: "one/one.test.mjs" },
      { project: "gone2", path: GONE_FILE },
    ]);
    expect(repo.notes().filter((text) => text.includes("reported by both"))).toEqual([]);
  });

  it("keeps the projects through a file that does not parse, and reconciles at the next", async () => {
    const repo = await reloadRepo([KEEP, GONE], {
      [KEEP_FILE]: { name: "keep", body: { mode: "a" } },
      [GONE_FILE]: { name: "gone", body: { fail: true } },
    });
    await baseline(repo, 2);
    const rows = repo.rows();

    // The probe's C5: a trailing comma.
    repo.write("squeal.config.json", '{ "nodeTest": [], }\n');
    await repo.settle();
    expect(repo.rows()).toEqual(rows);
    expect(failing(repo)).toEqual(["gone"]);
    expect(repo.notes()).toContainEqual(
      expect.stringMatching(/^squeal\.config\.json changed; policy reloaded: .*not valid JSON/),
    );

    repo.config([KEEP]);
    await repo.until("gone forgotten", () => repo.row(GONE_FILE) === undefined);
    expect(failing(repo)).toEqual([]);
    expect([repo.runs("keep"), repo.runs("gone")]).toEqual([1, 2]);
  });
});
