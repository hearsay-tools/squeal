import { expect, it } from "vitest";
import { client } from "../src/gen/client.ts";

it("calls the generated client", () => {
  expect(client()).toBe("ok");
});
