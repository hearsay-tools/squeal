import { describe, expect, it } from "vitest";
import type { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import { DEFAULT_POLICY, type Policy, type TestFileRef } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import {
  DESCRIPTOR,
  daemon,
  ENVIRONMENT,
  head,
  headerLine,
  keysOn,
  OUTSIDE,
  pass,
  READER,
  repo,
  useDescriptorRepo,
  write,
} from "./descriptor-fixture.js";

/*
 * Row 011-262 (gh-105), findings E1's descriptor step: cezarion's test
 * environment rewrites `.ai/qa/test-env.json`, which git ignores and specs
 * read. The rewrite is a revision `git status` does not show, and the
 * incident's header named no path: `Revision 1 · 9a9f617f + 1: test files
 * without checks: 32 pending, 41 unknown.` Here a closure names the
 * descriptor, as the readers' observed reads did, so the daemon watches it
 * as an extra file; the header names it with `git-ignored` in both forms.
 * The watch path's mark is `test/scheduler/daemon-loop.test.ts`'s.
 */

useDescriptorRepo();

describe("the descriptor git ignores, rewritten (row 011-262, findings E1)", () => {
  it("is a revision git status does not show, whose header names it git-ignored in both forms", async () => {
    const keys = await daemon();
    expect(keys.extraFiles()).toEqual([DESCRIPTOR]);

    // The environment boots again: a new pid and start time.
    write(DESCRIPTOR, '{"pid":202,"startedAt":2}\n');
    expect(git(repo.root, ["status", "--porcelain"]).trim()).toBe("");
    const revision = await pass(keys);
    expect(revision?.changes).toEqual([
      expect.objectContaining({ path: DESCRIPTOR, ignored: true }),
    ]);

    // `git status` is empty, so the tree is not dirty: only the path says what changed.
    const named = `Revision 1 · ${git(repo.root, ["rev-parse", "--short=8", "HEAD"]).trim()} + 1 (changed git-ignored ${DESCRIPTOR}): `;
    expect(headerLine("news")?.slice(0, named.length)).toBe(named);
    expect(headerLine("full")?.slice(0, named.length)).toBe(named);
  });

  it("names a tracked path beside it unmarked", async () => {
    const keys = await daemon();
    write(DESCRIPTOR, '{"pid":202,"startedAt":2}\n');
    write("src/a.ts", "export const a = 2;\n");
    await pass(keys);
    expect(headerLine("news")).toContain(`(changed git-ignored ${DESCRIPTOR}, src/a.ts): `);
  });

  it("is marked in the start revision of a daemon that finds it rewritten while none ran", async () => {
    await daemon();
    write(DESCRIPTOR, '{"pid":303,"startedAt":3}\n');
    const revision = await keysOn().bootstrap(head);
    expect(revision?.trigger).toBe("start");
    expect(revision?.changes).toEqual([
      expect.objectContaining({ path: DESCRIPTOR, ignored: true }),
    ]);
    expect(headerLine("news")).toContain(`(changed git-ignored ${DESCRIPTOR}): `);
  });
});

/*
 * 0.1.369's `runtimeFiles`: a rule takes an exact path out of the observed
 * reads of the test files it names. Such a path stays an extra file while a
 * reader outside the rule still names it, so its change is a revision and
 * carries the mark. When the rule takes it out of every reader, nothing
 * names it: the daemon neither hashes nor watches it, and a rewrite makes
 * no revision, so no header names it.
 */
describe("the descriptor a runtimeFiles rule takes out of a reader's reads", () => {
  const RULED: Policy = {
    ...DEFAULT_POLICY,
    runtimeFiles: [{ project: "", tests: [READER.path], paths: [DESCRIPTOR] }],
  };

  /** A daemon under `RULED` whose `readers` were observed reading the descriptor. */
  async function ruled(readers: readonly TestFileRef[]): Promise<WorktreeKeys> {
    const keys = keysOn(RULED);
    await keys.bootstrap(head);
    await keys.setEnvironments([ENVIRONMENT]);
    for (const reader of readers) {
      keys.setClosure({ testFile: reader, paths: [reader.path] });
      keys.addObserved(reader, [DESCRIPTOR]);
    }
    await keys.trackUntracked();
    keys.writeSeen();
    return keys;
  }

  it("is marked while a reader outside the rule still names it", async () => {
    const keys = await ruled([READER, OUTSIDE]);
    expect(keys.runtimeApplication(READER).paths).toEqual([DESCRIPTOR]);
    expect(keys.extraFiles()).toEqual([DESCRIPTOR]);

    write(DESCRIPTOR, '{"pid":202,"startedAt":2}\n');
    const revision = await pass(keys);
    expect(revision?.changes).toEqual([
      expect.objectContaining({ path: DESCRIPTOR, ignored: true }),
    ]);
    expect(headerLine("news")).toContain(`(changed git-ignored ${DESCRIPTOR}): `);
    expect(headerLine("full")).toContain(`(changed git-ignored ${DESCRIPTOR}): `);
  });

  it("is marked in the start revision that reconciles runtime files", async () => {
    await ruled([READER, OUTSIDE]);
    write(DESCRIPTOR, '{"pid":303,"startedAt":3}\n');
    const keys = keysOn(RULED);
    // `bootstrap` holds a cached runtime file back until the closures are known.
    expect(await keys.bootstrap(head)).toBeNull();
    await keys.setEnvironments([ENVIRONMENT]);
    for (const reader of [READER, OUTSIDE])
      keys.setClosure({ testFile: reader, paths: [reader.path] });
    await keys.trackUntracked();
    const revision = await keys.reconcileRuntime(head);
    expect(revision?.trigger).toBe("start");
    expect(revision?.changes).toEqual([
      expect.objectContaining({ path: DESCRIPTOR, ignored: true }),
    ]);
    expect(headerLine("news")).toContain(`(changed git-ignored ${DESCRIPTOR}): `);
  });

  it("makes no revision when the rule takes it out of every reader", async () => {
    const keys = await ruled([READER]);
    expect(keys.extraFiles()).toEqual([]);
    expect(keys.cache.hashOf(DESCRIPTOR)).toBeUndefined();

    write(DESCRIPTOR, '{"pid":202,"startedAt":2}\n');
    expect(await pass(keys)).toBeNull();
  });
});
