import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, git, linkInstall } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { check, clean, run, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-24 (lessons round 3, Q1 and Q2) on `$TMPDIR` git fixtures with
 * the real Vitest adapter. Q1: a report with files that have no result at
 * the commit ends with the `--run` command that runs them, its count the
 * one `--run` then selects, and `--all-missing` when it runs more. Q2:
 * `--at HEAD` with a clean tree and no `--run` keys nothing and names the
 * parent; a dirty tree still compares.
 */

/** A: `test/a.test.ts` reads `src/a.ts`, `test/b.test.ts` reads `src/b.ts`; HEAD changes `src/a.ts`. */
function changedA() {
  const f = fixture({
    // Coverage on: `--run` stores what it runs.
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 1;\n",
    "src/b.ts": "export const value = 1;\n",
    "test/a.test.ts": testOf("a", 1),
    "test/b.test.ts": testOf("b", 1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 1; // tidied\n" });
  return { f, a };
}

describe(
  "status --at names --run for the files with no result there (row 023-24, Q1)",
  SLOW,
  () => {
    it("ends with --run's command and count, then --all-missing's, with D17.1's estimate when stored", async () => {
      const { f, a } = changedA();
      // A duration for b at another key: b has no result at A, but its estimate is known.
      withStore(f, (store) =>
        store.results.putMany([result(check("test/b.test.ts"), "elsewhere")]),
      );
      const at = a.slice(0, 9);
      const text = await run(f, { commit: a });
      expect(text.code).toBe(3);
      const last = text.out.trimEnd().split("\n").at(-1);
      expect(last).toMatch(
        new RegExp(
          `^\`squeal status --at ${a} --run\` runs the 1 file with no result there that the change since ${at} selects; \`squeal status --at ${a} --run --all-missing\` runs all 2 files \\(estimate [1-9][0-9]* s\\)\\.$`,
        ),
      );
      const json = JSON.parse((await run(f, { commit: a, json: true })).out);
      expect(json.next).toMatchObject({
        run: { command: `squeal status --at ${a} --run`, files: 1, seconds: null },
        allMissing: { command: `squeal status --at ${a} --run --all-missing`, files: 2 },
      });
      expect(json.next.allMissing.seconds).toBeGreaterThan(0);
      // The count is the one `--run` selects.
      const ran = JSON.parse(
        (await run(f, { commit: a, json: true, run: { allMissing: false, timeoutSeconds: 120 } }))
          .out,
      );
      expect(ran.run.selected).toBe(json.next.run.files);
      expect(ran.next).toBeNull();
      clean(f);
    });

    it("names the paths, says --run alone when it runs every file, and nothing when all have results", async () => {
      const { f, a } = changedA();
      const named = await run(f, { commit: a, paths: ["test/a.test.ts"] });
      expect(named.out.trimEnd().split("\n").at(-1)).toBe(
        `\`squeal status --at ${a} test/a.test.ts --run\` runs the 1 file with no result there.`,
      );
      // Only b is left with no result there, and the change does not select it.
      await run(f, {
        commit: a,
        paths: ["test/a.test.ts"],
        run: { allMissing: false, timeoutSeconds: 120 },
      });
      const left = await run(f, { commit: a });
      expect(left.out.trimEnd().split("\n").at(-1)).toBe(
        `The change since ${a.slice(0, 9)} selects no file with no result there; \`squeal status --at ${a} --run --all-missing\` runs the 1 file.`,
      );
      clean(f);
    });
  },
);

describe("status --at HEAD (row 023-24, Q2)", SLOW, () => {
  it("keys nothing on a clean tree without --run, names the parent, exits 2", async () => {
    const { f } = changedA();
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };
    const refused = await run(f, { commit: "HEAD", paths: ["test/a.test.ts"] }, options);
    expect(refused.code).toBe(2);
    expect(refused.out).toBe("");
    expect(refused.err).toBe(
      "squeal status --at: HEAD is HEAD, your working tree's commit, and the tree is clean: compare with its parent, `squeal status --at HEAD~1 test/a.test.ts`\n",
    );
    expect(refused.err).not.toContain("keying");
    const head = git(f.root, "rev-parse", "HEAD").trim();
    expect((await run(f, { commit: head, json: true }, options)).code).toBe(2);
    clean(f);
  });

  it("refuses with --run too, before any keying, and names the parent's --run (row 023-29, R2)", async () => {
    const { f } = changedA();
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };
    const runArgs = { allMissing: false, timeoutSeconds: 60 };
    const refused = await run(f, { commit: "HEAD", run: runArgs }, options);
    expect(refused.code).toBe(2);
    expect(refused.out).toBe("");
    expect(refused.err).toBe(
      "squeal status --at: HEAD is HEAD, your working tree's commit, and the tree is clean: compare with its parent, `squeal status --at HEAD~1 --run`\n",
    );
    expect(f.checkouts()).toEqual([]);
    clean(f);
  });

  it("says there is no parent on a first commit", async () => {
    const f = fixture({
      "src/a.ts": "export const value = 1;\n",
      "test/a.test.ts": testOf("a", 1),
    });
    const refused = await run(f, { commit: "HEAD" });
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("HEAD has no parent, so there is nothing to compare");
    clean(f);
  });

  it("compares as before when the tree is dirty: an untracked file counts", async () => {
    const { f } = changedA();
    writeFileSync(join(f.root, "notes.txt"), "draft\n");
    const dirty = await run(f, { commit: "HEAD", json: true });
    expect(dirty.code).toBe(3);
    expect(JSON.parse(dirty.out)).toMatchObject({ dirty: true, counts: { unknown: 2 } });
    clean(f);
  });

  it("compares when a submodule changed inside or moved (review wave-16 B1)", async () => {
    const f = fixture({
      "src/a.ts": "export const value = 1;\n",
      "test/a.test.ts": testOf("a", 1),
    });
    const dep = join(f.dir, "dep");
    mkdirSync(dep);
    git(dep, "init", "-q", "-b", "main");
    writeFileSync(join(dep, "source.ts"), "export const value = 1;\n");
    git(dep, "add", "source.ts");
    git(dep, "commit", "-qm", "initial");
    git(f.root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", dep, "dep");
    git(f.root, "commit", "-qam", "add dependency");
    expect((await run(f, { commit: "HEAD" })).code).toBe(2);
    // A tracked file edited inside the submodule.
    writeFileSync(join(f.root, "dep/source.ts"), "export const value = 2;\n");
    expect(git(f.root, "status", "--porcelain")).toBe(" M dep\n");
    const edited = await run(f, { commit: "HEAD" });
    expect(edited.code, edited.err).not.toBe(2);
    expect(edited.err).not.toContain("the tree is clean");
    // The submodule moved to a commit HEAD does not record.
    git(join(f.root, "dep"), "commit", "-qam", "moved");
    expect(git(f.root, "status", "--porcelain")).toBe(" M dep\n");
    const moved = await run(f, { commit: "HEAD" });
    expect(moved.code, moved.err).not.toBe(2);
    clean(f);
  });
});
