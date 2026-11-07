import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { createFsHasher } from "../../src/core/hash/hasher.js";
import { IgnoredMarks } from "../../src/core/scheduler/ignored-marks.js";
import { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import type { RelativePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/policy.js";
import type { Revision } from "../../src/core/types/revision.js";
import {
  DESCRIPTOR,
  daemon,
  OUTSIDE,
  pass,
  READER,
  repo,
  useDescriptorRepo,
  write,
} from "../delivery/descriptor-fixture.js";
import { git } from "../hash/git-repo.js";

/*
 * Row 011-270 (review 0.1.379 B1): a path the daemon watches as an extra
 * file because git ignored it, which git then sees (a `git add -f` and a
 * commit, or a removed ignore rule), leaves the extra-file set at the
 * revision that shows it, and counts in its directories' listings from
 * there, as a restarted daemon's do. `.ai/notes.md` is a tracked sibling:
 * the root listing names `.ai` for it.
 */

useDescriptorRepo();

const SIBLING = ".ai/notes.md";
/** A test file that lists the root, `.ai/` and `.ai/qa/`. */
const LISTER: TestFileRef = OUTSIDE;
const LISTINGS: readonly RelativePath[] = ["./", ".ai/", ".ai/qa/"];

const POLICY: Policy = { ...DEFAULT_POLICY, observe: { runtimeInputs: false } };

interface Keying {
  /** Each list `onExtraFiles` was called with. */
  readonly watched?: RelativePath[][];
  /** In place of `IgnoredMarks`. */
  readonly ignored?: (paths: readonly RelativePath[]) => Promise<ReadonlySet<RelativePath>>;
  readonly policy?: Policy;
}

/** Keys as the fixture's `keysOn` builds them. */
function keysOn({ watched = [], ignored, policy = POLICY }: Keying = {}): WorktreeKeys {
  const marks = new IgnoredMarks(
    repo.root,
    () => keys.extraFiles(),
    () => {},
  );
  const keys: WorktreeKeys = new WorktreeKeys({
    root: repo.root,
    worktreeId: worktreeIdFor(repo.root),
    store: repo.store,
    hasher: createFsHasher(repo.root, "sha1"),
    objectFormat: "sha1",
    policy,
    squealVersion: "0.0.0-test",
    env: {},
    onExtraFiles: (paths) => watched.push([...paths]),
    ignored: ignored ?? ((paths) => marks.among(paths)),
  });
  return keys;
}

/** A daemon whose reader names the descriptor and whose lister lists its directories. */
async function started(keys = keysOn()): Promise<WorktreeKeys> {
  await daemon(keys);
  keys.setClosure({ testFile: LISTER, paths: [LISTER.path, ...LISTINGS] });
  await keys.trackUntracked();
  return keys;
}

/** A pass and `rekeyContent`'s first two steps: listings first, then content (task 001-132). */
async function revise(keys: WorktreeKeys): Promise<Revision | null> {
  const revision = await pass(keys);
  if (revision !== null) {
    keys.rekeyListings(revision.changes);
    keys.index.rekey(revision.changes.map((change) => change.path));
  }
  return revision;
}

const keysOf = (keys: WorktreeKeys) => ({
  reader: keys.index.key(READER),
  lister: keys.index.key(LISTER),
});

/** The keys of a daemon started now on the same tree and store. */
const restarted = async (policy = POLICY) => keysOf(await started(keysOn({ policy })));

/** Each way git comes to see the descriptor, with what its revision shows. */
const TRANSITIONS = [
  {
    name: "a `git add -f` and a commit",
    shows: [DESCRIPTOR],
    apply: () => {
      git(repo.root, ["add", "-f", DESCRIPTOR]);
      git(repo.root, ["commit", "-qm", "track the descriptor"]);
      write(DESCRIPTOR, '{"pid":202,"startedAt":2}\n');
    },
  },
  {
    name: "a removed ignore rule",
    shows: [".gitignore"],
    apply: () => write(".gitignore", "dist/\n"),
  },
] as const;

describe.each(TRANSITIONS)("an extra file git comes to see by $name (row 011-270)", (t) => {
  it("leaves the extra-file set at the revision that shows it, with a restart's keys", async () => {
    write(SIBLING, "# notes\n");
    git(repo.root, ["add", SIBLING]);
    git(repo.root, ["commit", "-qm", "sibling"]);
    const watched: RelativePath[][] = [];
    const keys = await started(keysOn({ watched }));
    expect(keys.extraFiles()).toEqual([DESCRIPTOR]);
    const before = keysOf(keys);

    t.apply();
    const revision = await revise(keys);
    expect(revision?.changes.map((change) => change.path)).toEqual(t.shows);
    expect(revision?.changes.some((change) => change.ignored === true)).toBe(false);
    expect(keys.extraFiles()).toEqual([]);
    expect(watched.at(-1)).toEqual([]);
    // `.ai/` names `qa` now: its listing moved.
    expect(keysOf(keys).lister).not.toEqual(before.lister);
    expect(keysOf(keys)).toEqual(await restarted());
  });

  it("keeps the tracked sibling's directory in the root listing when the path is deleted later", async () => {
    write(SIBLING, "# notes\n");
    git(repo.root, ["add", SIBLING]);
    git(repo.root, ["commit", "-qm", "sibling"]);
    const keys = await started();
    t.apply();
    await revise(keys);

    rmSync(join(repo.root, DESCRIPTOR));
    const revision = await revise(keys);
    expect(revision?.changes).toEqual([
      expect.objectContaining({ path: DESCRIPTOR, newHash: null }),
    ]);
    expect(keysOf(keys)).toEqual(await restarted());
  });

  it("is a declared input from that revision when policy `inputs` selects it, as at a restart", async () => {
    const policy: Policy = { ...POLICY, inputs: [".ai/qa/*.json"] };
    const keys = await started(keysOn({ policy }));
    expect(keys.declaredFor(LISTER.path)).toEqual([]);
    t.apply();
    await revise(keys);
    expect(keys.declaredFor(LISTER.path)).toEqual([DESCRIPTOR]);
    expect(keysOf(keys)).toEqual(await restarted(policy));
  });
});

describe("an extra file git still ignores (row 011-270)", () => {
  it("stays when its revision has no mark because git gave no answer", async () => {
    // `IgnoredMarks` answers nothing when git fails: that is no proof git sees a path.
    const keys = await started(keysOn({ ignored: async () => new Set() }));
    write(DESCRIPTOR, '{"pid":202,"startedAt":2}\n');
    await revise(keys);
    expect(keys.extraFiles()).toEqual([DESCRIPTOR]);
    expect(keysOf(keys)).toEqual(await restarted());
  });

  it("stays through an ignore-rule edit that still ignores it", async () => {
    const keys = await started();
    write(".gitignore", ".ai/qa/\ndist/\n");
    await revise(keys);
    expect(keys.extraFiles()).toEqual([DESCRIPTOR]);
  });
});
