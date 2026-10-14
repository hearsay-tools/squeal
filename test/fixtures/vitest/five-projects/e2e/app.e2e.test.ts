import { expect, it } from "vitest";
import { browserOnly } from "../src/browser-only.ts";

it("boots the app", () => {
  expect(browserOnly).toBe("e2e");
});
