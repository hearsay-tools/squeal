// THROWAWAY probe for research/source-path-selection.md (row 011-233). Not product code.
// A fixture store (no live store, socket or permit pool): two worktrees, W (the agent's) and X
// (another worker's), share one store, as every worktree of a repository does (011 C8: one
// `test_files` row per test file, "the newest closure path list, stored once per test file").
// Each step writes the rows the scheduler writes at that point (named per step) and reads
// `selectNamedFiles` and the named wait as the CLI does.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../../../../../src/cli/main.js";
import { selectNamedFiles } from "../../../../../../src/cli/named-selection.js";
import { CLOSURE_METHOD } from "../../../../../../src/core/keys/closure.js";
import type { CheckKey, RevisionNumber, Store } from "../../../../../../src/core/types/index.js";
import { key as ownKey, NOW, ref, repoWith } from "../../../../../../test/cli/status-wait-fixture.js";
import { check, state } from "../../../../../../test/status/helpers.js";

const START = "src/cli/start.ts";
const READY = "src/cli/start-ready.ts";
const HELPER = "test/daemon/start-helpers.ts";
const TYPES = "src/core/types/index.ts";

// The five files that import `startCommand` through `start-helpers.ts` (static closure).
const HELPER_READERS = ["endpoint", "handoff", "register", "short", "spawned"].map(
  (n) => `test/daemon/start-${n}.test.ts`,
);
// The eight files 011-219's worker saw selected: they read start.ts at run time (observed reads).
const RUNTIME_READERS = [
  "test/daemon/bootstrapped.test.ts",
  "test/daemon/scratch-refused.test.ts",
  "test/daemon/user-config-note.test.ts",
  "test/daemon/drain-checkpoint.test.ts",
  "test/daemon/scratch.test.ts",
  "test/daemon/stop-cancel.test.ts",
  "test/harness/opencode-abort.test.ts",
  "test/integration/pi-silence.test.ts",
];
const READERS = [...HELPER_READERS, ...RUNTIME_READERS];
const OTHERS = Array.from({ length: 20 }, (_, i) => `test/core/other-${i}.test.ts`);
const ALL = [...READERS, ...OTHERS];

function closureOf(path: string): string[] {
  if (HELPER_READERS.includes(path)) return [HELPER, START, READY, TYPES];
  if (RUNTIME_READERS.includes(path)) return [START, READY, TYPES];
  return [TYPES];
}

/** `storeClosures` (`src/core/scheduler/revision.ts:272`): the record of each file, by `by`. */
function storeClosures(store: Store, files: readonly string[], by: string) {
  for (const path of files) {
    store.testFiles.put({
      testFile: ref(path),
      closure: {
        testFile: ref(path),
        paths: [path, ...closureOf(path)].sort() as never,
        complete: false,
        method: CLOSURE_METHOD,
      },
      updatedAt: NOW,
      updatedBy: by,
    });
  }
}

/** A worktree's `test_file_keys` rows at `tag`: what `rekeyContent` writes for a content re-key. */
function keys(store: Store, worktree: string, files: readonly string[], tag: string) {
  store.testFileKeys.upsertMany(
    files.map((path) => ({
      worktreeId: worktree,
      testFile: ref(path),
      key: `${tag}-${path}` as CheckKey,
      revision: 4 as RevisionNumber,
      pending: null,
    })),
  );
}

function selects(store: Store, w: string, root: string, path: string) {
  const s = selectNamedFiles(store, w, root, root, [path]);
  const files = s.files.map((f) => f.path as string);
  return {
    readers: files.filter((f) => READERS.includes(f)).length,
    helperReaders: files.filter((f) => HELPER_READERS.includes(f)).length,
    all: files.length,
    files,
  };
}

const log: string[] = [];
function row(step: string, store: Store, w: string, root: string) {
  const start = selects(store, w, root, START);
  const types = selects(store, w, root, TYPES);
  const line = `${step.padEnd(58)} start.ts: ${start.readers}/13 readers (${start.helperReaders}/5 via helper)   types: ${types.all}/33`;
  log.push(line);
  return { start, types };
}

describe("011-233: what a source path selects as the shared closure record moves", () => {
  it("replays the steps", () => {
    // W at revision 4, every file keyed and current; X another worktree of the same repository.
    const { repo, store } = repoWith([], ALL);
    const W = repo.mainId;
    const X = repo.addWorktree("other").id;
    const root = repo.main;
    // repoWith keys W's files `key-<path>-done`; X starts at the same content, so the same keys.
    store.testFileKeys.upsertMany(
      store.testFileKeys.list(W).map((r) => ({ ...r, worktreeId: X })),
    );

    // S0: X stored every closure (its bootstrap or edits); X's key equals W's.
    storeClosures(store, ALL, X);
    const s0 = row("S0 X wrote all 33 closures, same content as W", store, W, root);
    expect(s0.start.readers).toBe(13);

    // S1: W edits start.ts. `rekeyContent` moves W's keys of the 13 readers; no test_files write.
    keys(store, W, READERS, "w1");
    const s1 = row("S1 W edits start.ts: content re-key, runner part not applied", store, W, root);
    expect(s1.start.readers).toBe(0);

    // S2: W's runner part (`fetchRunnerPart` re-resolves `content.rekeyed`) stores the 13.
    storeClosures(store, READERS, W);
    const s2 = row("S2 W's runner part stores the 13 rekeyed closures", store, W, root);
    expect(s2.start.readers).toBe(13);

    // S3: X edits src/core/types/index.ts, read by all 33: X re-keys and stores all 33.
    keys(store, X, ALL, "x1");
    storeClosures(store, ALL, X);
    const s3 = row("S3 X edits types/index.ts, stores all 33 closures", store, W, root);
    expect(s3.start.readers).toBe(0);
    expect(s3.types.all).toBe(0);

    // S4: W runs 3 runtime readers whose runs observe new reads (`endRecord` stores `grown`).
    storeClosures(store, RUNTIME_READERS.slice(0, 3), W);
    const s4 = row("S4 W's run of 3 runtime readers stores their grown closures", store, W, root);
    expect(s4.start.files.filter((f) => READERS.includes(f))).toEqual(RUNTIME_READERS.slice(0, 3));

    // S5: X re-resolves those 3 again (another X edit); W's runs store the other 5 runtime readers.
    storeClosures(store, RUNTIME_READERS.slice(0, 3), X);
    storeClosures(store, RUNTIME_READERS.slice(3), W);
    const s5 = row("S5 X re-stores those 3; W's runs store the other 5", store, W, root);
    expect(s5.start.files.filter((f) => READERS.includes(f))).toEqual(RUNTIME_READERS.slice(3));

    // S6: no edit in W at all. W and X at one content again, then X moves to another commit
    // (any closure path differs): X's key differs and W selects none of the files X wrote last.
    keys(store, W, ALL, "c0");
    keys(store, X, ALL, "c0");
    storeClosures(store, ALL, X);
    const s6a = row("S6a W, X same content, X wrote all 33", store, W, root);
    keys(store, X, ALL, "c1");
    const s6b = row("S6b X moves to another commit, W edits nothing", store, W, root);
    expect(s6a.start.readers).toBe(13);
    expect(s6b.start.readers).toBe(0);

    // S7: X back at W's content, then X's worktree is destroyed and pruned
    // (`prune`: `worktrees.remove` deletes its test_file_keys; test_files stays).
    keys(store, X, ALL, "c0");
    const s7a = row("S7a X back at W's content", store, W, root);
    store.worktrees.remove(X);
    const s7b = row("S7b X's worktree pruned, its 33 records stay", store, W, root);
    expect(s7a.start.readers).toBe(13);
    expect(s7b.start.readers).toBe(0);
    expect(store.testFiles.list().filter((r) => r.updatedBy === X)).toHaveLength(33);

    writeFileSync(join(import.meta.dirname, "results", "steps.txt"), `${log.join("\n")}\n`);
  });

  it("a named wait on start.ts passes while a reader that fails is not selected", async () => {
    // W: every reader current; start-spawned failed at W's key. Its record was written by X,
    // whose key for it differs (X edited a file in its closure), so W selects 12 of 13.
    const { repo, store } = repoWith([], ALL);
    const W = repo.mainId;
    const X = repo.addWorktree("other").id;
    const SPAWNED = "test/daemon/start-spawned.test.ts";
    storeClosures(store, ALL.filter((p) => p !== SPAWNED), W);
    storeClosures(store, [SPAWNED], X);
    keys(store, X, [SPAWNED], "x1");
    ownKey(store, W, SPAWNED, null);
    store.knownStates.upsertMany([
      state(W, check(SPAWNED, "holds"), { outcome: "fail", observedAt: 4, fingerprint: "Error: x" }),
    ]);
    const results: string[] = [];
    for (const named of [[START], [SPAWNED], [START, SPAWNED]]) {
      let stdout = "";
      const io: CliIo = {
        stdout: (t) => {
          stdout += t;
        },
        stderr: () => {},
        cwd: repo.main,
        now: () => NOW,
        env: {},
      };
      const code = await main(["status", "--wait", "3000", ...named], io);
      const json: string[] = [];
      const jio: CliIo = { ...io, stdout: (t) => json.push(t) };
      await main(["status", "--json", "--wait", "3000", ...named], jio);
      const payload = JSON.parse(json.join(""));
      const sel = payload.wait ?? payload.selection;
      results.push(
        `wait ${named.join(" ")}: exit ${code}; selected ${sel.testFiles.length}, start-spawned selected: ${sel.testFiles.some((f: { path: string }) => f.path === SPAWNED)}; result ${sel.result}\n  last line: ${stdout.trimEnd().split("\n").at(-1)}`,
      );
      if (named.length === 1 && named[0] === START) expect(code).toBe(0);
    }
    writeFileSync(join(import.meta.dirname, "results", "wait.txt"), `${results.join("\n")}\n`);
  }, 60_000);
});

describe("011-233: the reader has not run yet", () => {
  it("a named wait on start.ts returns pass before a queued reader runs", async () => {
    const { repo, store } = repoWith([], ALL);
    const W = repo.mainId;
    const X = repo.addWorktree("other").id;
    const SPAWNED = "test/daemon/start-spawned.test.ts";
    storeClosures(store, ALL.filter((p) => p !== SPAWNED), W);
    storeClosures(store, [SPAWNED], X);
    keys(store, X, [SPAWNED], "x1");
    // Queued at W's new key (catch-up or the edit's work), its check pending.
    ownKey(store, W, SPAWNED, "queued");
    store.knownStates.upsertMany([
      state(W, check(SPAWNED, "holds"), { validity: "pending", pendingPhase: "queued", observedAt: 3 }),
    ]);
    let stdout = "";
    const io: CliIo = {
      stdout: (t) => {
        stdout += t;
      },
      stderr: () => {},
      cwd: repo.main,
      now: () => NOW,
      env: {},
    };
    const started = performance.now();
    const code = await main(["status", "--wait", "3000", START], io);
    const ms = Math.round(performance.now() - started);
    writeFileSync(
      join(import.meta.dirname, "results", "wait-queued.txt"),
      `wait ${START} with start-spawned queued: exit ${code} after ${ms} ms\n  last line: ${stdout.trimEnd().split("\n").at(-1)}\n`,
    );
    expect(code).toBe(0);
  }, 60_000);
});
