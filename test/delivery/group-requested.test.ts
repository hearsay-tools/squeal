import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { formatDelta } from "../../src/core/delivery/format.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { publishPromotions } from "../../src/core/scheduler/promotions-row.js";
import { createStateSink } from "../../src/core/state/sink.js";
import type { EpochMs } from "../../src/core/types/common.js";
import type { Consumer, Delta, HarnessDelivery } from "../../src/core/types/delivery.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { StateSink } from "../../src/core/types/state.js";
import type { Store } from "../../src/core/types/store.js";
import { additionalContext } from "../../src/harness/claude-code/hook.js";
import type { HookInput } from "../../src/harness/claude-code/input.js";
import { check, freshStore, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Row 023-67 (dogfood round 8, X2): the hook after a `status --at … --run`
 * that queued a request-only group's files. All 10 round 8 s1 sessions got
 * "browser: 97 test files; 97 pending, waiting for `squeal run browser`.
 * Squeal runs them only on request" from the hook after their first call
 * had queued the 97. The line now says they are queued, and goes out again
 * when a request queues a group the hook last told as waiting.
 */

const BROWSER_FILE: TestFileRef = { project: "", path: "test/browser/a.test.ts" };
const FAST: TestFileRef = { project: "", path: "src/a.test.ts" };
const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const UNIT = check("unit", FAST);
const POLICY = {
  checks: [
    {
      name: "browser",
      runner: "vitest",
      tests: ["test/browser/**"],
      at: "manual",
      limits: { maxParallel: 1 },
    },
  ],
};

let root: string;
let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;
let outcome: "pass" | "fail" = "pass";

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "squeal-023-67-"));
  writeFileSync(join(root, "squeal.config.json"), JSON.stringify(POLICY));
  store = freshStore();
  store.worktrees.upsert({
    id: WT,
    root,
    commonDir: join(root, ".git"),
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  liveDaemon(store, WT);
  sink = createStateSink(store);
  delivery = createDelivery(store, { status: fixedStatus() });
  setKey(store, "u1", { file: FAST });
  outcome = "pass";
  apply(result(UNIT, "pass", { key: "u1" }));
  await delivery.register(C1, { atStart: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function revision(): number {
  return store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path: "src/x.ts", oldHash: null, newHash: "h" }],
  }).number;
}

function apply(...results: ReturnType<typeof result>[]): void {
  const at = revision();
  store.results.putMany(results);
  sink.applyResults(WT, at, results, { checkpointId: null });
}

/** A unit result flips, so the next tool boundary has news to carry. */
function flipUnit(): void {
  outcome = outcome === "pass" ? "fail" : "pass";
  apply(result(UNIT, outcome, { key: "u1" }));
}

/** The browser file queued; with `requested`, in a batch the daemon publishes, as a narrow request's. */
function queueBrowser(requested: boolean): void {
  setKey(store, "b1", { file: BROWSER_FILE, pending: "queued" });
  if (requested) {
    const files = [testFileId(BROWSER_FILE)];
    const live = [{ files, until: Date.now() as EpochMs, batch: { files, estimatedEnd: null } }];
    publishPromotions(store, WT, live, Date.now() as EpochMs);
  }
  sink.refresh(WT, revision(), { checkpointId: null });
}

/** The tool boundary's delivery as the PostToolBatch hook writes it: its JSON on stdout. */
async function hook(): Promise<{ delta: Delta; json: string }> {
  const delta = await delivery.onToolBoundary(C1);
  if (delta === null) throw new Error("no delta");
  const input = { hook_event_name: "PostToolBatch" } as HookInput;
  return { delta, json: JSON.stringify(additionalContext(input, formatDelta(delta)).output) };
}

/** The groups the evals parser reads as waiting for their run (`squeal-text.mjs`, `waitingOf`). */
const waitingIn = (text: string): string[] =>
  (squealEvidence(text, "push") as { waiting?: string[] } | null)?.waiting ?? [];

const browserLine = (json: string) =>
  (JSON.parse(json).hookSpecificOutput.additionalContext as string)
    .split("\n")
    .find((line) => line.startsWith("browser:"));

describe("the hook's line for a request-only group a request queued (row 023-67, X2)", () => {
  it("reads as queued, and the evals parser sees no wait for `squeal run browser`", async () => {
    queueBrowser(true);
    flipUnit();
    const { delta, json } = await hook();
    expect(delta.groupTiersChanged).toEqual(["browser"]);
    expect(browserLine(json)).toBe(
      "browser: 1 test file; 1 queued by a request (`squeal status --at <commit> --run` or `squeal run browser <path>...`). Squeal runs them now; `squeal run browser --wait 60000` waits for its result.",
    );
    expect(json).not.toContain("only on request");
    expect(waitingIn(json)).not.toContain("browser");
  });

  it("is told again when a request queues a group last told as waiting for its run", async () => {
    queueBrowser(false);
    flipUnit();
    const waiting = await hook();
    expect(browserLine(waiting.json)).toContain("waiting for `squeal run browser`");
    expect(waitingIn(waiting.json)).toContain("browser");
    queueBrowser(true);
    flipUnit();
    const queued = await hook();
    expect(queued.delta.groupTiersChanged).toEqual(["browser"]);
    expect(browserLine(queued.json)).toMatch(/^browser: 1 test file; 1 queued by a request /);
  });
});
