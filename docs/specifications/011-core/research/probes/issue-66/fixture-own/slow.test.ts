import { test } from "vitest";
// Sleeps past the tier timeout only when the setup file sets FLAG to 2.
test("slow only after the setup edit", async () => {
  if ((globalThis as { FLAG?: number }).FLAG === 2) await new Promise((r) => setTimeout(r, 6000));
}, 20000);
