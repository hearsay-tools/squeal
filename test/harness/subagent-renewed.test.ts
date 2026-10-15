import { describe, expect, it, vi } from "vitest";
import {
  createDelivery,
  dropLeft,
  leavingMarks,
  markLeaving,
} from "../../src/core/delivery/index.js";
import { slot } from "../../src/core/delivery/slots.js";
import { readTurn, resumeTurn, startTurn } from "../../src/core/delivery/turn.js";
import { storePaths } from "../../src/core/store/index.js";
import { LEAVING_GRACE_MS } from "../../src/core/types/index.js";
import { type HookDeps, type HookName, runHook } from "../../src/harness/claude-code/index.js";
import { fixedStatus } from "../delivery/fakes.js";
import { recorded, type SquealRepo, SUBAGENT, squealRepo } from "./helpers.js";

/*
 * Review 001-423, B1: a SubagentStop killed after its mark leaves the mark
 * behind. Its subagent registered again, or calling a tool that is not a
 * denied edit, went on under that old mark, so the daemon dropped it at the
 * old mark's grace while it worked. Its registration and every PreToolUse
 * now clear the mark, in the transaction that registers or resumes it.
 */

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const CHILD = { agent_id: SUBAGENT, agent_type: "general-purpose" };
const BASH = { tool_name: "Bash", tool_input: { command: "sleep 15" } };
const READ = { tool_name: "Read", tool_input: { file_path: "/repo/src/math.ts" } };
const EDIT = {};

const hook = (name: HookName, r: SquealRepo, overrides: object = {}, input: string = name) =>
  runHook(name, recorded(input, r.root, overrides), deps);
const subagentStart = (r: SquealRepo) => hook("session-start", r, {}, "subagent-start");

const marked = (r: SquealRepo) =>
  leavingMarks(r.store, r.worktreeId).get(slot(r.consumer(SUBAGENT)));

/** After the old mark's grace: the consumers `dropLeft` removes. */
const dropAfterGrace = (r: SquealRepo, markedAt: number) =>
  dropLeft(r.store, r.worktreeId, markedAt + LEAVING_GRACE_MS + 1, {
    locksDir: storePaths(r.repo.commonDir).locksDir,
  });

/** The main agent and a subagent registered; the subagent's SubagentStop killed after its mark. */
async function leftMarked(turn: "in-turn" | "idle"): Promise<{ r: SquealRepo; at: number }> {
  const r = squealRepo();
  r.apply(r.pass());
  await hook("session-start", r);
  await subagentStart(r);
  const child = r.consumer(SUBAGENT);
  if (turn === "in-turn") r.store.transaction(() => startTurn(r.store, child));
  else await createDelivery(r.store, { status: fixedStatus() }).endTurn(child);
  const at = Date.now();
  r.store.transaction(() => markLeaving(r.store, child, at));
  expect(readTurn(r.store, child).turn).toBe(turn);
  expect(marked(r)).toBe(at);
  return { r, at };
}

function bothRegistered(r: SquealRepo): void {
  expect(r.store.consumers.get(r.consumer())).not.toBeNull();
  expect(r.store.consumers.get(r.consumer(SUBAGENT))).not.toBeNull();
}

describe("a subagent left marked by a killed SubagentStop (review 001-423, B1)", () => {
  it.each(["in-turn", "idle"] as const)(
    "registered again (%s), stays registered past the old mark's grace",
    async (turn) => {
      const { r, at } = await leftMarked(turn);
      await subagentStart(r);
      expect(marked(r)).toBeUndefined();
      expect(dropAfterGrace(r, at)).toEqual([]);
      bothRegistered(r);
    },
  );

  it.each([
    ["Bash", "in-turn", BASH],
    ["Bash", "idle", BASH],
    ["Read", "in-turn", READ],
    ["Read", "idle", READ],
  ] as const)(
    "calling %s (%s), stays registered past the old mark's grace and is in a turn",
    async (_, turn, tool) => {
      const { r, at } = await leftMarked(turn);
      await hook("pre-tool-use", r, { ...CHILD, ...tool });
      expect(marked(r)).toBeUndefined();
      expect(readTurn(r.store, r.consumer(SUBAGENT)).turn).not.toBe("idle");
      expect(dropAfterGrace(r, at)).toEqual([]);
      bothRegistered(r);
    },
  );

  it.each([
    ["on", true],
    ["off", false],
  ] as const)(
    "editing with interrupt.onRegression %s, stays registered past the old mark's grace",
    async (_, onRegression) => {
      const { r, at } = await leftMarked("idle");
      r.policy({ interrupt: { onRegression } });
      await hook("pre-tool-use", r, { ...CHILD, ...EDIT });
      expect(marked(r)).toBeUndefined();
      expect(dropAfterGrace(r, at)).toEqual([]);
      bothRegistered(r);
    },
  );

  it("is still dropped after the grace when nothing of it is heard again, the main agent kept", async () => {
    const { r, at } = await leftMarked("in-turn");
    await hook("pre-tool-use", r, BASH);
    expect(dropAfterGrace(r, at)).toEqual([r.consumer(SUBAGENT)]);
    expect(r.store.consumers.get(r.consumer())).not.toBeNull();
  });
});

describe("resumeTurn", () => {
  it("takes no write lock for a consumer in a turn and not marked leaving", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await subagentStart(r);
    r.store.transaction(() => startTurn(r.store, r.consumer(SUBAGENT)));
    const transaction = vi.spyOn(r.store, "transaction");
    resumeTurn(r.store, r.consumer(SUBAGENT));
    expect(transaction).not.toHaveBeenCalled();
  });
});
