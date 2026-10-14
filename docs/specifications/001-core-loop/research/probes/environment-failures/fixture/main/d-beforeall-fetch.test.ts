// cezar shape: a file-level beforeAll reaches a server that is not up ("fetch failed").
import { beforeAll, expect, test } from "vitest";
let body = "";
beforeAll(async () => {
  body = await (await fetch("http://127.0.0.1:59321/api/v1/health")).text();
});
test("first", () => expect(body).toBe("ok"));
test("second", () => expect(body).toBe("ok"));
