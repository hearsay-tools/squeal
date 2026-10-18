import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("AGENTS.md has a heading", () => {
  assert.match(readFileSync("AGENTS.md", "utf8"), /^# Agents/);
});
