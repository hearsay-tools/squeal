import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSnapshot, formatStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import {
  A,
  B,
  batch,
  FILES,
  gitMay,
  HELPER,
  heldPaths,
  holdSide,
  mergeRepo,
} from "../scheduler/merge-hold-fixture.js";

/*
 * Row 011-73 (011 C6 and C9 as amended 2026-10-21; `tasks/011-61/design.md`
 * R2, tests 1 and 6): during a merge hold, status says the hold after the
 * revision line, `--json` carries it, and no importer reads FAIL; a row
 * the live daemon did not write since its start is not shown.
 */

/** Paths that conflict beside the helper, add/add, so a merge stops on 1 + `n` paths. */
function conflictMore(root: string, n: number): string[] {
  const paths = Array.from({ length: n }, (_, i) => `docs/c${String(i).padStart(2, "0")}.md`);
  git(root, ["checkout", "-q", "side"]);
  mkdirSync(join(root, "docs"), { recursive: true });
  for (const path of paths) writeFileSync(join(root, path), "side\n");
  git(root, ["add", "docs"]);
  git(root, ["commit", "-qm", "side docs"]);
  git(root, ["checkout", "-q", "main"]);
  mkdirSync(join(root, "docs"), { recursive: true });
  for (const path of paths) writeFileSync(join(root, path), "main\n");
  git(root, ["add", "docs"]);
  git(root, ["commit", "-qm", "main docs"]);
  return paths;
}

async function heldSide(more = 0) {
  const repo = mergeRepo();
  const extra = more === 0 ? [] : conflictMore(repo.main, more);
  const side = holdSide(repo, repo.main, FILES);
  await side.scheduler.start();
  await side.scheduler.idle();
  expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
  await batch(side, HELPER, ...extra);
  await side.scheduler.idle();
  await expect.poll(() => heldPaths(side)?.length ?? 0).toBe(Math.min(50, 1 + more));
  return { repo, side, extra };
}

const lines = (s: StatusSnapshot) => formatStatus(s, Date.now()).split("\n");

describe("status: a merge hold (row 011-73)", { timeout: 60_000 }, () => {
  it("1: one `On hold:` line after the revision line, `holds` in --json, and no importer reads FAIL", async () => {
    const { side } = await heldSide();
    const snapshot = buildSnapshot(side.store, side.root, Date.now());
    expect(snapshot.holds).toEqual([
      expect.objectContaining({ cause: "merge", paths: [HELPER], pathCount: 1 }),
    ]);
    const text = lines(snapshot);
    expect(text[0]).toMatch(/^Revision: /);
    expect(text[1]).toMatch(
      /^On hold: unresolved merge since \d\d:\d\d:\d\d, git lists 1 unmerged path \(src\/helper\.ts\); no test runs until git lists none\. Resolve it and `git add` it, or abort\.$/,
    );
    expect(text.filter((l) => l.startsWith("On hold:"))).toHaveLength(1);
    expect(text.filter((l) => /FAIL/.test(l) && (l.includes(A) || l.includes(B)))).toEqual([]);
    const outstanding = text.find((l) => l.includes("on hold for the unresolved merge"));
    expect(outstanding).toBe(
      `  2 test files queued, on hold for the unresolved merge (git lists ${HELPER} unmerged): ${A}, ${B}; none of Squeal's commands advances them`,
    );
  });

  it("1: the line names three paths and `and N more`; --json names up to 50 and counts every one", async () => {
    const { side, extra } = await heldSide(54);
    const snapshot = buildSnapshot(side.store, side.root, Date.now());
    const [hold] = snapshot.holds ?? [];
    expect(hold?.cause).toBe("merge");
    if (hold?.cause !== "merge") return;
    expect(hold.pathCount).toBe(55);
    expect(hold.paths).toHaveLength(50);
    expect(hold.paths).toEqual([...extra, HELPER].sort().slice(0, 50));
    const line = lines(snapshot)[1];
    expect(line).toContain(
      `git lists 55 unmerged paths (${hold.paths.slice(0, 3).join(", ")} and 52 more); `,
    );
    expect(line).toContain("Resolve them and `git add` them, or abort.");
  });

  it("6: a row from a dead daemon, or one written before the live daemon started, is not shown", async () => {
    const { side } = await heldSide();
    expect(buildSnapshot(side.store, side.root, Date.now()).holds).toHaveLength(1);
    // Two heartbeat intervals and more after the last beat: the daemon is down.
    const later = Date.now() + 3 * 60_000;
    const dead = buildSnapshot(side.store, side.root, later);
    expect(dead.daemon.state).toBe("down");
    expect(dead.holds).toBeUndefined();
    expect(formatStatus(dead, later)).not.toContain("On hold:");

    // A successor registered after the row was written: the row is its predecessor's.
    const worktree = side.store.worktrees.get(side.worktreeId);
    if (worktree?.daemon == null) throw new Error("no daemon record");
    const startedAt = Date.now() + 1_000;
    side.store.worktrees.upsert({
      ...worktree,
      daemon: { ...worktree.daemon, startedAt, heartbeatAt: startedAt },
    });
    const successor = buildSnapshot(side.store, side.root, startedAt);
    expect(successor.daemon.state).toBe("alive");
    expect(successor.holds).toBeUndefined();
  });
});
