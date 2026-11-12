import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { a } from "../src/a.ts";

// Never ends inside any budget a test gives: a deterministic sleep, not load.
test("slow", async () => {
  await sleep(600_000);
  assert.equal(a(1), 1);
});
