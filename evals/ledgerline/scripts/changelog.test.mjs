import assert from "node:assert/strict";
import { test } from "node:test";
import { renderRelease } from "./changelog.mjs";

test("groups entries by type in first-seen order", () => {
  const text = renderRelease("1.5.0", [
    { type: "feature", text: "A" },
    { type: "fix", text: "B" },
    { type: "feature", text: "C" },
  ]);
  assert.equal(text, "## 1.5.0\n\n### Added\n\n- A\n- C\n\n### Fixed\n\n- B");
});

test("labels an unknown type as Changed", () => {
  assert.equal(renderRelease("x", [{ type: "chore", text: "D" }]), "## x\n\n### Changed\n\n- D");
});
