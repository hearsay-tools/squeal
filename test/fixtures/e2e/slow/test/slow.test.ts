import { setTimeout as sleep } from "node:timers/promises";
import { expect, it } from "vitest";
import { double, SLOW_MS } from "../src/slow.js";

it("doubles slowly", async () => {
  await sleep(SLOW_MS);
  expect(double(2)).toBe(4);
}, 60_000);
