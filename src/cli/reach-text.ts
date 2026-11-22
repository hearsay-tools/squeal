import type { GatewayEntry, ReachReport } from "../core/reach/report-types.js";
import type { StaleFallback } from "../core/reach/types.js";
import { plural } from "../core/text.js";
import type { EpochMs } from "../core/types/common.js";

/* Spec 015 D11: how `squeal impact` writes shares, seconds, the stale line and the gateways (row 015-128). */

export const pct = (share: number) =>
  share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`;
export const secs = (s: number) => `${s < 10 ? Math.round(s * 10) / 10 : Math.round(s)} s`;
export const day = (at: EpochMs) => new Date(at).toISOString().slice(0, 10);

/** Row 015-128: the header line that names every test file read at no current key. */
export function staleLine(stale: StaleFallback, command: string): string {
  const uses = (n: number) => (n === 1 ? "uses" : "use");
  const read = [
    ...(stale.closures === 0
      ? []
      : [`${plural(stale.closures, "test file")} ${uses(stale.closures)} the newest stored closure`]),
    ...(stale.walks === 0
      ? []
      : [`${plural(stale.walks, "test file")} ${uses(stale.walks)} the newest stored import walk`]),
  ].join(" and ");
  const span =
    day(stale.oldestAt) === day(stale.newestAt)
      ? `stored on ${day(stale.oldestAt)}`
      : `stored from ${day(stale.oldestAt)} to ${day(stale.newestAt)}`;
  return `Stale: this worktree has no closure or walk at its current inputs for some test files, so ${read}, ${span}; ${command} start or ${command} warmup refreshes them.`;
}

/** `setup test/setup.ts`, `runtime read (observed path) package.json`. */
function gatewayName(entry: GatewayEntry): string {
  const mode = entry.mode === undefined ? "" : ` (${entry.mode})`;
  return `${entry.kind}${mode} ${entry.gateway}`;
}

function gatewayLines(entry: GatewayEntry, at: number): string[] {
  const files = entry.editedFiles === 1 ? "" : ` of ${plural(entry.editedFiles, "file")}`;
  return [
    `  ${at}. ${gatewayName(entry)}: ${plural(entry.edits, "edit")}${files} re-ran ${secs(entry.editSeconds)}, ${pct(entry.editShare)} of the window's re-run seconds, through ${plural(entry.testFiles, "test file")}`,
    ...(entry.editedFiles === 1 ? [] : [`     for example ${entry.sampleFiles.join(", ")}`]),
    ...(entry.suggestion === null ? [] : [`     suggestion: ${entry.suggestion.text}`]),
    ...(entry.note === undefined ? [] : [`     note: ${entry.note}`]),
  ];
}

/** Row 015-128: the top gateways by the seconds the window's edits re-ran through them. */
export function gatewaysPart(report: ReachReport): string[] {
  const title = "Top gateways, by seconds re-run over the window's edits";
  if (report.window === null) return [`${title}: none ranked, because no edits are recorded yet.`];
  if (report.gateways.length === 0) {
    return [
      `${title}: none; no edit in the window went through a setup file, helper, barrel, input, shared module or runtime read.`,
    ];
  }
  const more = report.moreGateways;
  return [
    `${title}:`,
    ...report.gateways.flatMap((e, i) => gatewayLines(e, i + 1)),
    ...(more === 0 ? [] : [`  … and ${more} more; --limit lists more.`]),
  ];
}
