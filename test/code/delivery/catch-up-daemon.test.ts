import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { main } from "../../../src/cli/main.js";
import {
  type CodeStore,
  isCodeStoreOpenFailure,
  openCodeStore,
} from "../../../src/core/code/store/index.js";
import { startDaemon } from "../../../src/core/daemon/daemon.js";
import { type HookDeps, runHook } from "../../../src/harness/claude-code/index.js";
import {
  createFixtureRepo,
  type FixtureRepo,
  SLOW,
  waitFor,
  withStore,
} from "../../daemon/helpers.js";
import { recorded, SESSION } from "../../harness/helpers.js";
import { ON } from "../helpers.js";

/*
 * Lessons round 1, P2 (sq2), end to end: the daemon stops, a function goes
 * from 20 to 21 while none runs, a session registers before the next
 * daemon's start scan, then edits another file. Real daemons, the real
 * counter, the Claude Code hooks.
 */

/** A function of CC `cc` by ESLint's classic rule: 1 plus one `if` per point. */
const branchy = (cc: number) =>
  `export function branchy(x: number): number {\n${Array.from(
    { length: cc - 1 },
    (_, i) => `  if (x === ${i}) return ${i};\n`,
  ).join("")}  return -1;\n}\n`;

function read<T>(repo: FixtureRepo, fn: (store: CodeStore) => T): T | null {
  const store = openCodeStore(repo.commonDir, ON, { create: false });
  if (isCodeStoreOpenFailure(store)) return null;
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

/** `branchy`'s complexity in the code store, once it is counted at `cc`. */
const countedAt = (repo: FixtureRepo, cc: number) =>
  read(repo, (store) =>
    store.states
      .list(repo.worktreeId, { measure: "complexity" })
      .some((s) => s.check.qualifiedName === "branchy" && s.value === cc),
  ) === true;

async function daemon(repo: FixtureRepo) {
  const started = await startDaemon({ root: repo.root, env: repo.env });
  if ("reason" in started) throw new Error(started.message);
  await started.ready;
  return started;
}

async function cli(repo: FixtureRepo, args: string[]): Promise<unknown> {
  let out = "";
  await main(args, {
    stdout: (t) => {
      out += t;
    },
    stderr: () => {},
    cwd: repo.root,
    env: { CLAUDE_CODE_SESSION_ID: SESSION },
  });
  return JSON.parse(out);
}

const contextOf = (stdout: string): string =>
  (JSON.parse(stdout || "{}") as { hookSpecificOutput?: { additionalContext?: string } })
    .hookSpecificOutput?.additionalContext ?? "";

describe("a change made while no daemon ran, end to end (lessons round 1, P2)", SLOW, () => {
  it("tells the session no FAIL for it, and its view and status count as squeal code", async () => {
    const repo = createFixtureRepo({
      files: {
        "squeal.config.json": `${JSON.stringify({ complexity: { enabled: true } })}\n`,
        "src/branchy.ts": branchy(20),
      },
    });
    onTestFinished(repo.cleanup);
    const deps: HookDeps = { env: repo.env, ensureDaemon: async () => "alive" };

    const first = await daemon(repo);
    await waitFor(() => countedAt(repo, 20), 60_000, "branchy counted at 20");
    await first.stop("stop-requested");

    writeFileSync(join(repo.root, "src/branchy.ts"), branchy(21));
    await runHook("session-start", recorded("session-start", repo.root), deps);
    const second = await daemon(repo);
    onTestFinished(async () => {
      await second.stop("stop-requested");
    });
    await waitFor(() => countedAt(repo, 21), 60_000, "branchy counted at 21");

    const before = withStore(repo, (store) => store.revisions.latest(repo.worktreeId)?.number ?? 0);
    appendFileSync(join(repo.root, "src/math.ts"), "\nexport const edited = 1;\n");
    await waitFor(
      () =>
        read(repo, (store) =>
          store.files.list(repo.worktreeId, ["src/math.ts"]).some((f) => f.revision > before),
        ) === true,
      60_000,
      "the edit counted",
    );
    const batch = await runHook("post-tool-batch", recorded("post-tool-batch", repo.root), deps);
    expect(contextOf(batch.stdout)).not.toContain("complexity: branchy");

    const consumer = { worktreeId: repo.worktreeId, sessionId: SESSION, agentId: "main" };
    const listed = (await cli(repo, ["code", "--json"])) as {
      functions: { qualifiedName: string }[];
    };
    expect(listed.functions.map((f) => f.qualifiedName)).toEqual(["branchy"]);
    expect(
      read(repo, (store) => store.views.list(consumer).map((v) => v.check.qualifiedName)),
    ).toEqual(["branchy"]);
    const status = (await cli(repo, ["status", "--json"])) as { code?: object };
    expect(status.code).toMatchObject({ over: 1, sinceRegistration: 0, since: "session" });
  });
});
