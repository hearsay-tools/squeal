import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { title } from "../../src/title.js";

describe("title", () => {
  it("slugs through the workspace package", () => {
    assert.equal(title(" Hello World "), "post/hello-world");
  });
});
