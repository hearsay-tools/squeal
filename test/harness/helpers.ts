import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createStateSink } from "../../src/core/state/index.js";
import {
  type Consumer,
  MAIN_AGENT,
  type PolicyFile,
  type ResultRecord,
  type StateSink,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
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

export function squealRepo(): SquealRepo {
  const repo = fakeRepo();
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
  const daemon: SquealRepo["daemon"] = (state, staleSince = 1) =>
    state === "none"
      ? store.worktrees.upsert(row)
      : store.worktrees.setDaemon(worktreeId, {
          // Nobody listens here; the hooks' socket probe falls back to the runtime dir.
          socketPath: `/tmp/squeal-test-${worktreeId}.sock`,
          startedAt: 1,
          heartbeatAt: state === "alive" ? Date.now() : staleSince,
          heartbeatIntervalMs: state === "alive" ? 3_600_000 : 5_000,
          squealVersion: "0.0.0-test",
        });
  daemon("alive");
  const sink = createStateSink(store);
  let revision = 0;
  let key = "k1";
  let queued = false;
  const options = () => ({ key, worktreeId, revision });
  const keyRow = (pending: "queued" | null) =>
    store.testFileKeys.upsertMany([{ worktreeId, testFile: FILE, key, revision, pending }]);
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
      }
      sink.applyResults(worktreeId, revision, results, { checkpointId: null });
    },
    queue(next) {
      this.apply();
      key = next;
      queued = true;
      keyRow("queued");
      sink.refresh(worktreeId, revision, { checkpointId: null });
    },
    pass: (c = ADDS) => result(c, "pass", options()),
    fail: (c = ADDS, message = "expected 3 to be 4") =>
      result(c, "fail", { ...options(), message }),
    policy(policy) {
      writeFileSync(join(repo.main, "squeal.config.json"), JSON.stringify(policy));
    },
    daemon,
  };
}
