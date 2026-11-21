import { describe, expect, it, vi } from "vitest";
import { fixture, git, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { clean, run, testOf } from "./status-at-kit.js";

/*
 * Review wave-20 B4 (row 023-34, T1): with no stored duration, nothing
 * tells before a run that a selection cannot fit. The rule of 0.1.586
 * took 20 s per round of files at once as a floor and refused a small,
 * fast selection that answers in seconds (the review's witness: 16
 * node:test files at width 1, refused at 300 s, done in 10.5 s when
 * forced). Here the width is 1 (two CPUs) and the budget 39 s, so that
 * rule held one file and refused two; the call now runs both sides.
 */

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  availableParallelism: () => 2,
}));

const A = ref("test/a.test.ts");
const B = ref("test/b.test.ts");

describe("a cold selection that fits is not refused (review wave-20 B4)", SLOW, () => {
  it("runs both sides and compares every file, the fit check on", async () => {
    const f = fixture({
      "squeal.config.json": "{}\n",
      "src/a.ts": "export const value = 1;\n",
      [A.path]: testOf("a", 1),
      [B.path]: testOf("a", 1),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({
      "src/a.ts": "export const value = 2;\n",
      [A.path]: testOf("a", 2),
      [B.path]: testOf("a", 2),
    });
    const guard = { allMissing: false, timeoutSeconds: 39, fitCheck: true } as const;
    const out = await run(f, { commit: a, run: guard });
    expect(out.out, out.err).not.toMatch(/ran nothing|stopped after its first batch/);
    expect(out.out).toContain("0 pass -> fail, 0 fail -> pass, 2 unchanged, 0 unknown");
    expect(out.code).toBe(0);
    clean(f);
  });
});
