import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { stripVTControlCharacters } from "node:util";
import { cap } from "../text.js";
import type {
  CheckError,
  CheckErrorCause,
  DiagnosticFingerprint,
  SourceLocation,
} from "../types/index.js";

/** Longest `summary`, in characters. Deltas show it whole; full text stays in the run log. */
export const SUMMARY_MAX_CHARS = 300;

/** A pattern, or one read at use, and what replaces each match. */
type Rule = readonly [RegExp | (() => RegExp), string | ((match: string) => string)];

/*
 * Parts of a first line that change between runs of the same failure. Other
 * values of an assertion are kept: "expected 1 to be 2" and "expected 1 to be
 * 3" are different failures (vision: "FAIL -> FAIL: quiet, unless the failure
 * itself changed"). Spec 001 D6: "normalization removes times, durations,
 * addresses, UUIDs, hex identifiers of 16 or more characters and temp or
 * cache directory paths". These rules apply inside assertion values too, so
 * an assertion on a hash or a UUID reads as the same failure whichever wrong
 * hash it received (review wave 4.5, N7): a changed wrong hash is not
 * delivered as a changed failure. An ephemeral port is one too (task 011-14,
 * issue 28), but only after a host or the word `port`, so a source line in
 * `path:line:col` is kept.
 */
const VOLATILE: readonly Rule[] = [
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<time>"],
  [/\b\d+(?:\.\d+)?\s?ms\b/g, "<n>ms"],
  [/\b0x[0-9a-f]+\b/gi, "0x<addr>"],
  // An IPv4 address, `localhost`, a bracketed IPv6 address or a URL's host; never `path:line:col`.
  [
    /(?<![\w.-])((?:\d{1,3}\.){3}\d{1,3}|localhost|\[[0-9a-f:.]+\]|(?<=:\/\/)[\w.-]+):\d{1,5}\b(?!:\d)/gi,
    "$1:<port>",
  ],
  [/\b(port\s+)\d{1,5}\b/gi, "$1<port>"],
  // A cache path names a tool's scratch space; its segments are hashes and run ids.
  [/(?:[^\s'"`(]*\/)?node_modules\/\.cache\/[^\s'"`):,]*/g, "<cache>"],
  [() => tempRoots().pattern, maskTemp],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  // At least one letter, so a long decimal value in an assertion is kept.
  [/\b(?=[0-9a-f]*[a-f])[0-9a-f]{16,}\b/gi, "<hex>"],
];

/*
 * A segment a temp directory's maker draws at random: a `mkdtemp` suffix (six
 * letters and digits, not all lower case, so `-module` is a name), a UUID, a
 * hex run as `<hex>` masks it, or one of those masks already applied.
 */
const RANDOM_SEGMENT = [
  /-(?![a-z]{6}$)[A-Za-z0-9]{6}$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^(?=[0-9a-f]*[a-f])[0-9a-f]{16,}$/i,
  /^<(?:hex|uuid)>$/,
];

/**
 * `<tmp>` and the path's tail after its last random segment below a temp
 * root, or the path unchanged when no root holds it. Below a root the first
 * segment always counts as random (spec 001 D6), so `/tmp/squeal-<uid>/tmp/<key>/x-AbC123/a.js`
 * and the same file below that daemon's own temp directory both read
 * `<tmp>/a.js`. A path already masked to `<tmp>` keeps its first segment:
 * a fingerprint the previous rules stored normalizes to what these give.
 */
function maskTemp(path: string): string {
  const masked = path.startsWith("<tmp>/");
  const root = masked ? "<tmp>" : tempRoots().roots.find((r) => path.startsWith(`${r}/`));
  if (root === undefined) return path;
  const segments = path.slice(root.length + 1).split("/");
  let last = masked ? -1 : 0;
  segments.forEach((s, i) => {
    if (RANDOM_SEGMENT.some((r) => r.test(s))) last = i;
  });
  return ["<tmp>", ...segments.slice(last + 1)].join("/");
}

interface TempRoots {
  readonly dir: string;
  readonly roots: readonly string[];
  /** A path below one of `roots` or below `<tmp>`, not inside a longer path. */
  readonly pattern: RegExp;
}

let cachedRoots: TempRoots | null = null;

/**
 * The temp directory as `os.tmpdir()` names it and as it resolves (macOS
 * links `/var` to `/private/var`), and `/tmp`, which tools use whatever
 * `TMPDIR` says; longest first. Read at use, not at load: a daemon sets its
 * own `TMPDIR` after this module loads (task 011-14).
 */
function tempRoots(): TempRoots {
  const dir = tmpdir().replace(/\/+$/, "");
  if (cachedRoots?.dir === dir) return cachedRoots;
  let real = dir;
  try {
    real = realpathSync(dir);
  } catch {
    // A missing temp directory has no other spelling.
  }
  const roots = [...new Set([dir, real, "/tmp"])]
    .filter((p) => p !== "")
    .sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `(?<![\\w.-])(?:<tmp>|${roots.map(escapeRegExp).join("|")})(?:/[^\\s/'"\`):,]+)+`,
    "g",
  );
  cachedRoots = { dir, roots, pattern };
  return cachedRoots;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstLine(text: string): string {
  // Colour codes from the runner's formatter.
  const line = stripVTControlCharacters(text)
    .split(/\r?\n/)
    .find((l) => l.trim() !== "");
  return (line ?? "").trim().replace(/\s+/g, " ");
}

function normalize(line: string): string {
  return VOLATILE.reduce((text, [rule, replacement]) => {
    const pattern = typeof rule === "function" ? rule() : rule;
    return typeof replacement === "string"
      ? text.replace(pattern, replacement)
      : text.replace(pattern, replacement);
  }, line);
}

function where(location: SourceLocation | null): string {
  return location === null ? "?" : `${location.path}:${location.line}:${location.column}`;
}

/**
 * Fingerprint and concise summary of a failed check.
 *
 * Spec 001 D6: "a **diagnostic fingerprint** (normalized first error line plus
 * source location)". The line is the first non-empty line of
 * `errors[0].message`, prefixed with the error name; the location is
 * `errors[0].location`, else `fallback` (the test's own location). Later
 * errors and lines are left out, so a changed stack or diff alone is not a
 * changed failure. The summary adds the diff's first changed lines (task
 * 001-221); the fingerprint does not.
 */
export function describeFailure(
  errors: readonly CheckError[],
  fallback: SourceLocation | null,
): { readonly fingerprint: DiagnosticFingerprint; readonly summary: string } {
  const first = errors[0];
  if (first === undefined) {
    return { fingerprint: `fail @ ${where(fallback)}`, summary: "failed without an error message" };
  }
  const line = firstLine(first.message);
  const location = first.location ?? fallback;
  const more = errors.length - 1;
  const text = withCauses(
    `${first.phase === "setup" ? "setup failed: " : ""}${withCode(line === "" ? first.name : line, first.code)}`,
    first.causes ?? [],
  );
  const summary = more > 0 ? `${text} (${more} more error${more === 1 ? "" : "s"})` : text;
  const recorder = errors.find((e) => e.recorder !== undefined)?.recorder;
  return {
    fingerprint: `${first.name}: ${normalize(line)} @ ${where(location)}`,
    summary: withRecorder(
      withDiff(summary, first.diff === null ? null : diffText(first.diff)),
      recorder,
    ),
  };
}

/**
 * The version of the rules above. A store whose fingerprints an older one
 * wrote has them normalized again once (`refingerprint`, task 011-14).
 */
export const FINGERPRINT_RULES = 2;

/**
 * A stored fingerprint under the current rules: its message part normalized
 * again, its name and location kept. Every rule maps its own output to
 * itself, and a path an older rule masked to `<tmp>` loses what the current
 * rule masks, so a stored fingerprint reads as the same failure's fresh one.
 */
export function renormalizeFingerprint(fingerprint: DiagnosticFingerprint): DiagnosticFingerprint {
  const name = fingerprint.indexOf(": ");
  const at = fingerprint.lastIndexOf(" @ ");
  if (name < 0 || at < name) return fingerprint;
  return `${fingerprint.slice(0, name + 2)}${normalize(fingerprint.slice(name + 2, at))}${fingerprint.slice(at)}`;
}

/**
 * Spec 001 D11 Fidelity (task 001-390): a failure with a signature of
 * Squeal's recorder says it ran under it, within `SUMMARY_MAX_CHARS`; the note
 * keeps its room, as causes do. Not in the fingerprint.
 */
function withRecorder(summary: string, recorder: string | undefined): string {
  if (recorder === undefined) return summary;
  const note = cap(
    `; ran under Squeal's recorder in NODE_OPTIONS: ${recorder}`,
    SUMMARY_MAX_CHARS / 2,
  );
  return `${cap(summary, SUMMARY_MAX_CHARS - note.length)}${note}`;
}

/** One link of a cause chain as Squeal prints it: its message, with its code when the message lacks it. */
export function causeText(cause: CheckErrorCause): string {
  return withCode(cause.message === "" ? (cause.code ?? "") : cause.message, cause.code);
}

/** `text (CODE)`, unless the text already names the code. */
export function withCode(text: string, code: string | undefined): string {
  return code === undefined || text.includes(code) ? text : `${text} (${code})`;
}

/**
 * Task 001-361: `fetch failed; cause: connect ECONNREFUSED 127.0.0.1:3000`.
 * The causes keep their room in `SUMMARY_MAX_CHARS`, so a long first line
 * cannot cut the code that names the failure's reason; the line keeps at
 * least `LINE_MIN_CHARS`.
 */
function withCauses(text: string, causes: readonly CheckErrorCause[]): string {
  if (causes.length === 0) return text;
  const chain = causes.map((c) => `; cause: ${causeText(c)}`).join("");
  const shown = cap(chain, SUMMARY_MAX_CHARS - Math.min(text.length, LINE_MIN_CHARS));
  return `${cap(text, SUMMARY_MAX_CHARS - shown.length)}${shown}`;
}

/** Room the first line keeps beside a diff, so a long assertion still says what failed. */
const LINE_MIN_CHARS = 120;

/** Changed lines of a diff a summary keeps; the cap usually ends them first. */
const DIFF_LINES = 8;

/**
 * Task 001-221: Vitest prints both sides of a deep equality truncated
 * (`{ commands: [ 'npm ci' ], …(1) }`), so a first line alone can hide the
 * field that differs. The diff's legend and its first changed lines, one
 * line, `null` for a diff with no changed line.
 */
function diffText(diff: string): string | null {
  const lines = stripVTControlCharacters(diff).split(/\r?\n/);
  const legend = lines.slice(0, 2).map((l) => l.trim());
  const labelled = /^- \S/.test(legend[0] ?? "") && /^\+ \S/.test(legend[1] ?? "");
  const changed = (labelled ? lines.slice(2) : lines)
    .filter((l) => /^[-+]/.test(l))
    .slice(0, DIFF_LINES)
    .map((l) => `${l[0]} ${l.slice(1).trim().replace(/\s+/g, " ")}`);
  if (changed.length === 0) return null;
  return `diff${labelled ? ` (${legend.join(", ")})` : ""}: ${changed.join(" | ")}`;
}

/** `summary` and then `diff`, within `SUMMARY_MAX_CHARS`: the line keeps at least `LINE_MIN_CHARS`. */
function withDiff(summary: string, diff: string | null): string {
  if (diff === null) return cap(summary, SUMMARY_MAX_CHARS);
  const separator = "; ";
  const room = SUMMARY_MAX_CHARS - separator.length;
  const shownDiff = cap(diff, room - Math.min(summary.length, LINE_MIN_CHARS));
  return `${cap(summary, room - shownDiff.length)}${separator}${shownDiff}`;
}
