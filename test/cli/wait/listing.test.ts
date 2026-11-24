import { describe, expect, it } from "vitest";
import { listingSettled } from "../../../src/cli/wait/listing.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { StatusHeader } from "../../../src/core/types/status.js";
import { scratch } from "./fixture.js";

/*
 * Row 010-37: the edit wait owes a listing only while a runner would list
 * the worktree's test files unasked. Under a policy whose every test group
 * is at `manual` (spec 026 D1, deferred keying), none does, so the wait may
 * settle on quiet before any file is listed.
 */

const unlisted = { testFilesListed: false } as StatusHeader;

describe("listingSettled (row 010-37)", () => {
  it("owes the listing under the default policy until a key row or the header lists files", () => {
    const w = scratch();
    try {
      const root = w.root as AbsolutePath;
      expect(listingSettled(w.store, w.id, root, unlisted)).toBe(false);
      const listed = { testFilesListed: true } as StatusHeader;
      expect(listingSettled(w.store, w.id, root, listed)).toBe(true);
    } finally {
      w.store.close();
    }
  });

  it("owes no listing when every test group is at manual", () => {
    const w = scratch({ checks: [{ name: "unit", runner: "vitest", at: "manual" }] });
    try {
      expect(listingSettled(w.store, w.id, w.root as AbsolutePath, unlisted)).toBe(true);
    } finally {
      w.store.close();
    }
  });

  it("owes the listing when a test group that can own a file runs at edit", () => {
    const w = scratch({
      checks: [
        { name: "fast", runner: "vitest", at: "edit", tests: ["test/fast/**"] },
        { name: "unit", runner: "vitest", at: "manual" },
      ],
    });
    try {
      expect(listingSettled(w.store, w.id, w.root as AbsolutePath, unlisted)).toBe(false);
    } finally {
      w.store.close();
    }
  });
});
