import { appendFileSync } from "node:fs";
import { expect, test } from "vitest";
appendFileSync(process.env.MARK as string, "fast imported\n");
test("fast", () => expect(1).toBe(1));
