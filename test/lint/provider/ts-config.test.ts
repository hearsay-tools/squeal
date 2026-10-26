import { describe, expect, it } from "vitest";
import { refreshLevel } from "../../../src/core/lint/pass/session.js";
import type { LintRunReport, LintSnapshot } from "../../../src/core/lint/provider/index.js";
import {
  cli,
  type Major,
  onDisk,
  project,
  provider,
  read,
  workerScript,
  write,
} from "./helpers.js";

/*
 * Review 0.1.348 B2: an `eslint.config.ts` and the rule module it imports
 * are in the closure, whether jiti or Node's type stripping loads them, so
 * the rule's edit refreshes the thread and the config's edit the instance
 * (D4), and both move every key (D5).
 */

const LOADERS: readonly { major: Major; loader: string; env: Record<string, string> }[] = [
  { major: 10, loader: "jiti", env: {} },
  { major: 9, loader: "jiti", env: {} },
  {
    major: 10,
    loader: "Node's type stripping",
    env: { ESLINT_FLAGS: "unstable_native_nodejs_ts_config" },
  },
];

describe.each(LOADERS)("ESLint $major, a TS config loaded by $loader", ({ major, env }) => {
  it("the closure holds the config and its rule module; their edits refresh as D4 says", async () => {
    const root = project("ts-config", major);
    const eslint = provider(root, { env });
    expect(await eslint.open()).toHaveProperty("configFiles", ["eslint.config.ts"]);
    let snapshot = (await eslint.refresh("none")) as LintSnapshot;
    expect(snapshot.closure).toEqual(expect.arrayContaining(["eslint.config.ts", "rule.ts"]));
    const messages = async () => {
      const report = (await eslint.lint(onDisk(root, ["src/a.js"]))) as LintRunReport;
      expect(report.results).toEqual(cli(root, ["src/a.js"], env));
      const result = report.results.get("src/a.js");
      return result !== undefined && "findings" in result
        ? result.findings.map((f) => f.message)
        : result;
    };
    expect(await messages()).toEqual(["before", "inline before"]);

    // The rule module's code alone; the plugin's name and version stay.
    write(root, "rule.ts", read(root, "rule.ts").replace('"before"', '"after"'));
    const thread = refreshLevel(["rule.ts"], snapshot.declaration, snapshot.closure);
    expect(thread).toBe("thread");
    snapshot = (await eslint.refresh(thread)) as LintSnapshot;
    expect(await messages()).toEqual(["after", "inline before"]);

    // The root config's inline rule code.
    write(
      root,
      "eslint.config.ts",
      read(root, "eslint.config.ts").replace('"inline before"', '"inline after"'),
    );
    const instance = refreshLevel(["eslint.config.ts"], snapshot.declaration, snapshot.closure);
    expect(instance).toBe("instance");
    snapshot = (await eslint.refresh(instance)) as LintSnapshot;
    expect(snapshot.closure).toEqual(expect.arrayContaining(["eslint.config.ts", "rule.ts"]));
    expect(await messages()).toEqual(["after", "inline after"]);
  }, 60_000);
});

describe("a config load the worker does not see", () => {
  it("turns the provider off rather than report a closure without it", async () => {
    const root = project("ts-config");
    const eslint = provider(root, {
      script: workerScript("test/lint/provider/blind-worker.ts"),
    });
    const off = { off: "the ESLint worker cannot see which files eslint.config.ts loads" };
    expect(await eslint.open()).toEqual(off);
    expect(await eslint.refresh("instance")).toEqual(off);
  }, 60_000);
});
