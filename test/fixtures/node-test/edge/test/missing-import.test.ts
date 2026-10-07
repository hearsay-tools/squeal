import { test } from "node:test";
import { gone } from "../src/does-not-exist.js";

test("never runs", () => gone());
