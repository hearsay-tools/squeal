import { describe, expect, it } from "vitest";
import { CLAIM, graded, REGISTERED, type Step } from "./reference-sessions.js";

// Review 006-63 B3: Squeal's own non-zero replies are Squeal actions. `why`'s no-match and
// several-matches replies (exit 1, src/core/status/format-why.ts), a usage-only reply (exit 2,
// src/cli/start.ts and its siblings) and a store Squeal cannot read (exit 1, `formatUnavailable`)
// carry no evidence, so they count as pulls and add no current result. A launcher's own failure
// stays another program's reply. Both harnesses.

const OWN: Record<string, Step & { sub: string }> = {
  "why with no match": {
    cmd: "squeal why test/missing.test.ts",
    out: 'No check matches "test/missing.test.ts" in this worktree.\n',
    exit: 1,
    sub: "why",
  },
  "why with several matches": {
    cmd: "squeal why invoice",
    out: '"invoice" matches 2 checks in this worktree:\n  test/invoice.test.ts > totals\n  test/invoice.test.ts > rounds\n',
    exit: 1,
    sub: "why",
  },
  "start's usage": {
    cmd: "squeal start --bad",
    out: "usage: squeal start [root]\n",
    exit: 2,
    sub: "start",
  },
  "stop's usage": {
    cmd: "squeal stop --bad",
    out: "usage: squeal stop [--until-start] [root]\n",
    exit: 2,
    sub: "stop",
  },
  "a status Squeal cannot read": {
    cmd: "squeal status",
    out: "Status unavailable, no Squeal store at /work/.git/squeal/squeal.db\n",
    exit: 1,
    sub: "status",
  },
};

const LAUNCHER_NODE = "squeal: Node 22.13 or later is needed, and node is not on the PATH\n";
const OPENING: Step[] = [{ squeal: REGISTERED(0) }, { edit: "src/invoice.ts" }];

describe("Squeal's own refusal", () => {
  for (const harness of ["codex", "claude"] as const) {
    for (const [what, { sub, ...call }] of Object.entries(OWN))
      it(`${harness}: ${what} is a Squeal action with no current result`, () => {
        const g = graded([...OPENING, call, CLAIM("fail")], {
          truthPass: false,
          status: "fail",
          harness,
        });
        expect(g.squealPulls).toBe(1);
        expect(g.timeline.pulls.map((p) => p.sub)).toEqual([sub]);
        expect(g.squealWhy).toBe(sub === "why" ? 1 : 0);
        // No evidence: only the opening registration is Squeal's, at revision 0.
        const evidence = g.retained.flatMap((s) => (s.k === "squeal" ? [s] : []));
        expect(evidence.map((s) => [s.from, s.revision])).toEqual([["push", 0]]);
      });

    it(`${harness}: the launcher finding no Node is no Squeal action`, () => {
      const call = { cmd: "squeal status --wait 60000", out: LAUNCHER_NODE, exit: 1 };
      const g = graded([...OPENING, call, CLAIM("fail")], {
        truthPass: false,
        status: "fail",
        harness,
      });
      expect(g.squealPulls).toBe(0);
      expect(g.squealWaits).toBe(0);
    });
  }
});
