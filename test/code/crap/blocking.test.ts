import { describe, expect, it } from "vitest";
import { readCodeReport } from "../../../src/cli/code-report.js";
import { consumerSince, wentOverSince } from "../../../src/core/delivery/code-since.js";
import { codeSource } from "../../../src/core/delivery/code-source.js";
import { codeStatusOf } from "../../../src/core/status/code-status.js";
import type { HookContext } from "../../../src/harness/shared/context.js";
import { codeStopReason } from "../../../src/harness/shared/stop-code.js";
import { WT } from "../../state/helpers.js";
import { policyOn } from "../pass/helpers.js";
import { type CoverageRig, consumer, coverageRig, sourceOf } from "./rig.js";

/*
 * Row 015-40: D7's Stop count holds for `crap` and `uncovered` as for
 * complexity. With `complexity.blocking` on, Stop counts each of them that
 * went to `fail` since the session registered and names its measure; the
 * status line stays complexity only.
 */

const S1 = consumer("s1");
const COMPLEXITY = policyOn({ blocking: true }).complexity;
const A = "hot 12 h1\ncold 6 c1\nbig 35 b1\n";

const blobOf = (rig: CoverageRig) => rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";

/** `test/a.test.ts` runs `lines` of `src/a.ts` at its current blob, at `key`. */
function ran(rig: CoverageRig, lines: readonly number[], key: string) {
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    key,
    record: [sourceOf("src/a.ts", blobOf(rig), 4, lines)],
  });
  rig.step();
}

/** `cold` fails CRAP and uncovered and `big` CRAP and complexity, judged; then S1 registers. */
async function judged(): Promise<CoverageRig> {
  const rig = coverageRig();
  await rig.edit({ "src/a.ts": A });
  ran(rig, [1, 3], "key-1");
  await rig.register(S1);
  return rig;
}

/** What Stop, status and `squeal code --changed` say for S1. */
function since(rig: CoverageRig) {
  const { root, commonDir } = rig.tree;
  const context = { store: rig.main, consumer: S1, code: codeSource(commonDir, root), root };
  const shell = { session: S1.sessionId, agent: null };
  const bound = consumerSince(rig.main, S1) ?? expect.fail("not registered");
  const report = readCodeReport(rig.main, rig.store, WT, COMPLEXITY, {
    paths: null,
    changed: true,
    shell,
  });
  return {
    stop: codeStopReason(context as unknown as HookContext, COMPLEXITY),
    status: codeStatusOf(rig.main, WT, { root, commonDir: () => commonDir }, shell).code
      ?.sinceRegistration,
    wentOver: wentOverSince(rig.store, WT, bound).map((s) => s.check.qualifiedName),
    changed: report.coverage?.functions.map((f) => `${f.qualifiedName} ${f.measure}`),
  };
}

describe("complexity.blocking with CRAP and uncovered (015-40)", () => {
  it("names each function that went to fail since registration with its measures", async () => {
    const rig = await judged();
    // `hot` is no longer run: over CRAP and unreached; `sel` is new and over complexity.
    await rig.edit({ "src/a.ts": `${A}sel 25 s1\n` });
    ran(rig, [3, 4], "key-2");
    expect(since(rig)).toEqual({
      stop: "Squeal policy complexity.blocking is on and 2 functions went to fail since this session started: sel (src/a.ts:4) over complexity 20, hot (src/a.ts:1) over CRAP 30 and untested. `squeal code --changed` lists them.",
      status: 1,
      wentOver: ["sel"],
      changed: ["hot crap", "hot uncovered"],
    });
  });

  it("never blocks for a function failing CRAP or uncovered at registration", async () => {
    const rig = await judged();
    await rig.edit({ "src/a.ts": "hot 12 h1\ncold 6 c2\nbig 35 b1\n" });
    ran(rig, [1, 3], "key-2");
    expect(since(rig).stop).toBeNull();
  });

  it("keeps the complexity-only text with coverage judged", async () => {
    const rig = await judged();
    await rig.edit({ "src/a.ts": `${A}sel 25 s1\n` });
    ran(rig, [1, 3, 4], "key-2");
    expect(since(rig).stop).toBe(
      "Squeal policy complexity.blocking is on and 1 function went over the complexity threshold 20 since this session started: sel (src/a.ts:4). `squeal code --changed` lists them.",
    );
  });
});
