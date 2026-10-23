import { test } from "node:test";
test("outer", async (t) => { await t.test("sub", () => {}); await t.test("other", () => {}); });
test("flat sub", () => {});
