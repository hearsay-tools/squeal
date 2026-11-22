import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { markScanned } from "../../src/core/daemon/bootstrapped.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { recordRekeyed } from "../../src/core/scheduler/rekeyed-record.js";
import { createStateSink } from "../../src/core/state/sink.js";
import type { EnsureDaemonResult } from "../../src/core/types/daemon.js";
import { type Consumer, MAIN_AGENT } from "../../src/core/types/delivery.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { PolicyFile } from "../../src/core/types/policy.js";
import type { StateSink } from "../../src/core/types/state.js";
import type { Store } from "../../src/core/types/store.js";
import type { ResultRecord } from "../../src/core/types/store-records.js";
import { workerDeps } from "../../src/harness/pi/worker.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { CODE_OFF } from "../helpers/policy.js";
import { check, result, setKey } from "../state/helpers.js";
import { type FakeRepo, fakeRepo, seedStore } from "../status/helpers.js";

export const SESSION = "6248afa0-bd5b-459c-83da-3a7cc9d9f9a0";
export const SUBAGENT = "a54374d4ee2bc54fb";
export const FILE: TestFileRef = { project: "", path: "src/math.test.ts" };
export const ADDS = check("math > adds", FILE);
export const SUBTRACTS = check("math > subtracts", FILE);

/** Reads a recorded hook input and points its `cwd` at `cwd`. */
export function recorded(name: string, cwd: string, overrides: object = {}): string {
  const path = join(import.meta.dirname, "recorded", `${name}.json`);
  const input = JSON.parse(readFileSync(path, "utf8")) as object;
  return JSON.stringify({ ...input, cwd, ...overrides });
}

/** What a Claude Code, Codex or Antigravity hook delivered as context; `""` for no output. */
export function hookText(out: string | { readonly stdout: string }): string {
  const stdout = typeof out === "string" ? out : out.stdout;
  if (stdout === "") return "";
  const json = JSON.parse(stdout) as {
    hookSpecificOutput?: { additionalContext?: string };
    injectSteps?: { systemMessage: { systemMessage: string } }[];
    reason?: string;
  };
  if (json.hookSpecificOutput !== undefined)
    return json.hookSpecificOutput.additionalContext as string;
  // Antigravity (spec 024 D3): an injected system message, or a deny or continue reason.
  const text = json.injectSteps?.[0]?.systemMessage.systemMessage ?? json.reason;
  if (text === undefined) throw new Error(`no hook text in ${stdout}`);
  return text;
}

/**
 * A daemon start that does not end before the hook's deadline: `ensureDaemon` resolves
 * `"spawned"` only on `release`; `asked` is whether a hook called it.
 */
export function hangingEnsure(): {
  readonly ensureDaemon: NonNullable<HookDeps["ensureDaemon"]>;
  readonly release: () => void;
  readonly asked: () => boolean;
} {
  let release = () => {};
  let asked = false;
  const ensureDaemon = () => {
    asked = true;
    return new Promise<EnsureDaemonResult>((resolve) => {
      release = () => resolve("spawned");
    });
  };
  return { ensureDaemon, release: () => release(), asked: () => asked };
}

/** Pi's worker deps, with a daemon found alive unless `overrides` say otherwise. */
export const piDeps = (overrides: Partial<HookDeps> = {}): HookDeps => ({
  ...workerDeps(new URL("file:///pkg/dist/worker.mjs")),
  env: {},
  ensureDaemon: async () => "alive",
  ...overrides,
});

/** A fixture repository with a Squeal store, a registered worktree and one keyed test file. */
export interface SquealRepo {
  readonly repo: FakeRepo;
  readonly root: string;
  readonly worktreeId: string;
  readonly store: Store;
  readonly sink: StateSink;
  consumer(agentId?: string): Consumer;
  /** Applies results at the next revision, as the daemon would after a run. */
  apply(...results: ResultRecord[]): void;
  /**
   * An edit at the next revision gives `FILE` the key `key` and queues its
   * re-run, so its checks are pending; the next `apply` with results is that
   * run, under `key`.
   */
  queue(key: string): void;
  /**
   * The re-run of `FILE` the daemon queues at its key after a new failure
   * (001-171): its row is pending again, its checks stay current.
   */
  confirm(): void;
  pass(c?: typeof ADDS): ResultRecord;
  fail(c?: typeof ADDS, message?: string): ResultRecord;
  policy(policy: PolicyFile): void;
  /**
   * The daemon record hooks judge liveness by: `alive` (the default, a heartbeat
   * now with an hour's interval), `stale` (heartbeat at `staleSince`), `none`
   * (no daemon ever ran: no record and no last heartbeat).
   */
  daemon(state: "alive" | "stale" | "none", staleSince?: number): void;
}

export function squealRepo(repo: FakeRepo = fakeRepo()): SquealRepo {
  const store = seedStore(repo);
  const worktreeId = repo.mainId;
  const row = {
    id: worktreeId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  };
  store.worktrees.upsert(row);
  setKey(store, "k1", { file: FILE, worktreeId });
  // `none`: no daemon ever ran, so no last heartbeat either (`setDaemon(null)` would keep it).
  const daemon: SquealRepo["daemon"] = (state, staleSince = 1) => {
    if (state === "none") return store.worktrees.upsert(row);
    // A daemon past its start scan: a registration may be told "none of the files changed here" (001-96).
    markScanned(store, worktreeId, 1);
    store.worktrees.setDaemon(worktreeId, {
      // Nobody listens here; the hooks' socket probe falls back to the runtime dir.
      socketPath: `/tmp/squeal-test-${worktreeId}.sock`,
      startedAt: 1,
      heartbeatAt: state === "alive" ? Date.now() : staleSince,
      heartbeatIntervalMs: state === "alive" ? 3_600_000 : 5_000,
      squealVersion: "0.0.0-test",
    });
  };
  daemon("alive");
  const sink = createStateSink(store);
  let revision = 0;
  let key = "k1";
  let queued = false;
  const options = () => ({ key, worktreeId, revision });
  const keyRow = (pending: "queued" | null) =>
    store.testFileKeys.upsertMany([{ worktreeId, testFile: FILE, key, revision, pending }]);
  // The scheduler's re-key record (task 001-238): open from the edit until its run lands.
  let open: number | null = null;
  const rekeyed = (moved: number | null) =>
    recordRekeyed(store, worktreeId, [{ id: testFileId(FILE), open, moved }], []);
  return {
    repo,
    root: repo.main,
    worktreeId,
    store,
    sink,
    consumer: (agentId = MAIN_AGENT) => ({ worktreeId, sessionId: SESSION, agentId }),
    apply(...results) {
      revision++;
      store.transaction(() =>
        store.revisions.append({
          worktreeId,
          createdAt: revision,
          head: null,
          dirty: true,
          trigger: "watch",
          changes: [{ path: "src/math.ts", oldHash: null, newHash: `h${revision}` }],
        }),
      );
      // The scheduler's order: results under their key first, then the sink.
      store.transaction(() => store.results.putMany(results));
      if (queued && results.length > 0) {
        queued = false;
        keyRow(null);
        open = null;
        rekeyed(null);
      }
      sink.applyResults(worktreeId, revision, results, { checkpointId: null });
    },
    queue(next) {
      this.apply();
      key = next;
      queued = true;
      keyRow("queued");
      open ??= revision;
      rekeyed(revision);
      sink.refresh(worktreeId, revision, { checkpointId: null });
    },
    confirm() {
      keyRow("queued");
    },
    pass: (c = ADDS) => result(c, "pass", options()),
    fail: (c = ADDS, message = "expected 3 to be 4") =>
      result(c, "fail", { ...options(), message }),
    policy(policy) {
      // Row 015-64: the code features stay off unless the policy names them.
      const code = "complexity" in policy || "coverage" in policy ? {} : CODE_OFF;
      writeFileSync(join(repo.main, "squeal.config.json"), JSON.stringify({ ...code, ...policy }));
    },
    daemon,
  };
}
