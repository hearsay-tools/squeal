import { describe, expect, it } from "vitest";
import { observe } from "./helpers.js";

/*
 * Row 023-36 (spec 023 D4 step 11, T3; review wave-20 B7): under the
 * recorder, a `--run` run's token reaches every child, a caller's own
 * `env: {}` included, sync and async, so a detached child stays the run's
 * after its starter exits. Without the token, a child gets none.
 */

const MAIN = (token: string | null) =>
  [
    'import { spawn, spawnSync } from "node:child_process";',
    token === null ? "" : `process.env.SQUEAL_RUN_GROUP = ${JSON.stringify(token)};`,
    "const print = ['-e', 'process.stdout.write(String(process.env.SQUEAL_RUN_GROUP))'];",
    "const sync = spawnSync(process.execPath, print, { env: {}, encoding: 'utf8' }).stdout;",
    "const child = spawn(process.execPath, print, { env: {}, stdio: ['ignore', 'pipe', 'ignore'] });",
    "let async = '';",
    "child.stdout.on('data', (chunk) => { async += chunk; });",
    "child.on('close', () => process.stdout.write(JSON.stringify([sync, async])));",
  ].join("\n");

describe("the run's token in a child's env (023-36, B7)", { timeout: 60_000 }, () => {
  it("reaches sync and async children with an env of their own", () => {
    const seen = observe({ "main.mjs": MAIN("token-0123456789abcdef") });
    expect(JSON.parse(seen.stdout)).toEqual(["token-0123456789abcdef", "token-0123456789abcdef"]);
  });

  it("is absent when the run carries none", () => {
    const seen = observe({ "main.mjs": MAIN(null) });
    expect(JSON.parse(seen.stdout)).toEqual(["undefined", "undefined"]);
  });
});
