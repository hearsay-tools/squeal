import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { area, convert, Ledger, largest, Unit } from "../src/shapes.ts";

test("area and convert", () => {
  assert.equal(area({ kind: "square", size: 2 }), 4);
  assert.equal(convert(10, Unit.Metre), 10);
  const ledger = new Ledger<number>("n");
  ledger.add(1);
  assert.equal(ledger.describe(), "n: 1");
  assert.equal(largest([{ kind: "square", size: 1 }])?.size, 1);
});

test("a child with an explicit env", () => {
  // env without NODE_V8_COVERAGE: Node copies it in anyway (child_process.js copyProcessEnvToEnv)
  const out = spawnSync(process.execPath, ["--import", "tsx", "src/child-main.ts"], {
    env: { PATH: process.env.PATH ?? "" },
    encoding: "utf8",
  });
  assert.equal(out.stdout, "OK 1\n");
});
