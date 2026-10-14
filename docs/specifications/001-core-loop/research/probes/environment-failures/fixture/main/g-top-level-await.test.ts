// The environment probed at import time, outside any hook.
import { expect, test } from "vitest";
const res = await fetch("http://127.0.0.1:59321/");
test("never collected", () => expect(res.ok).toBe(true));
