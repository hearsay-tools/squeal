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
  pass(c?: typeof ADDS): ResultRecord;
  fail(c?: typeof ADDS, message?: string): ResultRecord;
  policy(policy: PolicyFile): void;
}

export function squealRepo(): SquealRepo {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const worktreeId = repo.mainId;
  store.worktrees.upsert({
    id: worktreeId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  setKey(store, "k1", { file: FILE, worktreeId });
  const sink = createStateSink(store);
  let revision = 0;
  const options = () => ({ key: "k1", worktreeId, revision });
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
      sink.applyResults(worktreeId, revision, results, { checkpointId: null });
    },
    pass: (c = ADDS) => result(c, "pass", options()),
    fail: (c = ADDS, message = "expected 3 to be 4") =>
      result(c, "fail", { ...options(), message }),
    policy(policy) {
      writeFileSync(join(repo.main, "squeal.config.json"), JSON.stringify(policy));
    },
  };
}
