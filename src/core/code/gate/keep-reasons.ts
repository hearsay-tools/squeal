import { compare } from "../../fs/compare.js";
import type { FileDecision } from "../../run-evidence/run-evidence.js";
import { listPaths } from "../../text.js";
import { notKept } from "./keep-write.js";

/*
 * Row 011-320: the note on the completed test files `squeal code` did not
 * keep for what its run evidence says (`keepDecisions`): one line per kind
 * of evidence, naming the first test files and the first paths behind it,
 * then how many more (the coordinator, 2026-11-12). It is told
 * with the keeper's other notes, once the report is out; the verdict, the
 * report and the exit code do not change.
 */

type Kind = FileDecision["cause"]["kind"];

/**
 * How many test files, and how many paths behind them, a line names in
 * path order before it counts the rest, as spec 020 D14.4's line on
 * incomplete closures does: in a clone with no daemon history, the reads
 * beyond the keys (research `run-evidence.md`, difference 1) can cover
 * most files.
 */
const NAMED = 3;

interface Gathered {
  readonly files: string[];
  readonly paths: Set<string>;
  /** The first file's reason, for a kind with no words of its own here. */
  readonly reason: string;
}

/** The completed files not kept, by kind of evidence, until `take`. */
export class NotKept {
  readonly #kinds = new Map<Kind, Gathered>();

  /** `path`, a completed test file with a record, was not kept for `decided`. */
  add(path: string, decided: Pick<FileDecision, "cause" | "reason">): void {
    const { kind, paths } = decided.cause;
    const at = this.#kinds.get(kind) ?? { files: [], paths: new Set(), reason: decided.reason };
    at.files.push(path);
    for (const one of paths) at.paths.add(one);
    this.#kinds.set(kind, at);
  }

  /** One line per kind, in the order each kind came first; then it holds none. */
  take(): string[] {
    const lines = [...this.#kinds].map(([kind, { files, paths, reason }]) => {
      const one = files.length === 1;
      const behind = paths.size === 0 ? "" : ` (${listPaths([...paths].sort(compare), NAMED)})`;
      const named = listPaths([...files].sort(compare), NAMED);
      const again = `the next run will run ${one ? "it" : "them"} again`;
      return `${notKept(files.length)}, because ${phrase(kind, one, reason)}${behind}: ${named}; ${again}`;
    });
    this.#kinds.clear();
    return lines;
  }
}

/** The evidence of `kind` in words, of one file or of several. */
function phrase(kind: Kind, one: boolean, reason: string): string {
  const they = one ? "it" : "they";
  const keyNames = one ? "its key names" : "their keys name";
  const keyLacks = one ? "its key lacks" : "their keys lack";
  switch (kind) {
    case "held":
      return `a merge holds a path ${keyNames}`;
    case "touched":
      return "an input was written during the run and ended as it was";
    case "runtime":
      return "the runtime's identity moved during the run";
    case "environment":
      return `${they} loaded environment files ${keyLacks}`;
    case "unstable":
      return `what ${keyNames} changed during the run`;
    case "listing":
      return `a file was added to or removed from a directory ${one ? "its key lists" : "their keys list"}`;
    case "first-seen":
      return `${they} read paths first seen during the run`;
    case "grown":
      return `${they} read paths ${keyLacks}`;
    default:
      return reason;
  }
}
