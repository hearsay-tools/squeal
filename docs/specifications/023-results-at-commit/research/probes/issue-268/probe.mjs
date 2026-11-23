// Throwaway classifier probe. No daemon, checkout, install or test runner starts.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const load = loadavg();
const cpus = availableParallelism();
if (load[0] > cpus) {
  console.log(
    JSON.stringify({ reproduced: false, reason: "one-minute load exceeds CPU count", load, cpus }),
  );
  process.exit(0);
}
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trimEnd();
const root = await mkdtemp(join(tmpdir(), "squeal-issue-268-"));
const result = { at: new Date().toISOString(), node: process.version, load, cpus, versions: [] };
try {
  for (const ref of process.argv.slice(2).length
    ? process.argv.slice(2)
    : ["squeal--v0.1.600", "HEAD"]) {
    const commit = git("rev-parse", `${ref}^{commit}`);
    const target = join(root, commit);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "package.json"), '{"type":"module"}');
    for (const file of [
      "src/core/text.ts",
      "src/core/proof/evidence.ts",
      "src/core/proof/verdict.ts",
    ]) {
      const output = join(target, file.replace(/\.ts$/, ".js"));
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, stripTypeScriptTypes(git("show", `${commit}:${file}`)));
    }
    const { failureKind } = await import(pathToFileURL(join(target, "src/core/proof/evidence.js")));
    const { verdictOf, proofExit, redCounts, lacksStage } = await import(
      pathToFileURL(join(target, "src/core/proof/verdict.js"))
    );
    const error = {
      name: "Error",
      message: "ACP input/output transport closed",
      stack: null,
      location: null,
      diff: null,
    };
    const fileFailure = { test: "(file-level error)", errors: [error] };
    const assertions = [246, 222, 211].map((line) => ({
      test: `assertion at ${line}`,
      errors: [
        {
          ...error,
          name: "AssertionError",
          message: "expected true to be false",
          stage: "body",
          location: { path: "session.test.ts", line },
        },
      ],
    }));
    const mixed = [fileFailure, ...assertions];
    const cases = [
      ["issue shape, green unread", mixed, null, []],
      ["issue shape, hypothetical green pass", mixed, { end: "pass" }, []],
      ["issue shape with --red-error", mixed, { end: "pass" }, [error.message]],
      ["assertions alone", assertions, { end: "pass" }, []],
      ["file error alone", [fileFailure], null, []],
      ["file error last", [...assertions, fileFailure], null, []],
      [
        "file error gains location only",
        [
          {
            ...fileFailure,
            errors: [{ ...error, location: { path: "session.test.ts", line: 250 } }],
          },
          ...assertions,
        ],
        null,
        [],
      ],
      [
        "assertions lose locations only",
        assertions.map((f) => ({ ...f, errors: f.errors.map((e) => ({ ...e, location: null })) })),
        { end: "pass" },
        [],
      ],
      [
        "file error records after-tests phase",
        [{ ...fileFailure, errors: [{ ...error, phase: "after-tests" }] }, ...assertions],
        null,
        [],
      ],
      [
        "after-tests phase and --red-error",
        [{ ...fileFailure, errors: [{ ...error, phase: "after-tests" }] }, ...assertions],
        { end: "pass" },
        [error.message],
      ],
    ].map(([name, failures, green, redErrors]) => {
      const red = { end: "fail", failures };
      const verdict = verdictOf(red, green, redErrors);
      return {
        name,
        kinds: failures.map((f) => failureKind(f, redErrors)),
        lacksStage: lacksStage(red),
        redCounts: redCounts(red, redErrors),
        ...verdict,
        exit: proofExit([verdict.verdict]),
      };
    });
    result.versions.push({
      ref,
      commit,
      version: JSON.parse(git("show", `${commit}:package.json`)).version,
      cases,
    });
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
