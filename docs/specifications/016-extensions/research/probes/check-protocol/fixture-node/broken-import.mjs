import { missing } from "./does-not-exist.mjs";
import { test } from "node:test";
test("never runs", () => missing());
