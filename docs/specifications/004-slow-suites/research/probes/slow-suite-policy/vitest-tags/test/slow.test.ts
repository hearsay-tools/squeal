/**
 * @module-tag slow
 */
import { appendFileSync } from "node:fs";
import { expect, test } from "vitest";
appendFileSync(process.env.MARK as string, "slow imported\n");
test("slow", () => expect(1).toBe(1));
test("slow tagged test", { tags: ["slow"] }, () => expect(1).toBe(1));
