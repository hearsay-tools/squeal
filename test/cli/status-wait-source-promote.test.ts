import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { CheckUsageError } from "../../src/cli/status-wait-focus.js";
import { type NamedWaitOptions, waitForNamed } from "../../src/cli/status-wait-paths.js";
import { SOURCE_PROMOTE_CAP } from "../../src/cli/wait/named.js";
import type { AbsolutePath, RelativePath, RevisionNumber } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { A, NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Row 024-01 (spec 024 D1): a named wait on a source path promotes the test
 * files the path selects with the files named by their own paths, up to
 * `SOURCE_PROMOTE_CAP`; past it, only the own files, with `wakeCatchUp`, so
 * the daemon ends catch-up's 120 s wait instead. A folder still promotes
 * nothing (row 011-406), and `--check` on a source path stays a usage error
 * (row 011-146).
 */

const SOURCE = "src/foo.ts";
const readerPaths = (n: number) => Array.from({ length: n }, (_, i) => `src/r${i}.test.ts`);

interface Sent {
  readonly files: string[];
  readonly wakeCatchUp: boolean;
}

/** A synced daemon whose answer names `readers` as the readers of `SOURCE`. */
function options(readers: readonly string[], sent: Sent[], checks?: string[]): NamedWaitOptions {
  const current: SyncState = {
    state: "synced",
    revision: 4 as RevisionNumber,
    incarnation: null,
    readers: new Map([[SOURCE as RelativePath, readers.map(ref)]]),
  };
  return {
    timeoutMs: 300,
    pollMs: 20,
    settleMs: 100,
    now: () => NOW,
    sync: (): DaemonSync => ({ current: () => current, stop: () => {} }),
    promote: (_root, files: readonly TestFileRef[], _within, opts) =>
      sent.push({ files: files.map((f) => f.path), wakeCatchUp: opts?.wakeCatchUp === true }),
    ...(checks === undefined ? {} : { checks, ask: async () => [] }),
  };
}

async function waitOn(cwd: string, paths: readonly string[], opts: NamedWaitOptions) {
  return waitForNamed(cwd as AbsolutePath, paths, opts);
}

describe("a source path's selected files are promoted up to the cap (024-01)", () => {
  it("15 selected files, all queued: all 15 promoted, no wake", async () => {
    const readers = readerPaths(15);
    const { repo } = repoWith(readers);
    const sent: Sent[] = [];

    await waitOn(repo.main, [SOURCE], options(readers, sent));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.files.sort()).toEqual([...readers].sort());
    expect(sent[0]?.wakeCatchUp).toBe(false);
  });

  it("an own test file beside the source: both, the own file once", async () => {
    const readers = [A, ...readerPaths(4)];
    const { repo } = repoWith(readers);
    const sent: Sent[] = [];

    await waitOn(repo.main, [A, SOURCE], options(readers, sent));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.files.sort()).toEqual([...readers].sort());
    expect(sent[0]?.wakeCatchUp).toBe(false);
  });

  it(`exactly ${SOURCE_PROMOTE_CAP} files in all: all promoted`, async () => {
    const readers = readerPaths(SOURCE_PROMOTE_CAP - 1);
    const { repo } = repoWith([A, ...readers]);
    const sent: Sent[] = [];

    await waitOn(repo.main, [A, SOURCE], options(readers, sent));

    expect(sent[0]?.files).toHaveLength(SOURCE_PROMOTE_CAP);
    expect(sent[0]?.wakeCatchUp).toBe(false);
  });

  it("past the cap: only the own files, with wakeCatchUp", async () => {
    const readers = readerPaths(SOURCE_PROMOTE_CAP);
    const { repo } = repoWith([A, ...readers]);
    const sent: Sent[] = [];

    await waitOn(repo.main, [A, SOURCE], options(readers, sent));

    expect(sent).toEqual([{ files: [A], wakeCatchUp: true }]);
  });

  it("past the cap with no own file: no files, with wakeCatchUp", async () => {
    const readers = readerPaths(SOURCE_PROMOTE_CAP + 10);
    const { repo } = repoWith(readers);
    const sent: Sent[] = [];

    await waitOn(repo.main, [SOURCE], options(readers, sent));

    expect(sent).toEqual([{ files: [], wakeCatchUp: true }]);
  });

  it("a folder beside a source path: the files under the folder stay unpromoted (011-406)", async () => {
    const under = ["lib/u0.test.ts", "lib/u1.test.ts"];
    const readers = readerPaths(3);
    const { repo } = repoWith([...under, ...readers]);
    mkdirSync(join(repo.main, "lib"));
    const sent: Sent[] = [];

    await waitOn(repo.main, ["lib", SOURCE], options([...readers, under[0] as string], sent));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.files.sort()).toEqual([...readers].sort());
  });

  it("a folder alone: nothing promoted, no wake (011-406)", async () => {
    const under = readerPaths(SOURCE_PROMOTE_CAP + 5).map((p) => p.replace("src/", "lib/"));
    const { repo } = repoWith(under);
    mkdirSync(join(repo.main, "lib"));
    const sent: Sent[] = [];

    await waitOn(repo.main, ["lib"], options([], sent));

    expect(sent).toEqual([{ files: [], wakeCatchUp: false }]);
  });

  it("--check on a source path: a usage error, nothing promoted (011-146)", async () => {
    const readers = readerPaths(15);
    const { repo } = repoWith(readers);
    const sent: Sent[] = [];

    await expect(waitOn(repo.main, [SOURCE], options(readers, sent, ["good"]))).rejects.toThrow(
      CheckUsageError,
    );
    expect(sent).toEqual([]);
  });
});
