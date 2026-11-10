import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrappedMetaKey } from "../../src/core/types/daemon.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import { git } from "../hash/git-repo.js";
import { recorded, type SquealRepo } from "./helpers.js";
import { committedRepo, pendingLint, status } from "./stop-no-edit-helpers.js";
import {
  decision,
  deps,
  HARNESSES,
  type Harness,
  markStopWait,
  stopBoth,
  turnOf,
} from "./stop-slow-helpers.js";
import { commit } from "./stopped-repo.js";

/*
 * Row 011-312 (gh-153): a session that changed nothing is not held at Stop
 * for checks of files it never touched. Besides the daemon that had
 * finished its start scan at registration (004-67), a second proof counts:
 * no revision since registration, `HEAD` as it was then, and Git clean.
 * An edit no daemon watched, a commit and an untracked file still hold.
 */

/**
 * The main agent registered in a turn, after `prepare`, while the daemon had
 * not finished its start scan; the scan then ends with no revision, and one
 * untouched ESLint check waits to lint.
 */
async function beforeScan(
  harness: Harness,
  prepare: (r: SquealRepo) => void = () => {},
): Promise<SquealRepo> {
  const r = committedRepo();
  prepare(r);
  r.store.meta.delete(bootstrappedMetaKey(r.worktreeId));
  await harness.startTurn(r);
  r.store.meta.set(bootstrappedMetaKey(r.worktreeId), "1");
  markStopWait(r, harness.name);
  pendingLint(r);
  expect(status(r)).toBe("");
  return r;
}

describe.each(HARNESSES)("a session that changed nothing, $name (011-312)", (harness) => {
  it("registered before the start scan: not held for an untouched lint check", async () => {
    const r = await beforeScan(harness);
    const out = await stopBoth(harness, r);
    expect(out.quick).toEqual({});
    expect(out.waiting).toEqual({});
    expect(turnOf(r)).toBe("idle");
  });

  it("an edit no daemon watched still holds", async () => {
    const r = await beforeScan(harness);
    writeFileSync(join(r.root, "a.txt"), "edited\n");
    const out = await stopBoth(harness, r);
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toContain("untouched.js");
  });

  it("a commit still holds", async () => {
    const r = await beforeScan(harness);
    writeFileSync(join(r.root, "a.txt"), "committed\n");
    git(r.root, ["add", "a.txt"]);
    commit(r.root, "edit");
    expect(status(r)).toBe("");
    const out = await stopBoth(harness, r);
    expect(out.waiting.decision).toBe("block");
  });

  it("an untracked new file still holds", async () => {
    const r = await beforeScan(harness);
    writeFileSync(join(r.root, "new.txt"), "new\n");
    const out = await stopBoth(harness, r);
    expect(out.waiting.decision).toBe("block");
  });

  it("a file Git ignores, edited while no daemon watched, is the proof's limit", async () => {
    const r = await beforeScan(harness, (repo) => {
      writeFileSync(join(repo.root, ".gitignore"), "ignored.txt\n");
      git(repo.root, ["add", ".gitignore"]);
      commit(repo.root, "ignore");
    });
    writeFileSync(join(r.root, "ignored.txt"), "edited\n");
    expect(status(r)).toBe("");
    const out = await stopBoth(harness, r);
    expect(out.waiting).toEqual({});
  });
});

describe("a subagent that changed nothing, claude-code (011-312)", () => {
  /** A subagent registered by SubagentStart, the daemon past its start scan. */
  async function subagent(): Promise<SquealRepo> {
    const r = committedRepo();
    await runHook("session-start", recorded("subagent-start", r.root), deps);
    pendingLint(r);
    return r;
  }

  it("is not held at SubagentStop for an untouched lint check", async () => {
    const r = await subagent();
    const out = decision(await runHook("stop", recorded("subagent-stop", r.root), deps));
    expect(out).toEqual({});
  });

  it("is held after a revision since it registered", async () => {
    const r = await subagent();
    r.apply();
    const out = decision(await runHook("stop", recorded("subagent-stop", r.root), deps));
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("1 lint check is not linted at revision 1: untouched.js.");
  });
});
