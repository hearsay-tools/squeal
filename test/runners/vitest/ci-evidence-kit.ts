import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach } from "vitest";
import { readEvidence } from "../../../src/core/ci/inputs.js";
import { OBSERVE_VARIABLE, observeRecorder } from "../../../src/runners/observe/runtime.js";
import { CI_RECORD_VARIABLE, ciHook } from "../../../src/runners/vitest/ci-record.js";

/*
 * Spec 018 D9: a script run as `squeal ci record` runs a process of the
 * command, with the CI hook taking evidence and, when asked, the daemon's
 * recorder beside it. Shared by the evidence tests.
 */

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A new directory, by its real path, removed after the test. */
export function temp(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-ci-evidence-")));
  temps.push(dir);
  return dir;
}

/** `root`, emptied and filled with `files`. */
export function fill(root: string, files: Record<string, string>): void {
  rmSync(root, { recursive: true, force: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

const preload = (path: string) => `--import=${pathToFileURL(path).href}`;

/** `node script.mjs` in `root`, with the CI hook taking evidence into `evidence`, the daemon's recorder into `observed`. */
export function run(root: string, out: { evidence?: string; observed?: string }): void {
  const imports: string[] = [];
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_OPTIONS;
  if (out.observed !== undefined) {
    imports.push(preload(observeRecorder() as string));
    const file = join(root, "test/a.test.ts");
    env[OBSERVE_VARIABLE] = JSON.stringify({ out: out.observed, root, skip: [], file });
  }
  if (out.evidence !== undefined) {
    imports.push(preload(ciHook() as string));
    const evidence = { out: out.evidence, root, skip: [], format: "sha1" };
    env[CI_RECORD_VARIABLE] = JSON.stringify({ evidence });
  }
  execFileSync(process.execPath, [...imports, "script.mjs"], { cwd: root, env, stdio: "pipe" });
}

/** Git's blob id of `text`. */
export const blob = (text: string) =>
  execFileSync("git", ["hash-object", "--stdin"], { input: text }).toString().trim();

/** `script` run in a new root holding `files` and `links`; the evidence its process took. */
export function evidenceOf(
  script: string,
  files: Record<string, string>,
  links: Record<string, string> = {},
) {
  const root = join(temp(), "root");
  fill(root, { ...files, "script.mjs": script });
  for (const [link, target] of Object.entries(links)) symlinkSync(target, join(root, link));
  const evidence = temp();
  run(root, { evidence });
  return readEvidence(evidence);
}
