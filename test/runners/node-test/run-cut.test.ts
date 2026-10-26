import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { AbsolutePath, NodeTestProject, TestFileRef } from "../../../src/core/types/index.js";
import { runNodeTest } from "../../../src/runners/node-test/run/run.js";

/*
 * Row 011-230: a cut sends SIGTERM to the file's process group. The test
 * child has no handler and dies at once; the parent `node --test` handles
 * its SIGTERM in JavaScript. When the parent handles its child's death
 * first, as a descheduled parent on a loaded host can, it ends the file as
 * failed and writes the final summary: a whole stream that only Squeal's
 * signal made (main CI 40257847142, K8 "cut is file-error"). The fake Node
 * here writes that stream whenever it gets SIGTERM, so the order does not
 * depend on the host.
 */

const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-node-test-cut-"))) as AbsolutePath;
afterAll(() => rmSync(root, { recursive: true, force: true }));

const ARG = "test/held.test.mjs";
const event = (type: string, data: object) => `${JSON.stringify({ type, data })}\n`;
/** What `node --test` writes once its test child died of the group's SIGTERM before its own handler ran. */
const WHOLE =
  event("test:complete", {
    name: ARG,
    nesting: 0,
    details: {
      passed: false,
      error: { failureType: "testCodeFailure", cause: "test failed", signal: "SIGTERM" },
    },
  }) + event("test:summary", { file: null, success: false });

mkdirSync(join(root, "test"), { recursive: true });
writeFileSync(join(root, ARG), "");
writeFileSync(join(root, "whole.ndjson"), WHOLE);
const node = join(root, "node-that-ends-whole-on-sigterm");
writeFileSync(
  node,
  [
    "#!/bin/sh",
    `for arg; do case $arg in --test-reporter-destination=*) dest=\${arg#*=};; esac; done`,
    `trap 'cat ${JSON.stringify(join(root, "whole.ndjson"))} > "$dest"; exit 1' TERM`,
    "echo ready",
    "sleep 60 & wait",
    "",
  ].join("\n"),
);
chmodSync(node, 0o755);

const project: NodeTestProject = { name: "cut", node, argv: [], env: {}, include: ["test/*.mjs"] };
const held: TestFileRef = { project: "cut", path: ARG };

async function ready(logDir: string): Promise<void> {
  const stdout = join(logDir, "stdout-0.log");
  for (let waited = 0; !existsSync(stdout) || !readFileSync(stdout, "utf8").includes("ready"); ) {
    if (waited > 20_000) throw new Error("the fake node never trapped SIGTERM");
    await new Promise((r) => setTimeout(r, 20));
    waited += 20;
  }
}

describe("runNodeTest cut by Squeal's signal (row 011-230)", () => {
  it.each([
    { by: "a stop's signal", timeoutMs: null, stops: true },
    { by: "the deadline", timeoutMs: 2_000, stops: false },
  ])("completes no file whose stream turned whole after $by", async ({ timeoutMs, stops }) => {
    const logDir = join(root, "logs", randomUUID()) as AbsolutePath;
    const stop = new AbortController();
    const running = runNodeTest({
      root,
      project,
      files: [held],
      logDir,
      timeoutMs,
      ...(stops ? { signal: stop.signal } : {}),
    });
    await ready(logDir);
    if (stops) stop.abort();
    const { report } = await running;
    // The precondition: the signal made the stream whole, as the parent writes it.
    expect(readFileSync(join(logDir, "events-0.ndjson"), "utf8")).toBe(WHOLE);
    expect(report).toMatchObject({ completedFiles: [], results: [], fileErrors: [] });
    expect(report.end).toBe(stops ? "completed" : "timed-out");
  });
});
