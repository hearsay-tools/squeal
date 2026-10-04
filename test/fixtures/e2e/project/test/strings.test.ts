import { expect, it } from "vitest";
import { shout } from "../src/strings.js";

it("shouts", () => {
  expect(shout("hi")).toBe("HI!");
});
