import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groupsQuietText } from "../../src/cli/status-wait-groups.js";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { formatDelta } from "../../src/core/delivery/format.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import { createStatusBuilder } from "../../src/core/status/snapshot.js";
import type { EpochMs, WorktreeId } from "../../src/core/types/common.js";
import type { Consumer } from "../../src/core/types/delivery.js";
import type { StatusSnapshot } from "../../src/core/types/status.js";
import { additionalContext } from "../../src/harness/claude-code/hook.js";
import type { HookInput } from "../../src/harness/claude-code/input.js";
import type { CatchUpFile, CatchUpSide } from "../scheduler/catch-up-fixture.js";
import { BROWSER, heldSide } from "../scheduler/held-side-fixture.js";

/*
 * Review 0.1.610 B1 (row 023-67): status says a request queued a held
 * group's file, and that Squeal runs it now, only when a run request
 * released it. A plain named wait (`squeal status --wait <path>`) batches
 * the file but runs no file of a `manual` group, so after it the file
 * still waits for `squeal run browser`. A real scheduler makes both
 * states; the hook's JSON, plain status and `status --wait` read them
 * through their real formatters.
 */

const PATH = "test/browser/a.test.ts";
const FILES: readonly CatchUpFile[] = [{ path: PATH, ms: 10, imports: ["src/a.ts"] }];
const REF = { project: "", path: PATH };

/** The side's three texts: plain status, the hook's context at the next tool boundary, `status --wait`'s. */
async function texts(side: CatchUpSide, told: () => Promise<string>) {
  const result = await createStatusBuilder(side.store).build(side.worktreeId as WorktreeId);
  const plain = formatStatus(result, Date.now() as EpochMs);
  const wait = groupsQuietText(result as StatusSnapshot, "squeal");
  return { plain, hook: await told(), wait };
}

/**
 * A held side whose file an edit queued, with two consumers the hook tells
 * (`told(session)`). A group's kind alone is no news at a tool boundary, so
 * each consumer's first boundary, which carries the edit, reads one state.
 */
async function edited() {
  const { side, gate } = await heldSide(FILES);
  writeFileSync(join(side.root, "squeal.config.json"), JSON.stringify({ checks: [BROWSER] }));
  const delivery = createDelivery(side.store, { status: createStatusBuilder(side.store) });
  const consumerOf = (sessionId: string): Consumer => ({
    worktreeId: side.worktreeId as WorktreeId,
    sessionId,
    agentId: "main",
  });
  for (const session of ["s1", "s2"])
    await delivery.register(consumerOf(session), { atStart: true });
  await side.edit("watch", "src/a.ts");
  await side.rest();
  expect(side.runner.runs).toHaveLength(0);
  const told = (session: string) => async () => {
    const delta = await delivery.onToolBoundary(consumerOf(session));
    if (delta === null) return "";
    const input = { hook_event_name: "PostToolBatch" } as HookInput;
    // The PostToolBatch hook's stdout, read back as the agent's harness reads it.
    const json = JSON.stringify(additionalContext(input, formatDelta(delta)).output);
    return JSON.parse(json).hookSpecificOutput.additionalContext as string;
  };
  return { side, gate, told };
}

const WAITING =
  "browser: 1 test file; 1 pending, waiting for `squeal run browser`. Squeal runs them only on request; `squeal run browser --wait 60000` runs it now and waits for its result.";
const RUNS_NOW = /Squeal runs (them|it) now/;

/** Nothing in `out` says a request queued the file or that Squeal runs it now. */
function expectHeld(out: { plain: string; hook: string; wait: string }): void {
  expect(out.plain.split("\n")).toContain(WAITING);
  expect(out.hook).toContain(WAITING);
  expect(out.wait).toContain("Squeal runs it only on request");
  expect(out.wait).toContain(
    "`squeal run browser --wait 60000` runs it now and waits for its result",
  );
  for (const text of [out.plain, out.hook, out.wait]) {
    expect(text).not.toMatch(RUNS_NOW);
    expect(text).not.toContain("queued by a request");
    expect(text).not.toContain("a request queued");
  }
}

/** Each text says Squeal runs the requested file now, and the hook's title that the group is queued. */
function expectRequested(out: { plain: string; hook: string; wait: string }): void {
  for (const text of [out.plain, out.hook]) {
    expect(text).toMatch(
      /^browser: 1 test file; .*\. Squeal runs them now; `squeal run browser --wait 60000` waits for its result\.$/m,
    );
    expect(text).not.toContain("only on request");
  }
  expect(out.hook).toContain("browser group queued");
  expect(out.wait).toContain("a request queued the pending ones: Squeal runs it now");
  expect(out.wait).not.toContain("only on request");
}

describe("a held group's file after a named wait vs a run request (review 0.1.610 B1)", {
  timeout: 60_000,
}, () => {
  it("after a named wait still waits for `squeal run browser`, and runs once a narrow run asks", async () => {
    const { side, gate, told } = await edited();
    // `squeal status --wait <path>`: its batch orders the queue; the manual group holds the file.
    await side.scheduler.promote([REF], 60_000);
    await side.rest();
    expect(side.runner.runs).toHaveLength(0);
    expectHeld(await texts(side, told("s1")));
    // A run request for the same file, already in the wait's batch, releases it.
    await side.scheduler.requestGroupPaths?.("browser", [PATH]);
    await expect.poll(() => side.runner.runs.length, { timeout: 20_000 }).toBe(1);
    expectRequested(await texts(side, told("s2")));
    gate.stop();
  });

  it("after a narrow run request says a request queued it and Squeal runs it now", async () => {
    const { side, gate, told } = await edited();
    await side.scheduler.requestGroupPaths?.("browser", [PATH]);
    await expect.poll(() => side.runner.runs.length, { timeout: 20_000 }).toBe(1);
    expectRequested(await texts(side, told("s1")));
    gate.stop();
  });
});
