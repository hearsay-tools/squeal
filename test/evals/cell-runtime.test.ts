import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cellEnv, clearScratch } from "../../evals/lib/index.mjs";
import { MAX_SOCKET_PATH_BYTES, socketPathFor, userTmpDir } from "../../src/core/daemon/paths.js";
import { slowSlotDir } from "../../src/core/slow/index.js";
import type { WorktreeId } from "../../src/core/types/index.js";

// 006-56: each cell its own XDG_RUNTIME_DIR, so its daemon's slow slot and capacity pool
// (`slowSlotDir`, spec 004 D2 as amended, 004-16) are the cell's, never the host's other daemons'.
// The socket does not fit under a cell's path and falls back to a name of the cell's own.

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A cell's path as run-cell lays it out under the default root (`cellId`'s id). */
const CELL =
  "/tmp/squeal-evals-1001/cells/833135b2fba0/20261015T051841Z-c4f1e6/a11-inherited-flake.p0.claude-claude-sonnet-5-5.e-medium.r10";
const WORKTREE = "0123456789abcdef" as WorktreeId; // worktreeIdFor's 16 hex digits
const HOST = { PATH: "/usr/bin", HOME: "/home/someone", XDG_RUNTIME_DIR: "/run/user/1001" };

describe("a cell's runtime directory", () => {
  it("is under the cell, in place of the host's", () => {
    expect(cellEnv(HOST, CELL).XDG_RUNTIME_DIR).toBe(join(CELL, "run"));
    expect(cellEnv({ PATH: "/usr/bin" }, CELL).XDG_RUNTIME_DIR).toBe(join(CELL, "run"));
  });

  it("holds the daemon's slow slot and capacity pool", () => {
    const env = cellEnv(HOST, CELL);
    expect(slowSlotDir(env)).toBe(join(CELL, "run", "squeal"));
    expect(slowSlotDir(HOST)).toBe("/run/user/1001/squeal");
  });

  it("is too long for the socket, which falls back to a name of the cell's own worktree", () => {
    const env = cellEnv(HOST, CELL);
    const under = join(CELL, "run", `squeal-${WORKTREE}.sock`);
    expect(Buffer.byteLength(under)).toBeGreaterThan(MAX_SOCKET_PATH_BYTES);
    // The daemon and the hooks derive it from the same XDG_RUNTIME_DIR, so they agree.
    expect(socketPathFor(WORKTREE, env)).toBe(join(userTmpDir(), `squeal-${WORKTREE}.sock`));
    // Under a short evals root it fits, in the cell.
    const short = cellEnv(HOST, "/tmp/e/c");
    expect(socketPathFor(WORKTREE, short)).toBe(`/tmp/e/c/run/squeal-${WORKTREE}.sock`);
  });

  it("goes with the cell's scratch", () => {
    const cell = mkdtempSync(join(tmpdir(), "squeal-cell-runtime-"));
    dirs.push(cell);
    for (const d of ["out", "work", "run/squeal"]) mkdirSync(join(cell, d), { recursive: true });
    writeFileSync(join(cell, "run/squeal/slow.lock"), "");
    const r = clearScratch(cell, []);
    expect(r.secretsAfterRemoval).toEqual([]);
    expect(() => mkdirSync(join(cell, "run"))).not.toThrow(); // removed, so it can be made again
  });
});
