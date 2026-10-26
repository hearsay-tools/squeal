// Throwaway (015-76): what a test sees of coverage (Fidelity).
import assert from "node:assert";
import { test } from "node:test";

test("env", () => {
  process.stdout.write(`NODE_V8_COVERAGE=${process.env.NODE_V8_COVERAGE ?? "<unset>"}\n`);
  assert.ok(true);
});
