import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeStorePath } from "../../src/core/code/store/open.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { Delta } from "../../src/core/types/delivery.js";
import { openContext } from "../../src/harness/shared/context.js";
import {
  type CodeRepo,
  codeRepo,
  codeState,
  codeTransition,
  fn,
  fnCheck,
  putCursor,
  putFile,
  TIERS,
} from "../code/delivery/helpers.js";
import { setKey } from "../state/helpers.js";
import { open } from "../store/helpers.js";

/*
 * Spec 021 D3 (row 021-09): a hook's delivery waits for a busy code store
 * before it takes the main store's write lock, never inside its hold. A code
 * part the code store's lock still keeps from it is not told, and the next
 * boundary tells it (row 011-288: told only once the host has it).
 */

const register = fileURLToPath(new URL("../store/child/register-ts.mjs", import.meta.url));
const holder = fileURLToPath(new URL("./child/code-holder.ts", import.meta.url));

/** A store hold longer than this, while the daemon holds the code store, fails a probe. */
const PROBE_MS = 150;
const SELECT = fnCheck("selectTier");

interface Probes {
  readonly free: number;
  readonly busy: number;
}

/** The daemon of `code-holder.ts`; `done` resolves with its probes once it committed. */
async function holdCode(dir: string, holdMs: number): Promise<{ done: Promise<Probes> }> {
  const child = spawn(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--import",
      register,
      holder,
      codeStorePath(dir),
      storePaths(dir).database,
      String(holdMs),
      String(PROBE_MS),
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  let out = "";
  const done = new Promise<Probes>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`code-holder exited ${code}: ${out}`));
      else resolve(JSON.parse(out.trim().split("\n").at(-1) ?? "") as Probes);
    });
  });
  await new Promise<void>((resolve) => {
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      out += chunk;
      if (out.includes("held\n")) resolve();
    });
  });
  return { done };
}

/** A repository whose consumer registered with `selectTier` at 18, then saw it go to 23. */
async function owedCodeNews(): Promise<CodeRepo> {
  const repo = codeRepo();
  const wt = worktreeIdFor(repo.root);
  setKey(open(repo.dir), "k1", { worktreeId: wt });
  const count = (cc: number) => {
    putFile(repo.store, wt, TIERS, [fn("selectTier", cc, 120)]);
    repo.store.states.upsertMany([codeState(wt, SELECT, cc)]);
    putCursor(repo.store, wt);
  };
  count(18);
  await hook(repo, 10_000, (context) => context.delivery.register(context.consumer));
  count(23);
  repo.store.transitions.append([
    codeTransition(wt, SELECT, "pass-to-fail", { from: 18, to: 23, at: Date.now() }),
  ]);
  return repo;
}

/** One hook process: its context, `fn`, then the hand-off's commit. */
async function hook<T>(
  repo: CodeRepo,
  busyTimeoutMs: number,
  fn: (context: NonNullable<ReturnType<typeof openContext>>) => Promise<T>,
): Promise<T> {
  const context = openContext(
    { session_id: "s1" },
    { root: repo.root, commonDir: repo.dir },
    { busyTimeoutMs, prepare: true },
  );
  if (context === null) throw new Error("no context");
  try {
    const result = await fn(context);
    context.prepared?.commit();
    return result;
  } finally {
    context.close();
  }
}

const boundary = (repo: CodeRepo, busyTimeoutMs: number): Promise<Delta | null> =>
  hook(repo, busyTimeoutMs, (context) => context.delivery.onToolBoundary(context.consumer));

describe("a hook beside a daemon that holds the code store (spec 021 D3)", () => {
  it("waits for the code store holding no store lock, then tells its code news", async () => {
    const repo = await owedCodeNews();
    const daemon = await holdCode(repo.dir, 800);
    const started = performance.now();
    const delta = await boundary(repo, 10_000);
    const waited = performance.now() - started;
    const probes = await daemon.done;
    expect(probes.busy).toBe(0);
    expect(probes.free).toBeGreaterThan(0);
    // It told the code part, which it could write only after the daemon committed.
    expect(waited).toBeGreaterThanOrEqual(200);
    expect(delta?.code?.entries.map((e) => e.check.qualifiedName)).toEqual(["selectTier"]);
  });

  it("past its bound, tells no code part, holds no store lock, and the next boundary tells it", async () => {
    const repo = await owedCodeNews();
    const daemon = await holdCode(repo.dir, 1_500);
    const delta = await boundary(repo, 300);
    expect(delta?.code ?? null).toBeNull();
    const probes = await daemon.done;
    expect(probes.busy).toBe(0);
    const later = await boundary(repo, 300);
    expect(later?.code?.entries.map((e) => e.check.qualifiedName)).toEqual(["selectTier"]);
  });
});
