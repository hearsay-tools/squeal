import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { squealVersion } from "../../../src/core/daemon/version.js";
import { startRemoteHost, treeDir } from "../../../src/core/runner-host/remote/connect.js";
import type { RunnerAdapter } from "../../../src/core/types/runner.js";
import { SLOW } from "../../daemon/helpers.js";
import { buildBundle, fakeSsh, gitFixture, scratchDir } from "./helpers.js";

/*
 * Spec 021 D9, D10, D14 (row 021-13): the first connect to a remote, through
 * a fake `ssh` that runs each remote command in a directory of this
 * machine. The bundle is copied once per version and checked; the tree is
 * every tracked and non-ignored file, never an ignored one; an edit rides on
 * `invalidate`; a second connect copies nothing it has.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-remote-connect-"));
let cli = "";
beforeAll(async () => {
  cli = await buildBundle(join(scratch, "dist"));
}, SLOW.timeout);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const places = { node: process.execPath, cache: ".cache" };

/** A remote home under scratch, so its trees resolve `vitest` from the repository's `node_modules`. */
function remote(): { home: string; ssh: string } {
  const home = join(scratchDir, `remote-home-${randomUUID()}`);
  onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  return { home, ssh: fakeSsh(join(home, ".bin"), home) };
}

function fixture(): string {
  const root = gitFixture("basic", {
    ".gitignore": ".env\n.squeal-logs/\n",
    ".env": "SECRET=1\n",
  });
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

async function connect(root: string, ssh: string, lines: string[] = []): Promise<RunnerAdapter> {
  const { adapter } = await startRemoteHost({
    target: { destination: "build-box", ssh },
    places,
    launch: { execPath: process.execPath, execArgv: [], cli },
    version: squealVersion(),
    root,
    runner: "vitest",
    options: { childEnv: {} },
    policy: () => ({
      observe: false,
      exclude: [],
      excludeProjects: [],
      coverage: true,
      coverageChildren: false,
    }),
    log: (text) => lines.push(text),
  });
  onTestFinished(() => adapter.close());
  return adapter;
}

const run = (adapter: RunnerAdapter, root: string, path: string) =>
  adapter.run([{ project: "", path }], {
    runId: randomUUID(),
    logDir: join(root, ".squeal-logs", randomUUID()),
    timeoutMs: 60_000,
  });

describe("a remote runner host's first connect (row 021-13)", SLOW, () => {
  it("copies the bundle, sends the tree without its ignored files, and runs there", async () => {
    const root = fixture();
    const { home, ssh } = remote();
    const lines: string[] = [];
    const adapter = await connect(root, ssh, lines);
    const tree = join(home, treeDir(places, root), "root");

    expect(existsSync(join(home, ".cache/squeal", squealVersion(), "cli/squeal.mjs"))).toBe(true);
    expect(readFileSync(join(home, ".destinations"), "utf8")).toContain("build-box");
    expect(readFileSync(join(tree, "src/math.ts"), "utf8")).toBe(
      readFileSync(join(root, "src/math.ts"), "utf8"),
    );
    expect(existsSync(join(tree, ".env"))).toBe(false);
    expect(lines.some((line) => line.includes(`Squeal ${squealVersion()} copied`))).toBe(true);
    expect((await adapter.testFiles()).map((f) => f.path)).toContain("test/math.test.ts");

    const report = await run(adapter, root, "test/math.test.ts");
    expect(report.end).toBe("completed");
    expect(report.results.map((r) => r.outcome)).toEqual(["pass", "pass"]);
  });

  it("sends an edit with the revision's invalidate, and the next run sees it", async () => {
    const root = fixture();
    const { home, ssh } = remote();
    const adapter = await connect(root, ssh);
    const tree = join(home, treeDir(places, root), "root");

    writeFileSync(
      join(root, "src/math.ts"),
      'import { base } from "./deep.ts";\nexport const add = (a: number, b: number) => a - b;\nexport const addBase = (a: number) => a + base;\n',
    );
    rmSync(join(root, "test/each.test.ts"));
    await adapter.invalidate([
      { path: "src/math.ts", kind: "change" },
      { path: "test/each.test.ts", kind: "delete" },
      // Ignored: never sent, even when named.
      { path: ".env", kind: "change" },
    ]);
    expect(readFileSync(join(tree, "src/math.ts"), "utf8")).toContain("a - b");
    expect(existsSync(join(tree, "test/each.test.ts"))).toBe(false);
    expect(existsSync(join(tree, ".env"))).toBe(false);

    const report = await run(adapter, root, "test/math.test.ts");
    expect(report.results.map((r) => r.outcome)).toEqual(["fail", "pass"]);
  });

  it("uses the copy a second connect finds, and sends only what changed", async () => {
    const root = fixture();
    const { ssh } = remote();
    const first = await connect(root, ssh);
    await first.close();
    writeFileSync(join(root, "src/strings.ts"), "export const shout = (s: string) => s;\n");
    const lines: string[] = [];
    await connect(root, ssh, lines);
    expect(lines.some((line) => line.includes(`Squeal ${squealVersion()} present`))).toBe(true);
    expect(
      lines.some((line) => / files, 1 sent \(\d+\.\d MiB, \d+\.\d MiB on the wire\)$/.test(line)),
    ).toBe(true);
  });

  it("refuses a daemon that runs from the sources: it has no bundle to copy", async () => {
    const root = fixture();
    const { ssh } = remote();
    await expect(
      startRemoteHost({
        target: { destination: "build-box", ssh },
        places,
        launch: { execPath: process.execPath, execArgv: [], cli: "/repo/src/cli/index.ts" },
        version: squealVersion(),
        root,
        runner: "vitest",
        options: { childEnv: {} },
        policy: () => ({
          observe: false,
          exclude: [],
          excludeProjects: [],
          coverage: false,
          coverageChildren: false,
        }),
      }),
    ).rejects.toThrow(/needs Squeal's bundle/);
  });
});
