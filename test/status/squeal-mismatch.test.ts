import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { writeSquealMismatch } from "../../src/core/shared/refused.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import { buildSnapshot } from "../../src/core/status/snapshot.js";
import type { SquealMismatch } from "../../src/core/types/status.js";
import { fakeRepo, seedStore } from "./helpers.js";

/*
 * Spec 018 D21 (row 018-34): when the reader refused CI's export because CI
 * ran a Squeal with another key format, default status says so once, in
 * plain words, with both Squeal versions and what happens next. The key
 * format numbers go to `--full`. Silent when the formats are equal.
 */

const HERE = "0.1.440";
const COMMIT = "c".repeat(40);

/** The sentence D21 gives, for CI's Squeal `ci`. */
const line = (ci: string) =>
  `CI results not used: CI ran Squeal ${ci}, which records results in a different format than this Squeal (${HERE}). They are used again when CI and this machine run releases with the same format.`;

function mismatch(ci: string, ciFormat: number, hereFormat = KEY_FORMAT_VERSION): SquealMismatch {
  return {
    ci: { version: ci, keyFormat: ciFormat },
    here: { version: HERE, keyFormat: hereFormat },
    commit: COMMIT,
    at: 5,
  };
}

/** A worktree whose reader recorded `refused`, with `shared.ref` set unless `ref` is null. */
function worktree(refused: SquealMismatch | null, ref: string | null = "refs/squeal") {
  const repo = fakeRepo();
  const store = seedStore(repo);
  if (ref !== null) {
    writeFileSync(join(repo.main, "squeal.config.json"), JSON.stringify({ shared: { ref } }));
  }
  writeSquealMismatch(store, repo.mainId, refused);
  const text = (full = false) =>
    formatStatus(buildSnapshot(store, repo.main, 10), 10, "squeal", { full });
  return { repo, store, text };
}

const count = (text: string, part: string) => text.split(part).length - 1;

describe("status names a Squeal mismatch with CI (018 D21)", () => {
  it("CI older: both versions and what happens next, without key format numbers", () => {
    const status = worktree(mismatch("0.1.431", KEY_FORMAT_VERSION - 1)).text();
    expect(status).toContain(`\n${line("0.1.431")}\n`);
    expect(status).not.toContain("key format");
  });

  it("CI newer: only the versions change", () => {
    const status = worktree(mismatch("0.1.450", KEY_FORMAT_VERSION + 1)).text();
    expect(status).toContain(`\n${line("0.1.450")}\n`);
    expect(status).not.toContain("key format");
  });

  it("--full adds the key format numbers to the one line", () => {
    const status = worktree(mismatch("0.1.431", KEY_FORMAT_VERSION - 1)).text(true);
    expect(status).toContain(
      `\n${line("0.1.431")} CI's export of cccccccc has key format ${KEY_FORMAT_VERSION - 1}; this Squeal's is ${KEY_FORMAT_VERSION}.\n`,
    );
    expect(count(status, "CI results not used")).toBe(1);
  });

  it("shown once: a later refusal replaces the earlier one", () => {
    const w = worktree(mismatch("0.1.430", KEY_FORMAT_VERSION - 1));
    writeSquealMismatch(w.store, w.repo.mainId, mismatch("0.1.431", KEY_FORMAT_VERSION - 1));
    for (const status of [w.text(), w.text(true)]) {
      expect(count(status, "CI results not used")).toBe(1);
      expect(status).toContain(line("0.1.431"));
      expect(status).not.toContain("0.1.430");
    }
  });

  it("silent when the formats are equal, when no refusal is held, or once it is cleared", () => {
    expect(worktree(mismatch("0.1.431", KEY_FORMAT_VERSION)).text(true)).not.toContain("CI ran");
    expect(worktree(null).text(true)).not.toContain("CI ran");
    const w = worktree(mismatch("0.1.431", KEY_FORMAT_VERSION - 1));
    writeSquealMismatch(w.store, w.repo.mainId, null);
    expect(w.text(true)).not.toContain("CI ran");
  });

  it("silent when the refusing Squeal had another format than this one, or without shared.ref", () => {
    const stale = mismatch("0.1.431", KEY_FORMAT_VERSION - 1, KEY_FORMAT_VERSION - 2);
    expect(worktree(stale).text(true)).not.toContain("CI ran");
    const off = worktree(mismatch("0.1.431", KEY_FORMAT_VERSION - 1), null);
    expect(off.text(true)).not.toContain("CI ran");
  });

  it("--json carries the record under shared", () => {
    const w = worktree(mismatch("0.1.431", KEY_FORMAT_VERSION - 1));
    expect(buildSnapshot(w.store, w.repo.main, 10).shared?.squeal).toEqual(
      mismatch("0.1.431", KEY_FORMAT_VERSION - 1),
    );
  });
});
