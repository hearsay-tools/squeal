// False negative for the file-level signal: the environment fails inside a test, not a hook.
import { expect, test } from "vitest";
test("talks to the dev server", async () => {
  expect((await fetch("http://127.0.0.1:59321/")).ok).toBe(true);
});
test("pure logic beside it", () => expect(1).toBe(1));
