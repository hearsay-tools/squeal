import { readFileSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { blobHash, type ObjectFormat } from "../../../hash/blob.js";
import type { AbsolutePath, RelativePath } from "../../../types/common.js";
import type { LintFileResult, LintHeld } from "../../pass/provider.js";
import type { OxlintInstall } from "./discover.js";
import { fileResults, type OxlintReport, parseRun } from "./output.js";
import type { Preload, PreloadReport } from "./preload.js";
import { type GroupRun, runInGroup } from "./spawn.js";

/*
 * Spec 017 D11 "Running" and "unknown, not keyed": one fresh oxlint
 * process over named files, and what its exit, output and preload report
 * make of each file. `failure` is a D3 failure (a timeout, a throw, an
 * exit), counted toward D9's 3 in 10 minutes.
 */

export interface RunContext {
  readonly root: AbsolutePath;
  readonly node: string;
  readonly install: OxlintInstall;
  readonly preload: Preload;
  readonly format: ObjectFormat;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly guardMs: number;
  readonly signal: AbortSignal;
}

/** One run: its process, its parsed stdout and what its JavaScript side used. */
export interface OxlintRun {
  readonly process: GroupRun;
  readonly report: OxlintReport | null;
  /** The first line it printed instead of JSON; `null` with a report. */
  readonly text: string | null;
  readonly held: ReadonlyMap<RelativePath, LintHeld>;
  /** Why every named file is `unknown`, or `null`. */
  readonly unknown: string | null;
  /** A D3 failure's reason, or `null`. */
  readonly failure: string | null;
}

export async function runOxlint(ctx: RunContext, args: readonly string[]): Promise<OxlintRun> {
  const reportPath = ctx.preload.reportPath();
  const process = await runInGroup(
    ctx.node,
    ["--import", ctx.preload.path, ctx.install.bin, ...args],
    {
      cwd: ctx.root,
      env: {
        ...ctx.env,
        SQUEAL_OXLINT_OBSERVE: reportPath,
        SQUEAL_OXLINT_FORMAT: ctx.format,
        SQUEAL_OXLINT_PACKAGE: ctx.install.packageDir,
      },
      guardMs: ctx.guardMs,
      signal: ctx.signal,
    },
  );
  const observed = ctx.preload.read(reportPath);
  const parsed = parseRun(process.stdout);
  const report = "report" in parsed ? parsed.report : null;
  const text = "text" in parsed ? parsed.text || firstLine(process.stderr) : null;
  const held = observed === null ? new Map() : heldOf(ctx.root, observed);
  const failure = failureOf(process, observed, report, ctx.guardMs);
  return { process, report, text, held, unknown: failure ?? unknownOf(observed, held), failure };
}

function failureOf(
  run: GroupRun,
  observed: PreloadReport | null,
  report: OxlintReport | null,
  guardMs: number,
): string | null {
  if (run.timedOut) return `timed out after ${guardMs / 1000} s`;
  if (run.error !== null) return `oxlint did not start: ${run.error}`;
  if (run.signal !== null) return `oxlint ended by ${run.signal}`;
  if (observed?.uncaught != null) return `oxlint's JavaScript side threw: ${observed.uncaught}`;
  if (observed === null)
    return `oxlint exited with code ${run.code} and no report from Squeal's preload`;
  if (report === null)
    return run.code === 0 || run.code === 1 ? null : `oxlint exited with code ${run.code}`;
  const errors = report.diagnostics.some((d) => d.severity === "error");
  return run.code === 0 || (run.code === 1 && errors)
    ? null
    : `oxlint exited with code ${run.code}`;
}

/** D11, after row 017-07's rule: a thread or process started, or a project read the preload cannot hash. */
function unknownOf(
  observed: PreloadReport | null,
  held: ReadonlyMap<RelativePath, LintHeld>,
): string | null {
  if (observed?.started != null) return `oxlint's JavaScript side started ${observed.started}`;
  for (const [path, use] of held) {
    if (use.unobserved === true)
      return `oxlint's JavaScript side read ${path} in a way Squeal does not observe`;
  }
  return null;
}

/** The preload's absolute paths as the root's relative ones; `node_modules` is the install's. */
function heldOf(root: AbsolutePath, observed: PreloadReport): Map<RelativePath, LintHeld> {
  const roots = [...new Set([root, realpathOr(root)])];
  const relativeTo = (path: string): RelativePath | null => {
    const best = roots
      .map((r) => relative(r, path))
      .sort(
        (a, b) => Number(a.startsWith("..")) - Number(b.startsWith("..")) || a.length - b.length,
      )[0];
    if (best === undefined || best === "") return null;
    const parts = best.split(sep);
    return parts.includes("node_modules") ? null : (parts.join("/") as RelativePath);
  };
  const held = new Map<RelativePath, LintHeld>();
  for (const [path, blobs] of observed.reads) {
    const rel = relativeTo(path);
    if (rel !== null) held.set(rel, { others: [...blobs].sort() });
  }
  for (const path of observed.unobserved) {
    const rel = relativeTo(path);
    if (rel !== null) held.set(rel, { others: held.get(rel)?.others ?? [], unobserved: true });
  }
  return held;
}

/**
 * The blob of each named path on disk now, `null` for one gone: after a run,
 * the bytes its native side most likely read (D11; a change and its undo
 * within one run is not seen).
 */
export function blobsNow(
  root: AbsolutePath,
  paths: Iterable<RelativePath>,
  format: ObjectFormat,
): Map<RelativePath, string | null> {
  const out = new Map<RelativePath, string | null>();
  for (const path of paths) {
    try {
      out.set(path, blobHash(readFileSync(join(root, path)), format));
    } catch {
      out.set(path, null);
    }
  }
  return out;
}

/** Each named file's result from a run that printed a report. */
export function resultsOf(
  run: OxlintRun,
  texts: ReadonlyMap<RelativePath, string>,
): Map<RelativePath, LintFileResult> {
  const reason = run.unknown ?? (run.report === null ? configReason(run.text) : null);
  if (reason !== null || run.report === null) {
    return new Map(
      [...texts.keys()].map((p) => [p, { unknown: reason ?? "oxlint printed no report" }]),
    );
  }
  return fileResults(run.report.diagnostics, texts);
}

/** D9's line for a config that does not load, in oxlint's words. */
function configReason(text: string | null): string {
  return `the oxlint config does not load: ${text === null || text === "" ? "oxlint printed no report" : text}`;
}

function firstLine(text: string): string {
  return text.trimStart().split("\n")[0]?.trimEnd() ?? "";
}

function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
