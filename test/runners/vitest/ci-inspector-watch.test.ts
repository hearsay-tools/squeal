import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/*
 * Review of 0.1.443-r2 S2 (spec 020 D19.6): a test worker watches
 * `node:inspector` only when its Vitest process said a coverage provider
 * runs (`watchWorkers`, which sets `SQUEAL_CI_NO_PROVIDER` for the workers it
 * starts). With none, `installWatch` wraps nothing and writes no log, and
 * `withWatch` reads none. Each case runs in a Node process of its own, as the
 * watch changes that process's globals.
 */

const INSPECTOR = resolve(
  import.meta.dirname,
  "../../../src/runners/vitest/ci-runtime/inspector.cjs",
);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** `script` in a new Node process with `env` added, after `inspector.cjs` is required as `watch`; its JSON output. */
function inProcess(script: string, env: NodeJS.ProcessEnv = {}): unknown {
  const raw = mkdtempSync(join(tmpdir(), "squeal-inspector-watch-"));
  dirs.push(raw);
  const { SQUEAL_CI_NO_PROVIDER: _inherited, ...base } = process.env;
  const code = [
    `const watch = require(${JSON.stringify(INSPECTOR)});`,
    `const raw = ${JSON.stringify(raw)};`,
    script,
  ].join("\n");
  const out = execFileSync(process.execPath, ["-e", code], {
    env: { ...base, ...env },
    encoding: "utf8",
  });
  const logs = existsSync(join(raw, "inspector")) ? readdirSync(join(raw, "inspector")) : null;
  const lines = (logs ?? []).flatMap((name) =>
    readFileSync(join(raw, "inspector", name), "utf8")
      .trim()
      .split("\n"),
  );
  return { ...JSON.parse(out), logs: logs === null ? null : lines.map((l) => JSON.parse(l)) };
}

/** Installs the watch, then loads the inspector while a test file runs. */
const LOAD = [
  "const builtin = process.getBuiltinModule;",
  "watch.installWatch(raw, undefined);",
  'globalThis.__vitest_worker__ = { filepath: "/w/test/a.test.ts", ctx: { projectName: "" } };',
  'process.getBuiltinModule("node:inspector");',
  "console.log(JSON.stringify({",
  "  flag: globalThis.__squealCiInspector === true,",
  "  wrapped: process.getBuiltinModule !== builtin,",
  "}));",
].join("\n");

describe("the node:inspector watch beside no coverage provider (review 0.1.443-r2 S2)", () => {
  it("installs and writes its log in a worker whose Vitest process said a provider runs", () => {
    expect(inProcess(LOAD)).toEqual({
      flag: true,
      wrapped: true,
      logs: [{ t: ["", "/w/test/a.test.ts"], i: true }],
    });
  });

  it("installs nothing and writes no log in a worker told no provider runs", () => {
    expect(inProcess(LOAD, { SQUEAL_CI_NO_PROVIDER: "1" })).toEqual({
      flag: false,
      wrapped: false,
      logs: null,
    });
  });

  it("tells the workers it starts, and reads no watch for a provider that did not start", () => {
    const script = [
      'const ended = [{ project: "", moduleId: "/w/test/a.test.ts" }];',
      "const failed = () => ({ header: { off: 'failed', note: 'x' }, files: new Map() });",
      "watch.watchWorkers(false);",
      "const off = { env: process.env.SQUEAL_CI_NO_PROVIDER ?? null, header: watch.withWatch(failed(), raw, ended).header };",
      "watch.watchWorkers(true);",
      "const on = { env: process.env.SQUEAL_CI_NO_PROVIDER ?? null, header: watch.withWatch(failed(), raw, ended).header };",
      "console.log(JSON.stringify({ off, on }));",
    ].join("\n");
    expect(inProcess(script, { SQUEAL_CI_NO_PROVIDER: "1" })).toEqual({
      off: { env: "1", header: { off: "failed", note: "x" } },
      on: {
        env: null,
        header: {
          off: "failed",
          note: "x",
          inspector: { loaded: [], unknown: [{ project: "", path: "/w/test/a.test.ts" }] },
        },
      },
      logs: null,
    });
  });
});
