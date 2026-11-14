import { describe, expect, it } from "vitest";
import { budgetLine, preRunOptions, wholeProjectText } from "../../src/cli/code-gate-prerun.js";
import type { BudgetFit, RunEstimate } from "../../src/core/code/gate/estimate.js";
import type { BasePolicy } from "../../src/core/code/gate/policy.js";
import type { SelectionSummary } from "../../src/core/code/gate/prerun.js";
import type { WholeProject } from "../../src/core/code/gate/setup-selection.js";
import type { ChangedSet } from "../../src/core/code/gate/types.js";
import type { RelativePath } from "../../src/core/types/common.js";

/*
 * Row 020-57 (#212): the words of the setup-selection line and of an
 * estimate the host's load scaled, from the summary and the fit alone.
 */

const SETUP = "vitest.setup.ts" as RelativePath;
const CONFIG = "vitest.config.ts" as RelativePath;

const whole = (over: Partial<WholeProject> = {}): WholeProject => ({
  runner: "vitest",
  paths: [SETUP],
  setupFiles: [SETUP],
  projects: ["server"],
  files: 1248,
  run: 1248,
  ...over,
});

const FIT: BudgetFit = { leftSeconds: 1790, seconds: 500, known: 1248 };
const LOADED: BudgetFit = {
  leftSeconds: 1790,
  seconds: 2300,
  known: 1248,
  load: { perCpu: 4.6, unscaled: 500 },
  rerunSeconds: 4620,
};

describe("wholeProjectText", () => {
  it("names the setupFiles entry, the files it selects and the whole run against the budget", () => {
    expect(wholeProjectText([whole()], FIT)).toBe(
      'squeal code: every test file of Vitest project "server" depends on vitest.setup.ts (setupFiles), so all 1248 of them are selected; the whole run takes about 500 s, within the 1790 s left of the budget\n',
    );
  });

  it("says when the host's load scaled the estimate over the budget", () => {
    expect(wholeProjectText([whole()], LOADED)).toBe(
      'squeal code: every test file of Vitest project "server" depends on vitest.setup.ts (setupFiles), so all 1248 of them are selected; the whole run takes about 2300 s at the host\'s load, over the 1790 s left of the budget\n',
    );
  });

  it("names several projects and paths, the root project as the runner's, and the files the stores give", () => {
    const paths = [SETUP, CONFIG, "a.ts", "b.ts"] as RelativePath[];
    const two = whole({ paths, projects: ["", "client", "server"], files: 6, run: 0 });
    expect(wholeProjectText([two], { ...FIT, seconds: null })).toBe(
      'squeal code: every test file of Vitest projects "client", "server" depends on vitest.setup.ts (setupFiles), vitest.config.ts, a.ts and 1 more, so all 6 of them are selected, none to run here; the whole run\'s time is unknown: no stored duration\n',
    );
    const root = whole({ runner: "node-test", setupFiles: [], projects: [""], files: 1, run: 1 });
    expect(wholeProjectText([root], FIT)).toBe(
      "squeal code: every node:test test file depends on vitest.setup.ts, so its 1 test file is selected; the whole run takes about 500 s, within the 1790 s left of the budget\n",
    );
    expect(wholeProjectText([], FIT)).toBe("");
  });
});

describe("budgetLine under the host's load", () => {
  it("says the whole run's estimate is at the host's load", () => {
    const rerun = { seconds: 4620, command: "squeal code --base main --timeout 4620" };
    expect(budgetLine({ fit: LOADED, rerun })).toBe(
      "about 2300 s in all at the host's load, over the 1790 s left of the budget. A rerun that fits: squeal code --base main --timeout 4620",
    );
  });
});

describe("preRunOptions", () => {
  it("tells the setup-selection line after the selection, before the runners' estimates", () => {
    let stderr = "";
    const options = preRunOptions(
      { functions: [] } as unknown as ChangedSet,
      { coverageExclude: [] } as unknown as BasePolicy,
      (text) => {
        stderr += text;
      },
    );
    const summary: SelectionSummary = {
      runners: [
        { runner: "vitest", files: 1248, run: 1248, known: { store: 0, parts: 0 }, groups: [] },
      ],
      leftOut: [],
      setups: [],
      unloaded: [],
      wholeProjects: [whole()],
    };
    options.selected?.(summary);
    const estimate: RunEstimate = {
      runner: "vitest",
      seconds: 2300,
      files: 1248,
      known: 1248,
      width: 23,
      load: { perCpu: 4.6, unscaled: 500 },
    };
    options.estimated?.([estimate], 1790, { fit: LOADED });
    const lines = stderr.trimEnd().split("\n");
    expect(lines[0]).toBe("squeal code: Vitest: 1248 test files to run");
    expect(lines[1]).toMatch(/^squeal code: every test file of Vitest project "server" depends on/);
    expect(lines[2]).toMatch(
      /^squeal code: Vitest: 1248 test files to run here, up to 23 at once: about 2300 s from their stored durations, scaled by the host's load \(500 s times 4\.6, its one-minute load per CPU\), over the 1790 s left of the budget\. /,
    );
    expect(lines).toHaveLength(3);
  });
});
