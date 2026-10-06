import { expect } from "vitest";
import { formatCheck } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";

/*
 * Spec 001 goals 3 and 5, task scenario 9: what a hook delivered and what
 * `squeal status --json` from the shipped CLI says right after agree. Called
 * only at quiet points, where nothing is pending and no file is changing.
 */

const HEADER = /Revision (\d+): (\d+) current, (\d+) pending, (\d+) stale, (\d+) unknown\./;

/** Check names of the `FAIL  <name>` or `PASS  <name>` blocks of a delivered text. */
export function blocks(text: string, outcome: "FAIL" | "PASS"): string[] {
  return [...text.matchAll(new RegExp(`^${outcome}  (.+)$`, "gm"))].map((m) => m[1] ?? "");
}

/** The revision a delivered header names. */
export function headerRevision(text: string): number {
  const match = HEADER.exec(text);
  if (match === null) throw new Error(`no header line in:\n${text}`);
  return Number(match[1]);
}

export function expectAgrees(text: string | null, status: StatusSnapshot): void {
  if (text === null) throw new Error("nothing was delivered");
  const match = HEADER.exec(text);
  expect(match, `header line in:\n${text}`).not.toBeNull();
  const [, revision, current, pending, stale, unknown] = (match ?? []).map(Number);
  expect({ revision, current, pending, stale, unknown }, text).toEqual({
    revision: status.revision,
    ...status.counts,
  });
  expect(
    text.includes(`Full-suite checkpoint: completed at revision ${status.revision}.`),
    text,
  ).toBe(status.fullSuite.atCurrentRevision);
  expect(/No daemon (has validated|is running)/.test(text), text).toBe(
    status.daemon.state === "down",
  );
  const failing = new Set(status.knownFailures.map((f) => formatCheck(f.check)));
  for (const name of blocks(text, "FAIL")) expect(failing, text).toContain(name);
  for (const name of blocks(text, "PASS")) expect(failing, text).not.toContain(name);
  const known = /^Known failures: (\d+)$/m.exec(text);
  if (known !== null) expect(Number(known[1]), text).toBe(status.knownFailures.length);
}
