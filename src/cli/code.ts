import { relative, resolve } from "node:path";
import { functionName } from "../core/delivery/code-format.js";
import { codeSource, withCode } from "../core/delivery/code-source.js";
import { worktreeIdFor } from "../core/fs/index.js";
import { CLI_READ_RETRY_MS, withStatusStore } from "../core/status/index.js";
import { plural } from "../core/text.js";
import type { DecisionKind } from "../core/types/code.js";
import type { RelativePath } from "../core/types/index.js";
import { type CodeReport, type CodeReportFile, readCodeReport } from "./code-report.js";
import type { CliIo } from "./main.js";
import { waitConsumer } from "./status-wait.js";

/*
 * Spec 015 D6: `squeal code [<path>...] [--changed] [--json]`, the details
 * a delivery and status only count. Exit 0 with an answer, 1 when the
 * stores cannot answer (complexity off, no code store yet, status
 * unavailable), 2 on a usage error.
 */

export const CODE_USAGE = "squeal code [<path>...] [--changed] [--json]";

/** Why the code store gave no answer, as a line. */
type NoAnswer = { readonly message: string };

/** `if 12, logical 6`: the decision points by kind, most first. */
function decisionsText(decisions: Readonly<Partial<Record<DecisionKind, number>>>): string {
  return Object.entries(decisions)
    .sort(([a, x = 0], [b, y = 0]) => y - x || a.localeCompare(b))
    .map(([kind, n]) => `${kind} ${n}`)
    .join(", ");
}

const kib = (bytes: number) => `${Math.round(bytes / 1024)} KiB`;

function fileLine(f: CodeReportFile, limit: number): string {
  switch (f.reason) {
    case "too-big":
      return `  ${f.path}: ${kib(f.size)}, over the ${kib(limit)} limit; its functions are not counted`;
    case "parse-error":
      return `  ${f.path}: does not parse; ${plural(f.unknown ?? 0, "function")} in its errors not judged`;
    case "not-counted":
      return `  ${f.path}: not counted yet`;
  }
}

/** The human rendering of a report. */
export function formatCodeReport(report: CodeReport): string {
  const { threshold } = report;
  const changed = report.changedSince;
  const head =
    report.paths === null
      ? `Complexity: ${plural(report.functions.length, "function")} ${changed === undefined ? `over ${threshold}` : "changed"}`
      : `Complexity: ${plural(report.functions.length, "function")} in ${report.paths.join(", ") || "."}, threshold ${threshold}`;
  const since =
    changed === undefined
      ? []
      : changed === null
        ? ["No session is registered in this worktree, so nothing changed since one started."]
        : [
            `Changed since revision ${changed.revision}, ${changed.scope === "session" ? "when this session registered" : "the oldest registration in this worktree"}.`,
          ];
  const lines = report.functions.map((f) => {
    const where = f.line === null ? f.path : `${f.path}:${f.line}`;
    const decisions = decisionsText(f.decisions);
    const cc =
      f.complexity === null
        ? "not counted"
        : `CC ${f.complexity}${decisions === "" ? "" : ` (${decisions})`}`;
    const state =
      f.outcome === "fail"
        ? `over since revision ${f.changedAt}`
        : f.outcome === "pass"
          ? "at or under"
          : f.outcome;
    return `  ${where}  ${functionName({ ...f, kind: "code" })}  ${cc}, ${state}`;
  });
  const files =
    report.files.length === 0
      ? []
      : ["Not judged:", ...report.files.map((f) => fileLine(f, report.maxFileBytes))];
  return `${[head, ...since, ...lines, ...files].join("\n")}\n`;
}

/** `squeal code`. */
export function codeCommand(args: readonly string[], io: CliIo): number {
  const json = args.includes("--json");
  const changed = args.includes("--changed");
  const unknown = args.find((a) => a.startsWith("--") && a !== "--json" && a !== "--changed");
  if (unknown !== undefined) {
    io.stderr(`squeal code: unknown option "${unknown}"\n\nUsage: ${CODE_USAGE}\n`);
    return 2;
  }
  const positional = args.filter((a) => !a.startsWith("--"));
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  const read = withStatusStore(
    cwd,
    { busyRetryMs: CLI_READ_RETRY_MS },
    ({ store, root, commonDir }): CodeReport | NoAnswer => {
      const paths: RelativePath[] | null =
        positional.length === 0 ? null : positional.map((p) => relative(root, resolve(cwd, p)));
      const outside = paths?.find((p) => p.startsWith(".."));
      if (outside !== undefined) return { message: `"${outside}" is outside the worktree ${root}` };
      const source = codeSource(commonDir, root);
      const report = withCode(source, ({ store: code, complexity }) =>
        code.read(() =>
          readCodeReport(store, code, worktreeIdFor(root), complexity, {
            paths,
            changed,
            shell: waitConsumer(env),
          }),
        ),
      );
      if (report === null) {
        return source.policy() === null
          ? { message: "Complexity is off: complexity.enabled is not true in squeal.config.json." }
          : { message: "The code store cannot be read." };
      }
      return report === "missing"
        ? { message: "Complexity: no file counted yet; the daemon counts once it runs." }
        : report;
    },
  );
  if (!("available" in read) || !read.available) {
    const answer = "available" in read ? read : { v: 1, available: false, message: read.message };
    io.stdout(json ? `${JSON.stringify(answer, null, 2)}\n` : `${read.message}\n`);
    return 1;
  }
  io.stdout(json ? `${JSON.stringify(read, null, 2)}\n` : formatCodeReport(read));
  return 0;
}
