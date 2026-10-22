import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findPython, pythonEnv } from "../../helpers/pytest-env.js";
import { type Case, PYTHONS_VARIABLE, type PytestPython, type Pythons } from "./case.js";
import { ROOT } from "./trees.js";

/*
 * The Pythons the `adapter:pytest` kind runs on (row 011-48): one
 * environment per version the cases name, synced once per comparison from
 * `python/uv.lock` under the work directory, outside both sides' worktrees,
 * so both trees key one interpreter and one set of packages. Each holds
 * `python/squeal_validity_trace.py` behind a `.pth` line, the line
 * coverage of the side's copy of the pytest runtime (`sides.ts`). Synced
 * here, in the test's process, since a driver runs with `HOME` inside the
 * work directory, where uv finds neither its cache nor its Pythons.
 */

const FIXTURE = join(ROOT, "test/keys/validity/python");
const TRACER = "squeal_validity_trace";

function stderrOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  return typeof stderr === "string" && stderr.trim() !== "" ? stderr.trim() : String(error);
}

/** `version`'s environment under `dir`, synced and traced, or why there is none. */
function sync(dir: string, version: PytestPython): { env: string } | { reason: string } {
  const found = findPython(version);
  if (!found.ok) return { reason: found.reason };
  mkdirSync(dir, { recursive: true });
  for (const name of ["pyproject.toml", "uv.lock"]) {
    writeFileSync(join(dir, name), readFileSync(join(FIXTURE, name)));
  }
  try {
    execFileSync("uv", ["sync", "--locked", "--python", found.python], {
      cwd: dir,
      env: pythonEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return { reason: `uv sync on Python ${version} failed: ${stderrOf(error)}` };
  }
  const env = join(dir, ".venv");
  const lib = join(env, "lib");
  const python = readdirSync(lib).find((name) => name.startsWith("python"));
  if (python === undefined) return { reason: `no lib/python* under ${env}` };
  const site = join(lib, python, "site-packages");
  writeFileSync(join(site, `${TRACER}.py`), readFileSync(join(FIXTURE, `${TRACER}.py`)));
  writeFileSync(join(site, `${TRACER}.pth`), `import ${TRACER}\n`);
  return { env };
}

/**
 * The variables a driver needs to run `cases`' `adapter:pytest` cases: each
 * version's environment, synced under `work/python`.
 * Empty when no case is of that kind.
 */
export function pythonsFor(cases: readonly Case[], work: string): Record<string, string> {
  const versions = new Set(
    cases.flatMap((c) => (c.kind === "adapter:pytest" ? [c.input.python] : [])),
  );
  if (versions.size === 0) return {};
  const pythons: Pythons = {};
  for (const version of [...versions].sort())
    pythons[version] = sync(join(work, "python", version), version);
  return { [PYTHONS_VARIABLE]: JSON.stringify(pythons) };
}
