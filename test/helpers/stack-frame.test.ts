import { describe, expect, it } from "vitest";
import { inMethod } from "./stack-frame.js";

class Probe {
  capture(): string | undefined {
    return this.#capture();
  }
  #capture(): string | undefined {
    return new Error().stack;
  }
}

describe("inMethod (row 025-30)", () => {
  it("finds a private method's frame in a stack this repository's Vite reprints", () => {
    // Vite 8.4.0 prints this frame as `at #capture (…)`; `includes("Probe.#capture")` misses it.
    expect(inMethod(new Probe().capture(), "#capture", "helpers/stack-frame.test.ts")).toBe(true);
  });

  it("reads both forms of the frame, and only in the named file", () => {
    const v8 = "Error\n    at TierRecords.#write (/r/src/core/scheduler/record.ts:319:46)";
    const vite84 = "Error\n    at #write (/r/src/core/scheduler/record.ts:319:46)";
    const ledger = "Error\n    at #write (/r/src/core/scheduler/ledger.ts:770:11)";
    const windows = "Error\n    at #write (C:\\r\\src\\core\\scheduler\\record.ts:319:46)";
    for (const stack of [v8, vite84, windows])
      expect(inMethod(stack, "#write", "scheduler/record.ts")).toBe(true);
    expect(inMethod(ledger, "#write", "scheduler/record.ts")).toBe(false);
    expect(inMethod(vite84, "#writeAll", "scheduler/record.ts")).toBe(false);
    expect(inMethod(undefined, "#write", "scheduler/record.ts")).toBe(false);
  });
});
