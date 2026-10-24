import { describe, expect, it } from "vitest";
import { namedWaitCommand } from "../../src/cli/status-wait-paths.js";
import { focusedRun, writeRuns } from "../status/focused-fixture.js";
import { A, repoWith } from "./status-wait-fixture.js";
import { A_QUEUED, capture, focusing } from "./status-wait-focus-fixture.js";

/*
 * Row 011-146 (011 C5 and C15 as amended 2026-10-23; review 0.1.286 B2): a
 * focused entry keeps at most 50 selected checks. A row that counts every
 * outcome gives exact totals; one without the count proves no pass past
 * the cut: a kept fail exits 1 as "at least", else the wait falls back to
 * the file's own run and says why. A run that ended with no outcome is not
 * a selection that matched nothing.
 */

const goods = (n: number) => Array.from({ length: n }, (_, i) => `good ${i}`);
const at = (over: Parameters<typeof focusedRun>[1]) =>
  focusedRun(A, { key: A_QUEUED, texts: ["good"], fails: [], ...over });

async function waitFor(
  over: Parameters<typeof focusedRun>[1],
  checks = ["good"],
  timeoutMs = 3_000,
  json = false,
) {
  const { repo, store } = repoWith([A]);
  writeRuns(store, repo.mainId, [at(over)]);
  const daemon = focusing(store, repo.mainId, null, "accepted", timeoutMs);
  const io = capture(repo.main);
  const code = await namedWaitCommand([A], { json, checks }, io, daemon.options);
  return { code, text: io.out.join(""), sent: daemon.sent };
}

describe("a focused entry past its 50 kept checks (review 0.1.286 B2)", () => {
  it("a row without a count and no kept fail is no answer: the wait waits for the file's run, saying why", async () => {
    const { code, text, sent } = await waitFor(
      { passes: goods(50), more: 1, matched: 51 },
      ["good"],
      300,
    );

    expect(code).toBe(3);
    expect(sent).toEqual([]);
    expect(text).toContain(
      `Focused: ${A}: its focused run kept 50 of 51 selected checks, none failing, and counted none of the rest; waiting for the file's run`,
    );
    expect(text).not.toMatch(/\b0 of 51 selected checks failed/);
  });

  it("a row without a count and a kept fail: exit 1, at least", async () => {
    const { code, text } = await waitFor({
      passes: goods(49),
      fails: ["good bad"],
      more: 1,
      matched: 51,
    });

    expect(code).toBe(1);
    expect(text).toContain(
      "Focused: at least 1 of 51 selected checks failed; no verdict for the file yet",
    );
  });

  it("a counted row: the fail past the cut, and more than 50 fails, are exact", async () => {
    const one = await waitFor({
      fails: ["good bad"],
      passes: goods(49),
      more: 1,
      matched: 51,
      outcomes: { pass: 50, fail: 1, skip: 0 },
    });
    const sixty = await waitFor({
      fails: goods(50),
      more: 10,
      matched: 60,
      outcomes: { pass: 0, fail: 60, skip: 0 },
    });

    expect(one.code).toBe(1);
    expect(one.text).toContain("Focused: 1 of 51 selected checks failed; no verdict");
    expect(sixty.code).toBe(1);
    expect(sixty.text).toContain("Focused: 60 of 60 selected checks failed; no verdict");
  });

  it("--json gives each file's count", async () => {
    const { code, text } = await waitFor(
      { passes: goods(49), fails: ["good bad"], more: 1, matched: 51 },
      ["good"],
      3_000,
      true,
    );

    expect(code).toBe(1);
    expect(JSON.parse(text).selection.focused.testFiles[0]).toMatchObject({
      more: 1,
      count: { failed: 1, total: 51, atLeast: true },
    });
  });

  it("a run for more texts with a kept fail of this wait's: exit 1, at least, no request", async () => {
    const { code, text, sent } = await waitFor(
      { texts: ["good", "bad"], fails: ["bad"], passes: goods(49), more: 5, matched: 55 },
      ["bad"],
    );

    expect(code).toBe(1);
    expect(sent).toEqual([]);
    expect(text).toContain(`Focused: at least 1 check of ${A} at revision 4`);
    expect(text).toContain("Focused: at least 1 selected check failed; no verdict");
    expect(text).not.toContain("good 0");
  });

  for (const end of ["crashed", "timed-out"] as const) {
    it(`a run that ended ${end} with no count: no outcome, never "no check holds"`, async () => {
      const { code, text } = await waitFor({
        end,
        reason: "the worker exited",
        matched: null,
        collected: null,
      });

      expect(code).toBe(3);
      expect(text).toContain(
        `Focused: no outcome: the focused run ended ${end}; no verdict for the file yet`,
      );
      expect(text).not.toContain("no check holds");
    });
  }
});
