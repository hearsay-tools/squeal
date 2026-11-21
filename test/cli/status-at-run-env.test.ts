import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { fixture, git, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { clean, run, testOf } from "./status-at-kit.js";

/*
 * Row 023-07, review wave-7 B1: `status --at --run` started from a shell,
 * with `NODE_ENV` unset. Keying starts Vitest in the CLI process, which
 * sets `NODE_ENV`; the run's child starts with the command's environment
 * as it was, so the gate's outside-key check finds the run's environment
 * equal to its own and the run stores its result. Inside Vitest `NODE_ENV`
 * is set, which hid the failure: the command runs in a process of its own.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const CHILD = resolve(import.meta.dirname, "status-at-cli-child.ts");
const TEST = ref("test/a.test.ts");

describe("status --at --run from a shell environment (row 023-07, review wave-7 B1)", SLOW, () => {
  it("runs and stores with NODE_ENV unset, and the next --at reads the result", async () => {
    const f = fixture({
      "squeal.config.json": "{}\n",
      "src/a.ts": "export const value = 1;\n",
      [TEST.path]: testOf("a", 1),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 1; // b\n" });
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !/^(VITEST|NODE_ENV$|NODE_OPTIONS$|TEST$|SQUEAL_)/.test(name),
      ),
    );
    expect(env.NODE_ENV).toBeUndefined();
    const child = spawnSync(process.execPath, ["--import", TSX, CHILD, f.root, a, f.cacheRoot], {
      env,
      encoding: "utf8",
      timeout: 300_000,
    });
    expect(child.status, child.stderr).toBe(0);
    const report = JSON.parse(child.stdout);
    expect(report.run).toMatchObject({ selected: 1, ran: 1, stored: 1 });
    const file = report.files.find((x: { path: string }) => x.path === TEST.path);
    expect(file.at).toMatchObject({ state: "pass", origin: { kind: "run", stored: true } });

    const read = await run(f, { commit: a, json: true });
    const again = JSON.parse(read.out).files.find((x: { path: string }) => x.path === TEST.path);
    expect(again.at.state).toBe("pass");
    clean(f);
  });
});
