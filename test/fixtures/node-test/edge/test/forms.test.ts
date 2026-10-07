import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { lib } from "@edge/lib";
import { sub } from "@edge/lib/sub";
import { hashTarget } from "#hash/target";
import { pathsTarget } from "~/paths-target";
import { reexported } from "../src/barrel.ts";
import data from "../src/data.json" with { type: "json" };
import { directoryIndex } from "../src/dir";
import { extensionless } from "../src/extensionless";
import { jsMeansTs } from "../src/js-means-ts.js";
import type { Shape } from "../src/types.js";

const require = createRequire(import.meta.url);

test(".js meaning .ts", () => assert.equal(jsMeansTs(), "js-means-ts"));
test("extensionless", () => assert.equal(extensionless(), "extensionless"));
test("directory index", () => assert.equal(directoryIndex(), "directory-index"));
test("tsconfig paths", () => assert.equal(pathsTarget(), "paths"));
test("package imports", () => assert.equal(hashTarget(), "imports"));
test("exports subpath", () => assert.equal(sub(), "sub"));
test("symlinked workspace package", () => assert.equal(lib(), "lib"));
test("export from", () => assert.equal(reexported(), "reexported"));
test("import type", () => {
  const shape: Shape = { w: 2 };
  assert.equal(shape.w, 2);
});
test("literal import()", async () => {
  const { dynamicLiteral } = await import("../src/dynamic-literal.ts");
  assert.equal(dynamicLiteral(), "dynamic-literal");
});
test("template-literal import()", async () => {
  for (const name of ["alpha", "beta"]) {
    const { run } = await import(`../src/plugins/${name}.ts`);
    assert.equal(run(), name);
  }
});
test("computed import(p)", async () => {
  const p = ["../src/computed", "target.ts"].join("-");
  const { computed } = await import(p);
  assert.equal(computed(), "computed");
});
test("require through createRequire", () => {
  assert.equal(require("../src/legacy.cjs").value, 10);
});
test("JSON import with type json", () => assert.equal(data.n, 10));
test("readFileSync of a fixture", () => {
  const text = readFileSync(new URL("../src/read-me.txt", import.meta.url), "utf8");
  assert.equal(text.trim(), "from-disk");
});
test("child_process script", () => {
  const script = fileURLToPath(new URL("../src/child.mjs", import.meta.url));
  assert.equal(execFileSync(process.execPath, [script], { encoding: "utf8" }).trim(), "child");
});
