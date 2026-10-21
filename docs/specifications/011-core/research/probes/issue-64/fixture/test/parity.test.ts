// A stand-in for a large shared parity file: 30 existing checks of 400 ms each, about 12 s of tests.
import { describe, expect, it } from "vitest";
const slow = () => new Promise((r) => setTimeout(r, 400));
describe("parity", () => {
  for (let i = 0; i < 30; i++) {
    it(`existing ${i}`, async () => { await slow(); expect(i).toBe(i); });
  }
  // NEW-ASSERTIONS
});
