import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { label } from "../../src/names.mjs";

// The helper the gate must measure, like cezar's verifyBinary.
function verify(name, rebrand) {
  const out = JSON.parse(execFileSync(process.execPath, ["dist/tool.mjs", name], { encoding: "utf8" }));
  assert.equal(out.name, name);
  if (rebrand) assert.match(label(name, true), /deprecated|hsq/);
  else assert.equal(label(name, false), name);
}

test("built binaries keep their names", () => {
  for (const name of ["cez", "hsq"]) for (const rebrand of [false, true]) verify(name, rebrand);
});
