import { describe, expect, it } from "vitest";
import { squealEvidence, trimOutput } from "../../evals/lib/index.mjs";
import { type EndedWait, waitText } from "../../src/cli/status-wait-lines.js";
import { formatStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot, TestFileRef } from "../../src/core/types/index.js";
import { settled } from "./status-snapshot.js";

// Row 011-29 (011 C6 as amended 2026-10-20): status's default text and a wait's, plain and in a
// Claude Code hook's JSON, read by the evals from the product's own formatters: the counts of
// its `Known failures:` clause, a down daemon from its `Outstanding:` group, the files of a
// pending retry from theirs, and every `Outstanding:` and `More:` line kept whole in a trim.

const files = (n: number, from = 0): TestFileRef[] =>
  Array.from({ length: n }, (_, i) => ({
    project: "",
    path: `test/f${String(i + from).padStart(2, "0")}.test.ts`,
  })) as TestFileRef[];

/** 2 test files queued for a retry at load and 24 never run, the baseline lookup-only. */
const busy: StatusSnapshot = {
  ...settled,
  counts: { current: 20, pending: 2, stale: 0, unknown: 24 },
  testFileCounts: { current: 1, pending: 2, stale: 0, unknown: 24 },
  testFilesByPhase: { running: 0, queued: 2 },
  breakdown: { ...settled.breakdown, testFiles: 27 },
  pendingRetries: { loadAverage: 9, cpus: 4, retries: [] },
  outstanding: [
    {
      standing: {
        kind: "retry",
        reason: "load",
        noResult: false,
        runningSince: null,
        elsewhere: false,
      },
      files: files(2, 90),
    },
    { standing: { kind: "never-run", lookupOnly: true, notCurrent: 26 }, files: files(24) },
  ],
};
const down: StatusSnapshot = {
  ...settled,
  daemon: { state: "down", since: 500 as never },
};

const status = (s: StatusSnapshot) => formatStatus(s, 2_000 as never);
const wait = (s: StatusSnapshot) =>
  waitText(
    {
      outcome: s.daemon.state === "alive" ? "quiet" : "no-daemon",
      waitedMs: 1_000,
      transitions: 0,
      result: s,
    } as EndedWait,
    2_000 as never,
  );
const hook = (text: string) =>
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext: text },
  });

describe.each([
  ["status", status],
  ["status --wait", wait],
] as const)("%s's default text (011-29)", (_, format) => {
  describe.each([
    ["as text", (t: string) => t],
    ["in a Claude Code hook's JSON", hook],
  ] as const)("%s", (__, wrap) => {
    it("is read from the formatter's own text: an Outstanding group and the More line", () => {
      const text = format(busy);
      expect(text).toMatch(/^Outstanding:\n {2}2 test files with a pending retry \(load\): /m);
      expect(text).toMatch(/^More: `squeal status --full` adds /m);
    });

    it("counts what is not current from its Known failures clause", () => {
      expect(squealEvidence(wrap(format(busy)), "pull")).toMatchObject({
        revision: 3,
        pending: 2,
        stale: 0,
        unknown: 48,
        daemon: true,
        known: 0,
      });
    });

    it("names the files of a pending retry from their group", () => {
      expect(squealEvidence(wrap(format(busy)), "pull")).toMatchObject({
        pendingRetries: ["test/f90.test.ts", "test/f91.test.ts"],
      });
    });

    it("reads a down daemon from its Outstanding group", () => {
      const text = format(down);
      expect(text).not.toMatch(/^Daemon: /m);
      expect(squealEvidence(wrap(text), "pull")).toMatchObject({ revision: 3, daemon: false });
    });
  });

  it("keeps every Outstanding and More line whole when a long output is trimmed", () => {
    const text = format(busy);
    const filler = Array.from({ length: 400 }, (_, i) => `filler line ${i} `.repeat(4));
    const trimmed = trimOutput([...filler, text].join("\n"), true);
    const kept = text
      .split("\n")
      .filter((line) => /^(?:Outstanding:|More: | {2}\d+ test files? )/.test(line));

    expect(kept).toHaveLength(4);
    for (const line of kept) expect(trimmed.split("\n")).toContain(line);
  });
});
