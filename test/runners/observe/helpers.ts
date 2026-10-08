import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";
import { observeEnv, observeRecorder, takeRecorded } from "../../../src/runners/observe/index.js";

const recorder = observeRecorder(
  new URL("../../../src/runners/observe/runtime.ts", import.meta.url),
);
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

export interface ObserveOptions {
  /** Symlinks to create, link path to target spelling. */
  readonly links?: Readonly<Record<string, string>>;
  /**
   * Attribute as a Vitest worker does, by `__vitest_worker__.filepath` set in
   * `main`'s process, so the settings in the env name no test file.
   */
  readonly viaVitest?: boolean;
  /** Run `main` without the recorder: only `stdout` is meaningful. */
  readonly off?: boolean;
}

/** A worktree holding `files`, and a run of `main` under the recorder attributed to `test.ts`. */
export function observe(
  files: Record<string, string>,
  main = "main.mjs",
  options: ObserveOptions = {},
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-recorder-")));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  for (const [path, target] of Object.entries(options.links ?? {})) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(target, join(root, path));
  }
  const out = join(root, ".observe");
  mkdirSync(out);
  if (recorder === null) throw new Error("recorder.cjs not found");
  const env = observeEnv(recorder, { out, root, skip: [] }, undefined);
  const settings = JSON.parse(env.SQUEAL_OBSERVE ?? "{}");
  const test = join(root, "test.ts");
  const stdout = execFileSync(process.execPath, [join(root, main)], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      ...(options.off
        ? {}
        : {
            NODE_OPTIONS: env.NODE_OPTIONS ?? "",
            SQUEAL_OBSERVE: JSON.stringify(
              options.viaVitest ? settings : { ...settings, file: test },
            ),
          }),
      ...(options.viaVitest ? { VITEST_FILE: test } : {}),
    },
  });
  const recorded = takeRecorded(out).get(test);
  const rel = (set: Set<string> | undefined) =>
    [...(set ?? [])].map((p) => p.slice(root.length + 1)).sort();
  return {
    stdout,
    paths: rel(recorded?.paths),
    listed: rel(recorded?.listed),
    recursive: rel(recorded?.recursive),
    written: rel(recorded?.written),
  };
}

/** The first line of a `viaVitest` main: the attribution a Vitest worker's state gives. */
export const VITEST_STATE = "globalThis.__vitest_worker__ = { filepath: process.env.VITEST_FILE };";
