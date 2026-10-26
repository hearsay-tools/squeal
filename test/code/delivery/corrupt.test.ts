import { closeSync, openSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  codeStorePath,
  isCodeStoreOpenFailure,
  openCodeStore,
} from "../../../src/core/code/store/index.js";
import { codeSource, withCode } from "../../../src/core/delivery/code-source.js";
import { readStatus } from "../../../src/core/status/index.js";
import type { StatusSnapshot } from "../../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../../src/harness/claude-code/index.js";
import { recorded, type SquealRepo, squealRepo } from "../../harness/helpers.js";
import { ON } from "../helpers.js";
import { codeState, fn, fnCheck, putFile, TIERS } from "./helpers.js";

/*
 * Review 0.1.283 B1: a code store whose header and schema read but whose
 * data page is corrupt costs only the code part (011 C8, C13). Status,
 * registration, delivery and Stop stay as they are with the policy off.
 */

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const SELECT = fnCheck("selectTier");

/** Overwrites the first byte of the `states` table's root page in the closed code store. */
function corruptStates(commonDir: string): void {
  const path = codeStorePath(commonDir);
  const db = new DatabaseSync(path);
  const root = Number(
    db.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'states'").get()?.rootpage,
  );
  const size = Number(db.prepare("PRAGMA page_size").get()?.page_size);
  db.close();
  const fd = openSync(path, "r+");
  writeSync(fd, Buffer.from([0xff]), 0, 1, (root - 1) * size);
  closeSync(fd);
}

/**
 * A repository with one passing test whose Stop blocks on a known failure;
 * `corrupt` adds the policy on, with `complexity.blocking`, and a code store
 * with a failing function and a corrupt `states` page.
 */
function repoWith(corrupt: boolean): SquealRepo {
  const r = squealRepo();
  r.apply(r.pass());
  const stop = { blockOnKnownFailures: true };
  const complexity = corrupt
    ? { complexity: { enabled: true, blocking: true }, coverage: { enabled: false } }
    : { complexity: { enabled: false } };
  writeFileSync(join(r.root, "squeal.config.json"), JSON.stringify({ stop, ...complexity }));
  if (!corrupt) return r;
  const code = openCodeStore(r.repo.commonDir, ON);
  if (isCodeStoreOpenFailure(code)) throw new Error(JSON.stringify(code));
  putFile(code, r.worktreeId, TIERS, [fn("selectTier", 23, 120)]);
  code.states.upsertMany([codeState(r.worktreeId, SELECT, 23)]);
  // The last connection's close checkpoints the WAL into the file.
  code.close();
  corruptStates(r.repo.commonDir);
  return r;
}

const contextOf = (stdout: string): string => {
  const out = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string } };
  return out.hookSpecificOutput?.additionalContext ?? "";
};

/** Session start, a test failure delivered, and Stop, through the Claude Code hook. */
async function session(r: SquealRepo) {
  const start = await runHook("session-start", recorded("session-start", r.root), deps);
  r.apply(r.fail());
  const batch = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps);
  const stop = await runHook("stop", recorded("stop", r.root), deps);
  const status = readStatus(r.root);
  return {
    start: contextOf(start.stdout),
    batch: contextOf(batch.stdout),
    stop: stop.stdout,
    exitCodes: [start.exitCode, batch.exitCode, stop.exitCode],
    status,
  };
}

describe("a code store corrupt past its open (review 0.1.283 B1)", () => {
  it("fails the code read alone, after a successful open", () => {
    const r = repoWith(true);
    const source = codeSource(r.repo.commonDir, r.root);
    let opened = false;
    const read = withCode(source, ({ store }) => {
      opened = true;
      return store.states.list(r.worktreeId);
    });
    expect({ opened, read }).toEqual({ opened: true, read: null });
  });

  it("keeps status, registration, delivery and Stop as with the policy off", async () => {
    const off = await session(repoWith(false));
    const corrupt = await session(repoWith(true));
    expect(corrupt.status.available).toBe(true);
    const snapshot = corrupt.status as StatusSnapshot;
    expect(snapshot.code).toBeUndefined();
    const failures = (s: StatusSnapshot) => s.knownFailures.map((f) => [f.check, f.fingerprint]);
    expect(failures(snapshot)).toEqual(failures(off.status as StatusSnapshot));
    expect(off.start).toContain("SQUEAL");
    expect(off.batch).toContain("FAIL");
    expect(JSON.parse(off.stop)).toMatchObject({ decision: "block" });
    const { status: _o, ...offHooks } = off;
    const { status: _c, ...corruptHooks } = corrupt;
    expect(corruptHooks).toEqual(offHooks);
  });
});
