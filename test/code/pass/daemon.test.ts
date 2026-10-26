import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { readRecount } from "../../../src/core/code/pass/index.js";
import {
  type CodeStore,
  codeStorePath,
  isCodeStoreOpenFailure,
  openCodeStore,
} from "../../../src/core/code/store/index.js";
import { startDaemon } from "../../../src/core/daemon/daemon.js";
import { readHeader } from "../../../src/core/delivery/index.js";
import {
  createFixtureRepo,
  type FixtureRepo,
  SLOW,
  waitFor,
  withStore,
} from "../../daemon/helpers.js";
import { policyOn } from "./helpers.js";

/** A function of CC 22 by ESLint's classic rule: 1 plus 21 `if`s. */
const BRANCHY = `export function branchy(x: number): number {\n${Array.from(
  { length: 21 },
  (_, i) => `  if (x === ${i}) return ${i};\n`,
).join("")}  return -1;\n}\n`;

const latest = (repo: FixtureRepo) =>
  withStore(repo, (store) => store.revisions.latest(repo.worktreeId)?.number ?? 0);

/** `fn` over the code store as a reader opens it; `null` while it does not exist. */
function read<T>(repo: FixtureRepo, fn: (store: CodeStore) => T): T | null {
  const store = openCodeStore(repo.commonDir, policyOn(), { create: false });
  if (isCodeStoreOpenFailure(store)) return null;
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

describe("the daemon's code pass (015 goal 1, D4)", SLOW, () => {
  it("creates no code store while complexity is off, and counts once a revision switches it on", async () => {
    const repo = createFixtureRepo();
    onTestFinished(repo.cleanup);
    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(async () => {
      await daemon.stop("stop-requested");
    });
    await daemon.ready;
    await waitFor(
      () => withStore(repo, (store) => readHeader(store, repo.worktreeId).counts.pending === 0),
      60_000,
      "the baseline done",
    );
    const before = latest(repo);
    appendFileSync(join(repo.root, "src/math.ts"), "\nexport const edited = 1;\n");
    await waitFor(() => latest(repo) > before, 30_000, "the edit's revision");
    expect(existsSync(codeStorePath(repo.commonDir))).toBe(false);

    writeFileSync(
      join(repo.root, "squeal.config.json"),
      `${JSON.stringify({ complexity: { enabled: true }, coverage: { enabled: false } })}\n`,
    );
    const first = await waitFor(
      () => read(repo, (store) => readRecount(store.meta, repo.worktreeId)),
      30_000,
      "the first count",
    );
    expect(first.reason).toBe("first");
    // Test files and the gitignored generated file are not counted (D1).
    expect(read(repo, (store) => store.files.list(repo.worktreeId).map((f) => f.path))).toEqual([
      "src/math.ts",
      "src/strings.ts",
      "vitest.config.ts",
    ]);

    writeFileSync(join(repo.root, "src/branchy.ts"), BRANCHY);
    const branchy = {
      kind: "code",
      path: "src/branchy.ts",
      qualifiedName: "branchy",
      occurrence: 0,
    } as const;
    const history = await waitFor(
      () => {
        const found = read(repo, (store) => store.transitions.history(repo.worktreeId, branchy));
        return found !== null && found.length > 0 && found;
      },
      30_000,
      "the first-seen fail",
    );
    expect(history.map((t) => `${t.kind} ${t.toValue} ${t.threshold}`)).toEqual([
      "first-seen-fail 22 20",
    ]);
  });
});
