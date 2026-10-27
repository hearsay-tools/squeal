import { randomUUID } from "node:crypto";
import {
  chmodSync,
  constants,
  copyFileSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import type { AbsolutePath, NodeTestProject } from "../../../src/core/types/index.js";
import { runNodeTest } from "../../../src/runners/node-test/run/run.js";
import { nodeTestRuntime } from "../../../src/runners/node-test/runtime.js";
import { tempDir } from "../../store/helpers.js";

/*
 * Spec 005 D3, project-first process commands (row 005-88): on Linux the
 * node:test leader's argv0 is `squeal <project> node-test @<id8>` when its
 * command is the daemon's own Node, and stays the command otherwise, so a
 * shim that picks its tool by argv0 still runs. The leader's arguments, its
 * test child's argv0 and the results stay as they were.
 */

const SLOW = { timeout: 60_000 } as const;

/** Each process it loads in writes its argv0 and command line to `$LABEL_OUT/<pid>.json`. */
const LEADER = `const { readFileSync, writeFileSync } = require("node:fs");
const cmdline = readFileSync("/proc/self/cmdline", "utf8").split("\\0").slice(0, -1);
const seen = { argv0: process.argv0, cmdline, child: process.env.NODE_TEST_CONTEXT !== undefined };
writeFileSync(process.env.LABEL_OUT + "/" + process.pid + ".json", JSON.stringify(seen));
`;

interface Seen {
  readonly argv0: string;
  readonly cmdline: string[];
  readonly child: boolean;
}

/** A conventional `.git`, and one that points at a git dir whose `commondir` cannot be read. */
const LAYOUTS = {
  conventional: { ".git/HEAD": "ref: refs/heads/main\n" },
  unreadable: { ".git": "gitdir: meta\n", "meta/commondir/unreadable": "" },
};

/** A checkout `label project/` with one passing node:test file. */
function checkout(layout: keyof typeof LAYOUTS = "conventional"): {
  root: AbsolutePath;
  out: string;
} {
  const root = join(tempDir("squeal-node-test-label-"), "label project");
  const files: Record<string, string> = {
    ...LAYOUTS[layout],
    "package.json": `${JSON.stringify({ name: "label", private: true })}\n`,
    "scripts/leader.cjs": LEADER,
    "test/a.test.cjs": `require("node:test")("passes", () => {});\n`,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const out = join(root, "seen");
  mkdirSync(out);
  return { root: realpathSync(root) as AbsolutePath, out };
}

async function run(root: AbsolutePath, out: string, node: string | null, env = {}) {
  const project: NodeTestProject = {
    name: "p",
    ...(node === null ? {} : { node }),
    argv: ["--require", "./scripts/leader.cjs"],
    env: { LABEL_OUT: out, ...env },
    include: ["test/*.test.cjs"],
  };
  const runtime = nodeTestRuntime();
  const { report } = await runNodeTest({
    root,
    project,
    files: [{ project: "p", path: "test/a.test.cjs" }],
    logDir: join(tempDir("squeal-node-test-label-logs-"), randomUUID()) as AbsolutePath,
    timeoutMs: 30_000,
    runtime,
  });
  expect(report.results.map((r) => `${r.check.fullName}: ${r.outcome}`)).toEqual(["passes: pass"]);
  const seen = readdirSync(out).map((n) => JSON.parse(readFileSync(join(out, n), "utf8")) as Seen);
  const leader = seen.filter((s) => !s.child);
  const child = seen.filter((s) => s.child);
  expect([leader.length, child.length]).toEqual([1, 1]);
  return { leader: leader[0] as Seen, child: child[0] as Seen, recorder: runtime.recorder };
}

/** A Node at another path than `process.execPath`: a hard link where the file system allows one. */
function otherNode(): string {
  const node = join(tempDir("squeal-node-test-label-shim-"), "node");
  try {
    linkSync(process.execPath, node);
  } catch {
    copyFileSync(process.execPath, node, constants.COPYFILE_FICLONE);
  }
  return node;
}

describe.runIf(process.platform === "linux")("the node:test leader's label (005-88)", () => {
  it(
    "labels the leader run by this Node, its arguments kept, and not its test child",
    SLOW,
    async () => {
      const { root, out } = checkout();
      const { leader, child, recorder } = await run(root, out, process.execPath);
      const label = `squeal label-project node-test @${worktreeIdFor(root).slice(0, 8)}`;
      expect(leader.argv0).toBe(label);
      expect(leader.cmdline[0]).toBe(label);
      expect(leader.cmdline.slice(1, 7)).toEqual([
        "--enable-source-maps",
        "--require",
        recorder,
        "--require",
        "./scripts/leader.cjs",
        "--test",
      ]);
      expect(leader.cmdline.at(-1)).toBe("test/a.test.cjs");
      expect(child.argv0).toBe(process.execPath);
    },
  );

  it("labels the `node` on the project's PATH when it links to this Node", SLOW, async () => {
    const { root, out } = checkout();
    const bin = tempDir("squeal-node-test-label-bin-");
    symlinkSync(process.execPath, join(bin, "node"));
    const { leader } = await run(root, out, null, { PATH: `${bin}:${process.env.PATH ?? ""}` });
    expect(leader.argv0).toMatch(/^squeal label-project node-test @[0-9a-f]{8}$/);
  });

  it("keeps the command as argv0 for another Node file, as a shim needs", SLOW, async () => {
    const { root, out } = checkout();
    const node = otherNode();
    const { leader, child } = await run(root, out, node);
    expect(leader.argv0).toBe(node);
    expect(leader.cmdline[0]).toBe(node);
    expect(child.argv0).not.toMatch(/^squeal /);
  });

  // A resolution that throws, including a file gone between two reads, ends in the same catch.
  it("launches with the command as argv0 when the git metadata cannot be read", SLOW, async () => {
    const { root, out } = checkout("unreadable");
    const { leader } = await run(root, out, process.execPath);
    expect(leader.argv0).toBe(process.execPath);
  });

  it.skipIf(process.getuid?.() === 0)(
    "launches the PATH's Node with `node` as argv0 past a directory it cannot search",
    SLOW,
    async () => {
      const { root, out } = checkout();
      const closed = tempDir("squeal-node-test-label-closed-");
      const bin = tempDir("squeal-node-test-label-bin-");
      symlinkSync(process.execPath, join(bin, "node"));
      chmodSync(closed, 0o000);
      try {
        const path = `${closed}/sub:${bin}:${process.env.PATH ?? ""}`;
        const { leader } = await run(root, out, null, { PATH: path });
        expect(leader.argv0).toBe("node");
      } finally {
        // Before the temporary directory's removal, which must read it.
        chmodSync(closed, 0o700);
      }
    },
  );
});
