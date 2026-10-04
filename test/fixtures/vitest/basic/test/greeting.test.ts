import { expect, it } from "vitest";

it("sees the setup greeting", () => {
  expect((globalThis as { greeting?: string }).greeting).toBe("hello");
});
