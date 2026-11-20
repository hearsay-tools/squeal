import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { InputEvidence } from "../../src/core/ci/inputs.js";
import { listingHash } from "../../src/core/ci/inputs.js";
import {
  PART_FORMAT,
  type PartCheck,
  type PartFile,
  type PartNodeTest,
  writePart,
} from "../../src/core/ci/parts.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { configFieldHash } from "../../src/core/keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { listingPath } from "../../src/core/keys/observed.js";
import type { AbsolutePath, RelativePath } from "../../src/core/types/common.js";
import type { NodeTestProject } from "../../src/core/types/policy.js";
import type { RunReport } from "../../src/core/types/runner.js";
import { createNodeTestAdapter } from "../../src/runners/node-test/adapter.js";

/*
 * Spec 018 D25 (row 018-48): node:test parts for the export tests, made
 * from a real run of the node:test adapter in a CI-shaped clone, in the
 * shape row 018-47's recorder writes: one part per `node --test` process,
 * no project, each check with its location, the observed set of each
 * file, the probe of the Node it ran on, and read evidence for every file
 * git tracks and every listing the run made. Until 018-47's recorder
 * lands, this stands for `squeal ci record` of the same command.
 */

/** The `execArgv` of `node --test` with the reporter pair of D23 and the project's `argv`. */
export function recordedExecArgv(project: NodeTestProject): string[] {
  return [
    ...project.argv,
    "--test",
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=/opt/squeal/dist/ci/node-test-reporter.mjs",
    "--test-reporter-destination=stderr",
  ];
}

/** Runs every file of `project` in `root` and writes its part into `out`; returns the part's file. */
export async function recordNodeTest(
  root: string,
  project: NodeTestProject,
  out: string,
  run: Partial<PartNodeTest> = {},
): Promise<AbsolutePath> {
  const real = realpathSync(root) as AbsolutePath;
  const tempDir = join(out, "..", `tmp-${randomUUID()}`) as AbsolutePath;
  mkdirSync(tempDir, { recursive: true });
  const adapter = await createNodeTestAdapter(project, { root: real, tempDir });
  try {
    const [environment] = await adapter.environment();
    if (environment === undefined) throw new Error("no environment");
    const files = await adapter.testFiles();
    const logDir = join(tempDir, "logs") as AbsolutePath;
    const report = await adapter.run(files, { runId: "ci", logDir, timeoutMs: 60_000 });
    if (report.end !== "completed") throw new Error(`run ended ${report.end}`);
    const config = JSON.parse(environment.resolvedConfig) as { nodeBuild: string };
    const preloads =
      report.environmentObserved?.find((e) => e.project === project.name)?.paths ?? [];
    const nodeTest: PartNodeTest = {
      execArgv: recordedExecArgv(project),
      cwd: environment.root ?? "",
      version: environment.runnerVersion,
      nodeBuild: config.nodeBuild,
      env: Object.fromEntries(
        Object.entries(project.env).map(([name, value]) => [name, configFieldHash(value)]),
      ),
      nodeOptions: [],
      ...(preloads.length === 0 ? {} : { preloads: [...preloads] }),
      ...run,
    };
    const head = await readHead(real);
    return writePart(out as AbsolutePath, {
      format: PART_FORMAT,
      header: {
        squealVersion: "0.0.0-test",
        keyFormat: KEY_FORMAT_VERSION,
        runner: "node-test",
        runnerVersion: nodeTest.version,
        commit: head.head,
        dirty: head.dirty,
        shard: { index: 1, count: 1 },
        createdAt: Date.now(),
        source: { kind: "local" },
        end: "completed",
        observing: true,
        nodeTest,
      },
      projects: [],
      testFiles: files.map((ref) => partFile(report, ref.path)),
      evidence: evidenceOf(real, report),
    });
  } finally {
    await adapter.close();
  }
}

function partFile(report: RunReport, path: RelativePath): PartFile {
  const results = report.results.filter(
    (r) => r.check.kind === "test" && r.check.testPath === path,
  );
  const checks: PartCheck[] = results.map((r) => ({
    fullName: r.check.kind === "test" ? r.check.fullName : "",
    outcome: r.outcome === "fail" ? "fail" : r.outcome === "pass" ? "pass" : "skip",
    durationMs: r.durationMs,
    location: r.location === null ? null : { line: r.location.line, column: r.location.column },
  }));
  const observed = report.observed?.find((o) => o.testFile.path === path);
  const { testFile: _file, ...seen } = observed ?? { testFile: null };
  return {
    project: "",
    path,
    outcome: checks.some((c) => c.outcome === "fail") ? "fail" : "pass",
    durationMs: report.fileDurations?.find((d) => d.testFile.path === path)?.durationMs ?? null,
    checks,
    ...(observed === undefined ? {} : { observed: seen as PartFile["observed"] & object }),
  };
}

/** Each tracked file's blob id, and each listing the run made, as the recorder takes them at read. */
function evidenceOf(root: AbsolutePath, report: RunReport): InputEvidence {
  const evidence: Record<RelativePath, string | null> = {};
  for (const line of execFileSync("git", ["ls-files", "-s"], { cwd: root, encoding: "utf8" })
    .trim()
    .split("\n")) {
    const [meta, path] = line.split("\t");
    const blob = meta?.split(" ")[1];
    if (path !== undefined && blob !== undefined) evidence[path] = blob;
  }
  for (const observed of report.observed ?? []) {
    for (const directory of observed.directories) {
      evidence[listingPath(directory)] = listingHash(root, directory);
    }
  }
  return evidence;
}
