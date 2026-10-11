import { describe, expect, it } from "vitest";
import { classifyShell, scopeLabel } from "../../evals/lib/index.mjs";

// Review wave 2.5, B3 (the command half; wave 2.6's contract): each test action names its
// `runner`, whether it is `informational` (help, version, listing, watch-only: never a run), and
// its `scope`, the whole suite or the paths and globs it selects as written, with any name
// filter. An npm script resolves to the command it runs, here the Ledgerline fixture's.
const tests = (text: string) =>
  classifyShell(text, { exit: 0 })
    .filter((a) => a.kind === "vitest" || a.kind === "node:test")
    .map(({ runner, informational, scope }) => ({ runner, informational, scope }));
const run = (runner: string, scope: object) => [{ runner, informational: false, scope }];

describe("a test action's runner and informational flag", () => {
  it.each([
    "npx vitest --help",
    "npx vitest -h",
    "npx vitest --version",
    "vitest -v",
    "npx vitest list",
    "npx vitest list test/money.test.ts",
    "npx vitest watch",
    "npx vitest dev",
    "npx vitest --watch",
    "npx vitest run -w",
    "npm test -- --help",
    "npm test -- --watch",
    "node --test --help",
    "node --test --watch scripts/changelog.test.mjs",
  ])("marks %s informational", (text) => {
    const [a, ...more] = tests(text);
    expect(more).toEqual([]);
    expect(a?.informational, text).toBe(true);
  });

  it("names the runner of every run, informational or not", () => {
    expect(tests("npx vitest --help && npx vitest run && npm run test:scripts")).toEqual([
      { runner: "vitest", informational: true, scope: { full: true } },
      { runner: "vitest", informational: false, scope: { full: true } },
      {
        runner: "node:test",
        informational: false,
        scope: { full: false, paths: ["scripts/*.test.mjs"] },
      },
    ]);
  });

  it("is no test action for a script run with `--test` as its own argument", () => {
    expect(tests("node scripts/changelog.mjs --test")).toEqual([]);
  });
});

describe("a test action's scope", () => {
  it("is the whole suite when nothing narrows it", () => {
    for (const text of ["npx vitest", "npx vitest run", "npm test", "npm run test", "pnpm test"])
      expect(tests(text), text).toEqual(run("vitest", { full: true }));
    expect(tests("node --test")).toEqual(run("node:test", { full: true }));
    expect(tests("npx vitest run --reporter verbose --maxWorkers 2")).toEqual(
      run("vitest", { full: true }),
    );
  });

  it("is the paths and globs as written, past flags and their values", () => {
    expect(tests("npx vitest run test/money.test.ts --reporter verbose")).toEqual(
      run("vitest", { full: false, paths: ["test/money.test.ts"] }),
    );
    expect(tests("npm test -- test/contract/ test/invoice.test.ts")).toEqual(
      run("vitest", { full: false, paths: ["test/contract/", "test/invoice.test.ts"] }),
    );
    expect(tests("node --test /tmp/unrelated.test.mjs")).toEqual(
      run("node:test", { full: false, paths: ["/tmp/unrelated.test.mjs"] }),
    );
    expect(tests("node --test --test-reporter spec scripts/changelog.test.mjs")).toEqual(
      run("node:test", { full: false, paths: ["scripts/changelog.test.mjs"] }),
    );
    expect(tests("node --test 'scripts/*.test.mjs'")).toEqual(
      run("node:test", { full: false, paths: ["scripts/*.test.mjs"] }),
    );
  });

  it("resolves an npm script to the command it runs, with the arguments passed on", () => {
    expect(tests("npm run test:scripts")).toEqual(
      run("node:test", { full: false, paths: ["scripts/*.test.mjs"] }),
    );
    expect(tests("npm test -- test/money.test.ts")).toEqual(
      run("vitest", { full: false, paths: ["test/money.test.ts"] }),
    );
    expect(tests("npm run changelog")).toEqual([]);
    expect(tests("npm run test:other")).toEqual([]);
  });

  it("carries a name filter beside the paths", () => {
    expect(tests("npm test -- -t 'Sunday'")).toEqual(
      run("vitest", { full: true, names: ["Sunday"] }),
    );
    expect(tests("npx vitest run test/clock.test.ts --testNamePattern=Sunday")).toEqual(
      run("vitest", { full: false, paths: ["test/clock.test.ts"], names: ["Sunday"] }),
    );
    expect(tests("node --test --test-name-pattern=changelog scripts/changelog.test.mjs")).toEqual(
      run("node:test", {
        full: false,
        paths: ["scripts/changelog.test.mjs"],
        names: ["changelog"],
      }),
    );
  });

  it("keeps a related or changed selection apart from the paths it names", () => {
    expect(tests("npx vitest related src/invoice.ts --run")).toEqual(
      run("vitest", { full: false, paths: [], related: ["src/invoice.ts"] }),
    );
    expect(tests("npx vitest run --changed")).toEqual(
      run("vitest", { full: false, paths: [], changed: true }),
    );
  });
});

describe("scopeLabel", () => {
  it("names a scope as the grade's earlier counters did", () => {
    expect(scopeLabel({ full: true })).toBe("full");
    expect(scopeLabel({ full: false, paths: ["test/a.test.ts"] })).toBe("files");
    expect(scopeLabel({ full: true, names: ["Sunday"] })).toBe("name");
    expect(scopeLabel({ full: false, paths: ["test/a.test.ts"], names: ["x"] })).toBe("name");
  });
});
