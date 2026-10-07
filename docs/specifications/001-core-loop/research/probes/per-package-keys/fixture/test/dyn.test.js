import { expect, test } from "vitest";
import { dyn } from "dyn";
test("dyn", async () => expect(await dyn()).toBe("computed-v1"));
