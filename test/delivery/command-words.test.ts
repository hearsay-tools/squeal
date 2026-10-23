import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { formatDelta } from "../../src/core/delivery/index.js";
import type { Delta, TransitionEntry } from "../../src/core/types/index.js";

/*
 * Row 011-130: every command a FAIL report prints quotes its words through
 * `shellWord`, so the shell passes back the name, each path and the error
 * as they are: the `why` line (task 001-88) and a group's `Full list:` line
 * (row 011-109).
 */

const ERROR = `Error: it's "$HOME" \`id\``;

function failure(path: string, name: string): TransitionEntry {
  return {
    check: { kind: "test", project: "", testPath: path, fullName: name },
    kind: "pass-to-fail",
    from: "pass",
    to: "fail",
    validity: "current",
    observedAt: 12,
    origin: { kind: "own" },
    summary: ERROR,
    location: { path: "src/chart.tsx", line: 12, column: 5 },
    testFileFrame: { path, line: 20, column: 3 },
  };
}

function report(entries: TransitionEntry[]): string {
  const delta: Delta = {
    schemaVersion: 1,
    consumer: { worktreeId: "wt", sessionId: "s", agentId: "main" },
    header: {
      revision: 12,
      counts: { current: 300, pending: 0, stale: 0, unknown: 0 },
      testFilesWithoutChecks: { pending: 0, unknown: 0 },
      fullSuite: { atCurrentRevision: false, lastCompletedRevision: 10 },
    },
    label: "transitions",
    entries,
  };
  return formatDelta(delta);
}

/** The arguments `sh` passes to `squeal` for the command after `lead` in `text`. */
function argsAfter(text: string, lead: string): string[] {
  const line = text.split("\n").find((l) => l.trimStart().startsWith(lead));
  if (line === undefined) throw new Error(`no ${lead} line in: ${text}`);
  const command = line.trimStart().slice(lead.length);
  const out = execFileSync("sh", ["-c", `squeal() { printf '%s\\0' "$@"; }; ${command}`], {
    encoding: "utf8",
  });
  return out.split("\0").slice(0, -1);
}

describe("a FAIL report's commands parse back to their arguments (row 011-130)", () => {
  it("the why line names the check whole", () => {
    const name = `it's "$HOME" > \`id\` and a space`;
    const text = report([failure("tests/a b.test.ts", name)]);
    expect(argsAfter(text, "Full output: ")).toEqual(["why", `tests/a b.test.ts > ${name}`]);
  });

  it("the Full list line names each test file and the error whole", () => {
    const text = report([
      failure("tests/a b.test.ts", "one"),
      failure("tests/it's.test.ts", "two"),
    ]);
    expect(argsAfter(text, "Full list: ")).toEqual([
      "failures",
      "tests/a b.test.ts",
      "tests/it's.test.ts",
      "--error",
      ERROR,
      "--per-check",
      "--limit",
      "all",
    ]);
  });
});
