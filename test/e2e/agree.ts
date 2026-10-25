import { expect } from "vitest";
import { formatCheck } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";

/*
 * Spec 001 goals 3 and 5, task scenario 9: what a hook delivered and what
 * `squeal status --json` from the shipped CLI says right after agree. Called
 * only at quiet points, where nothing is pending and no file is changing.
 */

// 001-85: the revision may be followed by "(changed a.ts, b.ts and 2 more)"; 005-21: a
// count by "(9 tests, 3 test files loaded)"; 001-406: the revision by its commit,
// "· 1bc146f0 + 3, dirty".
const PARTS = String.raw`(?: \([^)]*\))?`;
const COMMIT = String.raw`(?: · ([0-9a-f]{8}) \+ (\d+)(, dirty)?)?`;
const HEADER = new RegExp(
  String.raw`Revision (\d+)${COMMIT}(?: \(changed [^)]*\))?: (\d+) current${PARTS}, (\d+) pending${PARTS}, ` +
    String.raw`(\d+) stale${PARTS}, (\d+) unknown${PARTS}\.`,
);

/**
 * 001-407: a change delivery's news header names only the non-zero pending, stale and unknown
 * counts, or "no check pending, stale or unknown", and no checkpoint. Row 011-205: with no such
 * check, the test files without checks alone, which count no check.
 */
const NEWS = new RegExp(
  String.raw`Revision (\d+)${COMMIT}: (?:(no check pending, stale or unknown|\d+ (?:pending|stale|unknown)\b[^.]*)\.|(?=test files without checks: ))`,
);

/** `validity`'s count in a news header's counts, 0 when it is not named. */
function newsCount(counts: string, validity: string): number {
  return Number(new RegExp(String.raw`(\d+) ${validity}\b`).exec(counts)?.[1] ?? 0);
}

/** Check names of the `FAIL  <name>` or `PASS  <name>` blocks of a delivered text. */
export function blocks(text: string, outcome: "FAIL" | "PASS"): string[] {
  return [...text.matchAll(new RegExp(`^${outcome}  (.+)$`, "gm"))].map((m) => m[1] ?? "");
}

/** The revision a delivered header names. */
export function headerRevision(text: string): number {
  const match = HEADER.exec(text) ?? NEWS.exec(text);
  if (match === null) throw new Error(`no header line in:\n${text}`);
  return Number(match[1]);
}

export function expectAgrees(text: string | null, status: StatusSnapshot): void {
  if (text === null) throw new Error("nothing was delivered");
  const full = HEADER.exec(text);
  const news = full === null ? NEWS.exec(text) : null;
  expect(full ?? news, `header line in:\n${text}`).not.toBeNull();
  const [, revision, head, since, dirty] = full ?? news ?? [];
  if (full !== null) {
    const [current, pending, stale, unknown] = full.slice(5).map(Number);
    expect({ revision: Number(revision), current, pending, stale, unknown }, text).toEqual({
      revision: status.revision,
      ...status.counts,
    });
  } else {
    const counts = news?.[5] ?? "";
    const { pending, stale, unknown } = status.counts;
    expect(
      {
        revision: Number(revision),
        pending: newsCount(counts, "pending"),
        stale: newsCount(counts, "stale"),
        unknown: newsCount(counts, "unknown"),
      },
      text,
    ).toEqual({ revision: status.revision, pending, stale, unknown });
  }
  const commit = status.commit;
  expect(
    head === undefined ? undefined : { head, sinceHead: Number(since), dirty: dirty !== undefined },
    text,
  ).toEqual(
    commit === undefined || commit.head === null
      ? undefined
      : { head: commit.head.slice(0, 8), sinceHead: commit.sinceHead, dirty: commit.dirty },
  );
  if (full !== null) {
    expect(
      text.includes(`Full-suite checkpoint: completed at revision ${status.revision}.`),
      text,
    ).toBe(status.fullSuite.atCurrentRevision);
  } else expect(text, text).not.toContain("Full-suite checkpoint");
  expect(/No daemon (has validated|is running)/.test(text), text).toBe(
    status.daemon.state === "down",
  );
  const failing = new Set(status.knownFailures.map((f) => formatCheck(f.check)));
  for (const name of blocks(text, "FAIL")) expect(failing, text).toContain(name);
  for (const name of blocks(text, "PASS")) expect(failing, text).not.toContain(name);
  const known = /^Known failures: (\d+)(?: \(.*\))?$/m.exec(text);
  if (known !== null) expect(Number(known[1]), text).toBe(status.knownFailures.length);
}
