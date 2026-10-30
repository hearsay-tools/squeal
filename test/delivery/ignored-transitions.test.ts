import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { git } from "../hash/git-repo.js";
import {
  DESCRIPTOR,
  daemon,
  ENVIRONMENT,
  head,
  headerLine,
  keysOn,
  pass,
  READER,
  repo,
  useDescriptorRepo,
  write,
} from "./descriptor-fixture.js";

/*
 * Review 0.1.379 B1 (row 011-262): that the daemon watches a path as an
 * extra file does not prove git ignores it when a revision records its
 * change. In one daemon the descriptor's first rewrite is marked; then git
 * stops ignoring it, by `git add -f` and a commit, or by a `.gitignore` that
 * no longer names `.ai/qa/` with the file left untracked, and its next
 * rewrite is not. The path stays an extra file until a restart. The watch
 * writer's case is `test/scheduler/daemon-loop.test.ts`'s.
 */

useDescriptorRepo();

/** The change revision `number` stored for `path`. */
const changeOf = (number: number, path = DESCRIPTOR) =>
  repo.store.revisions
    .get(worktreeIdFor(repo.root), number)
    ?.changes.find((change) => change.path === path);

/** Whether `git check-ignore` says git ignores `path`: exit 0, or 1 for not. */
function ignoredByGit(path: string): boolean {
  try {
    git(repo.root, ["check-ignore", "-q", path]);
    return true;
  } catch (error) {
    if ((error as { status?: number }).status === 1) return false;
    throw error;
  }
}

describe("a path git stops ignoring, in one daemon (review 0.1.379 B1)", () => {
  const stops = [
    [
      "force-added and committed",
      () => {
        git(repo.root, ["add", "-f", DESCRIPTOR]);
        git(repo.root, ["commit", "-qm", "track the descriptor"]);
      },
    ],
    ["no longer ignored, left untracked", () => write(".gitignore", "\n")],
  ] as const;
  for (const [how, stop] of stops)
    it(`keeps revision 1's mark and gives revision 2 none: ${how}`, async () => {
      const keys = await daemon();
      write(DESCRIPTOR, '{"pid":202,"startedAt":2}\n');
      expect((await pass(keys))?.number).toBe(1);

      stop();
      expect(ignoredByGit(DESCRIPTOR)).toBe(false);
      write(DESCRIPTOR, '{"pid":303,"startedAt":3}\n');
      expect((await pass(keys))?.number).toBe(2);

      expect(keys.extraFiles()).toEqual([DESCRIPTOR]);
      expect(changeOf(1)?.ignored).toBe(true);
      expect(changeOf(2)).toBeDefined();
      expect(changeOf(2)).not.toHaveProperty("ignored");
      // A header spanning both names each path by its newest change: revision 2's, unmarked.
      for (const form of ["news", "full"] as const) {
        expect(headerLine(form, 0)).toContain(`(changed ${DESCRIPTOR}`);
        expect(headerLine(form, 0)).not.toContain("git-ignored");
      }
    });
});

describe("a mark git cannot prove (review 0.1.379 B1)", () => {
  it("is left off a path git refuses to classify, one in an embedded repository, with one note", async () => {
    const LIB = "vendor/lib.ts";
    write(LIB, "export const lib = 1;\n");
    git(join(repo.root, "vendor"), ["init", "-q", "-b", "main"]);
    git(join(repo.root, "vendor"), ["add", "-A"]);
    git(join(repo.root, "vendor"), ["commit", "-qm", "vendor"]);
    git(repo.root, ["add", "vendor"]);
    git(repo.root, ["commit", "-qm", "vendor as a gitlink"]);
    const notes: string[] = [];
    const keys = keysOn(undefined, (text) => notes.push(text));
    await keys.bootstrap(head);
    await keys.setEnvironments([ENVIRONMENT]);
    keys.setClosure({ testFile: READER, paths: [READER.path, LIB] });
    await keys.trackUntracked();
    // The watcher counts what git refuses as ignored, so it watches the path as an extra file.
    expect(keys.extraFiles()).toEqual([LIB]);

    for (const n of [2, 3]) {
      write(LIB, `export const lib = ${n};\n`);
      const revision = await pass(keys);
      expect(revision?.changes).toEqual([expect.not.objectContaining({ ignored: true })]);
    }
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(
      /^A change's git-ignored mark was left off: git did not classify vendor\/lib\.ts \(.*fatal: Pathspec 'vendor\/lib\.ts' is in submodule 'vendor'\)\.$/,
    );
  });

  it("is left off when git check-ignore fails, with a note naming the paths", async () => {
    const notes: string[] = [];
    const keys = await daemon(keysOn(undefined, (text) => notes.push(text)));
    const at = await head();
    writeFileSync(join(repo.root, ".git", "index"), "not an index");
    write(DESCRIPTOR, '{"pid":202,"startedAt":2}\n');
    const revision = await pass(keys, async () => at);
    expect(revision?.changes).toEqual([expect.objectContaining({ path: DESCRIPTOR })]);
    expect(revision?.changes[0]).not.toHaveProperty("ignored");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(
      new RegExp(
        `^A change's git-ignored mark was left off: git check-ignore failed for ${DESCRIPTOR.replaceAll(".", "\\.")}: .*index file`,
      ),
    );
  });
});
