import type { CheckError, RunReport } from "../../core/types/index.js";

/*
 * Spec 001 D11 Fidelity (task 001-390, research injected-environment O4): a
 * failure whose text carries a signature of the recorder says it ran under
 * Squeal's recorder. Said only on these signatures, since said always it is
 * noise. Found in the whole message, the stack and the causes: a failed
 * `execFileSync` holds the child's stderr below its first line.
 */

interface Signature {
  readonly pattern: RegExp;
  /** What `CheckError.recorder` says. */
  readonly text: string;
  /** Points at the recorder only while it was in the run's `NODE_OPTIONS`. */
  readonly inNodeOptions: boolean;
}

const SIGNATURES: readonly Signature[] = [
  {
    // a `--require` preload, the recorder's beside a project's own, parses the nearest package.json
    pattern: /ERR_INVALID_PACKAGE_CONFIG|Invalid package config /,
    text: "a --require preload makes Node parse the nearest package.json (ERR_INVALID_PACKAGE_CONFIG)",
    inNodeOptions: true,
  },
  {
    // Node 16 and 18 before 18.18 (probe, task 001-390)
    pattern: /--import is not allowed in NODE_OPTIONS|bad option: --import\b/,
    text: "Node before 18.18 rejects its --import",
    inNodeOptions: true,
  },
  {
    // `Cannot find module '<plugin>/dist/observe/recorder.cjs'`, with `imported from …` under `--import`
    pattern: /Cannot find module '[^'\n]*\/(?:observe|node-test|runtime)\/recorder\.cjs'/,
    text: "its file is missing",
    inNodeOptions: false,
  },
];

/** The signature `error` carries, `undefined` for none; `inNodeOptions` when the recorder was in the run's `NODE_OPTIONS`. */
export function recorderSignature(error: CheckError, inNodeOptions: boolean): string | undefined {
  const text = [error.message, error.stack ?? "", ...(error.causes ?? []).map((c) => c.message)]
    .join("\n")
    .concat(error.code === undefined ? "" : `\n${error.code}`);
  return SIGNATURES.find((s) => (inNodeOptions || !s.inNodeOptions) && s.pattern.test(text))?.text;
}

/** `report` with `CheckError.recorder` set on each error that carries a signature. */
export function withRecorderSignatures(report: RunReport, inNodeOptions: boolean): RunReport {
  const signed = (errors: readonly CheckError[]) =>
    errors.map((error) => {
      const recorder = recorderSignature(error, inNodeOptions);
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
