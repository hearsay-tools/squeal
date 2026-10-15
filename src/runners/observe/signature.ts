import type { AbsolutePath, CheckError, RunReport } from "../../core/types/index.js";

/*
 * Spec 001 D11 Fidelity (task 001-390, research injected-environment O4;
 * review 001-401, B3): a failure whose text carries a signature of a recorder
 * the run used says it ran under Squeal's recorder. Said only on these
 * signatures, since said always it is noise. Found in the whole message, the
 * stack and the causes: a failed `execFileSync` holds the child's stderr below
 * its first line.
 */

/** The recorders a run gave its processes. */
export interface RecorderUse {
  /** Each recorder file the run used, absolute; none when it used none. */
  readonly files: readonly AbsolutePath[];
  /** One was in the run's `NODE_OPTIONS`, so every process the tests start loaded it too. */
  readonly inNodeOptions: boolean;
  /** How the runner relativized paths in error text (`WorktreePaths.relativizeText`). */
  readonly relativize: (text: string) => string;
}

/**
 * ERR_INVALID_PACKAGE_CONFIG raised as Node loaded a `--require` preload: it
 * resolves the preload from the cwd (`trySelf`), called from its preload loop,
 * an unnamed frame of the CommonJS loader on Node 24 and `loadPreloadModules`
 * on 22 (probe, review 001-401). A module's own load names `Object..js` or a
 * `require` instead.
 */
const PACKAGE = /ERR_INVALID_PACKAGE_CONFIG|Invalid package config /;
const PRELOAD =
  /\bat trySelf \(node:[^\n]*(?:\n[ \t]+at (?!require \()[^\n]*)*?\n[ \t]+at (?:node:internal\/modules\/cjs\/loader:\d|loadPreloadModules \()/;
/** Node 16 and 18 before 18.18 (probe, task 001-390). */
const OLD_NODE = /--import is not allowed in NODE_OPTIONS|bad option: --import\b/;

/** The signature `error` carries for `use`, `undefined` for none. */
export function recorderSignature(error: CheckError, use: RecorderUse): string | undefined {
  if (use.files.length === 0) return undefined;
  const text = [error.message, error.stack ?? "", ...(error.causes ?? []).map((c) => c.message)]
    .join("\n")
    .concat(error.code === undefined ? "" : `\n${error.code}`);
  if (use.inNodeOptions && PACKAGE.test(text) && PRELOAD.test(text)) {
    return "a --require preload makes Node parse the nearest package.json (ERR_INVALID_PACKAGE_CONFIG)";
  }
  if (use.inNodeOptions && OLD_NODE.test(text)) return "Node before 18.18 rejects its --import";
  // `Cannot find module '<recorder>'`, with `imported from …` under `--import`, as the runner wrote it
  const spellings = use.files.flatMap((file) => [file, use.relativize(file)]);
  return spellings.some((s) => text.includes(`Cannot find module '${s}'`))
    ? "its file is missing"
    : undefined;
}

/** `report` with `CheckError.recorder` set on each error that carries a signature of `use`. */
export function withRecorderSignatures(report: RunReport, use: RecorderUse): RunReport {
  if (use.files.length === 0) return report;
  const signed = (errors: readonly CheckError[]) =>
    errors.map((error) => {
      const recorder = recorderSignature(error, use);
      return recorder === undefined ? error : { ...error, recorder };
    });
  return {
    ...report,
    results: report.results.map((r) =>
      r.errors.length === 0 ? r : { ...r, errors: signed(r.errors) },
    ),
    fileErrors: report.fileErrors.map((f) => ({ ...f, errors: signed(f.errors) })),
  };
}
