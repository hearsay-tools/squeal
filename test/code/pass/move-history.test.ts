import { beforeEach, describe, expect, it } from "vitest";
import { readCodeReport } from "../../../src/cli/code-report.js";
import { consumerSince, wentOverSince } from "../../../src/core/delivery/code-since.js";
import { codeStatusOf } from "../../../src/core/status/code-status.js";
import type { Consumer } from "../../../src/core/types/index.js";
import type { HookContext } from "../../../src/harness/shared/context.js";
import { codeStopReason } from "../../../src/harness/shared/stop-code.js";
import { WT } from "../../state/helpers.js";
import { consumer, type Rig, rig } from "./rig.js";

/*
 * Spec 015 D2, D6, D7 (review 0.1.283, B2): a move with the same body takes
 * the old check's transitions with it, so a crossing not told yet is told at
 * the new place, and Stop, status and `squeal code --changed` still count it.
 */

const C1 = consumer("s1");
const C2 = consumer("s2");
const FAIL = (path: string) => `FAIL complexity: f (${path}:1) is 3, over 2 (ESLint rule)`;

let r: Rig;

beforeEach(async () => {
  r = rig({ threshold: 2, blocking: true });
  await r.edit({ "src/a.ts": "f 1 B0\n" });
  await r.register(C1);
  await r.register(C2);
  await r.edit({ "src/a.ts": "f 3 B1\n" });
});

/** The functions gone over since `c` registered, as Stop, status and `squeal code --changed` read them. */
function wentOver(c: Consumer) {
  const since = consumerSince(r.main, c)?.since ?? expect.fail("not registered");
  const context = {
    store: r.main,
    consumer: c,
    code: r.source,
    root: r.tree.root,
    commonDir: r.dir,
  };
  const shell = { session: c.sessionId, agent: null };
  const report = readCodeReport(r.main, r.store, WT, r.complexity, {
    paths: null,
    changed: true,
    shell,
  });
  return {
    since: wentOverSince(r.store, WT, since).map((s) => s.check.path),
    stop: codeStopReason(context as HookContext, r.complexity),
    status: codeStatusOf(r.main, WT, { root: r.tree.root, commonDir: () => r.dir }, shell).code
      ?.sinceRegistration,
    changed: report.functions.map((f) => f.path),
  };
}

const MOVED = {
  since: ["src/b.ts"],
  stop: expect.stringContaining(
    "1 function went over the complexity threshold 2 since this session started: f (src/b.ts:1).",
  ),
  status: 1,
  changed: ["src/b.ts"],
};

describe("a move after a crossing (015 D2, D7; review 0.1.283 B2)", () => {
  it("keeps a crossing told before the move counted, and tells nothing of the move", async () => {
    expect(await r.told(C1)).toEqual([FAIL("src/a.ts")]);
    const report = await r.edit({ "src/a.ts": "", "src/b.ts": "f 3 B1\n" });
    expect(report).toMatchObject({ moved: 1, transitions: 0 });
    expect(await r.told(C1)).toEqual([]);
    expect(wentOver(C1)).toEqual(MOVED);
  });

  it("tells a crossing not told before the move once, at the new place", async () => {
    await r.edit({ "src/a.ts": "", "src/b.ts": "f 3 B1\n" });
    expect(await r.told(C2)).toEqual([FAIL("src/b.ts")]);
    expect(await r.told(C2)).toEqual([]);
    expect(wentOver(C2)).toEqual(MOVED);
  });

  it("keeps the transition's own revision and time", async () => {
    const [crossing] = r.store.transitions.history(WT, {
      kind: "code",
      path: "src/a.ts",
      qualifiedName: "f",
      occurrence: 0,
    });
    await r.edit({ "src/a.ts": "", "src/b.ts": "f 3 B1\n" });
    const moved = r.store.transitions.history(WT, {
      kind: "code",
      path: "src/b.ts",
      qualifiedName: "f",
      occurrence: 0,
    });
    expect(crossing).toMatchObject({ kind: "pass-to-fail", revision: 2 });
    expect(moved).toEqual([{ ...crossing, check: { ...crossing?.check, path: "src/b.ts" } }]);
  });
});
