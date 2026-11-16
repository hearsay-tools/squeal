import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * CI check (row private-material-guard): no push adds private material. Only lines added in
 * `git diff <base>...HEAD` are read, by three rules, and added file names by rule 3. Text files
 * only: a file git diffs as binary is read as text when it holds no NUL byte in its first 8000
 * bytes, since then only an attribute such as `-diff` hides it. Each rule sees a line as written
 * and with JSON string escapes undone, up to three rounds for payloads serialized inside others.
 *
 *   1. an absolute home path, `/home/<name>` or `/Users/<name>`, any letters in the name; a name
 *      starting with `<`, `$`, `{` or `%` is a placeholder, one starting with `.` a file such as
 *      `/Users/.localized`, not a home; three names pass: `user`, the fake value fixtures and
 *      examples use, `runner`, GitHub's runner home, and `squeal-e2e`, the throwaway user the
 *      real-CLI tests run as;
 *   2. a recorded agent session log: one added line, or the added lines of one JSON file, holding
 *      the transcript path key, or both the session id key and the working directory key;
 *   3. a case-insensitive substring from the private denylist, env SQUEAL_PRIVATE_DENYLIST (one
 *      entry per line), which is never committed and never printed. When it is absent or empty,
 *      a push to main or cand/* (env GITHUB_REF) fails; elsewhere the rule is skipped with a warning.
 *
 * `.private-allow` (committed) lists path globs exempt from rules 1 and 2, never from rule 3.
 * Self-contained so Node runs it with type stripping:
 *
 *   node --experimental-strip-types scripts/check-private.ts [<base>]
 *
 * The default base is the merge-base of HEAD with origin/main.
 */

const ALLOW_FILE = ".private-allow";
const DENYLIST_ENV = "SQUEAL_PRIVATE_DENYLIST";

/** A home directory with a real user name: not preceded by a host or path word, as in a URL. */
const HOME_PATH =
  /(?<![\p{L}\p{N}\p{M}_.-])\/(?:home|Users)\/([\p{L}\p{N}\p{M}_-][\p{L}\p{N}\p{M}_.-]*)/gu;
const PUBLIC_USERS = new Set(["user", "runner", "squeal-e2e"]);
// Each quote is a character class so this file holds none of the keys it looks for.
const TRANSCRIPT_KEY = /["]transcript_path["]/;
const SESSION_KEY = /["]session_id["]/;
const CWD_KEY = /["]cwd["]/;

const HOME_PROBLEM = "holds an absolute home path";
const SESSION_PROBLEM = "holds a recorded agent session log";
const DENY_PROBLEM = "matches the private denylist";
const REDACTED = "[a path that matches the private denylist]";

export interface PrivateReport {
  base: string;
  problems: string[];
  warnings: string[];
  files: number;
  lines: number;
}

interface Added {
  path: string;
  line: number;
  text: string;
}

const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "pipe"],
  });

const JSON_ESCAPE = /\\(?:(["\\/])|u([0-9A-Fa-f]{4}))/g;

/** `text` as written, then with JSON string escapes undone once, twice and three times. */
function forms(text: string): string[] {
  const all = [text];
  for (let round = 0; round < 3; round++) {
    const last = all[all.length - 1] ?? "";
    if (!last.includes("\\")) break;
    const next = last.replace(
      JSON_ESCAPE,
      (_, char: string | undefined, hex: string) =>
        char ?? String.fromCharCode(Number.parseInt(hex, 16)),
    );
    if (next === last) break;
    all.push(next);
  }
  return all;
}

/** The merge-base of HEAD with origin/main, the base when none is given. */
function defaultBase(cwd: string): string {
  try {
    return git(cwd, ["merge-base", "origin/main", "HEAD"]).trim();
  } catch {
    throw new Error(
      "no base given and HEAD has no merge-base with origin/main; pass a base commit",
    );
  }
}

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

/** A path as git prints it in a patch header: C-quoted when it holds special characters. */
function unquote(path: string): string {
  if (!path.startsWith('"')) return path;
  const bytes: number[] = [];
  const body = Buffer.from(path.slice(1, -1), "utf8");
  for (let i = 0; i < body.length; i++) {
    const byte = body[i] ?? 0;
    if (byte !== 0x5c) {
      bytes.push(byte);
      continue;
    }
    const next = String.fromCharCode(body[i + 1] ?? 0);
    if (/[0-7]/.test(next)) {
      bytes.push(Number.parseInt(body.subarray(i + 1, i + 4).toString("latin1"), 8));
      i += 3;
    } else {
      bytes.push(ESCAPES[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Every added line of a `-U0` patch, with its path and line number in the new file. */
export function addedLines(patch: string): Added[] {
  const added: Added[] = [];
  let path: string | undefined;
  let line = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of patch.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      const sign = raw[0];
      if (sign === "+") {
        if (path !== undefined) added.push({ path, line, text: raw.slice(1) });
        line++;
        newLeft--;
        continue;
      }
      if (sign === "-") {
        oldLeft--;
        continue;
      }
      if (sign === " ") {
        oldLeft--;
        newLeft--;
        line++;
        continue;
      }
      if (sign === "\\") continue;
    }
    if (raw.startsWith("+++ ")) {
      // Git ends the name with a tab when it holds a space; a tab inside a name is quoted.
      const name = unquote(raw.slice(4, raw.endsWith("\t") ? -1 : undefined));
      path = name.startsWith("b/") ? name.slice(2) : undefined;
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (hunk !== null) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      line = Number(hunk[2]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    }
  }
  return added;
}

/** The paths that are new at HEAD: added, copied or renamed files. */
function addedPaths(cwd: string, range: string): string[] {
  const fields = git(cwd, ["diff", "--name-status", "-z", "-M", range]).split("\0");
  const paths: string[] = [];
  for (let i = 0; i < fields.length - 1; ) {
    const status = fields[i] ?? "";
    const twoPaths = status.startsWith("R") || status.startsWith("C");
    const path = fields[i + (twoPaths ? 2 : 1)] ?? "";
    if (/^[ACR]/.test(status)) paths.push(path);
    i += twoPaths ? 3 : 2;
  }
  return paths;
}

/**
 * The paths, old and new, of the files git diffs as binary although their new content holds no
 * NUL byte in its first 8000 bytes, git's own test: an attribute such as `-diff` made them binary.
 */
function attributeBinaries(cwd: string, range: string): string[] {
  const fields = git(cwd, ["diff", "--numstat", "-z", "-M", range]).split("\0");
  const paths: string[] = [];
  for (let i = 0; i < fields.length - 1; ) {
    const head = fields[i] ?? "";
    // `added\tdeleted\tpath`, or for a rename or copy `added\tdeleted\t`, old path, new path.
    const moved = head.endsWith("\t");
    const pair = moved
      ? [fields[i + 1] ?? "", fields[i + 2] ?? ""]
      : [head.split("\t").slice(2).join("\t")];
    i += moved ? 3 : 1;
    if (!head.startsWith("-\t-\t")) continue;
    let content: Buffer;
    try {
      content = execFileSync("git", ["cat-file", "blob", `HEAD:${pair[pair.length - 1]}`], {
        cwd,
        maxBuffer: 1 << 30,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      continue; // deleted at HEAD
    }
    if (!content.subarray(0, 8000).includes(0)) paths.push(...pair);
  }
  return paths;
}

/** The lines `range` adds to text files, with those only an attribute marks binary. */
function addedText(cwd: string, range: string): Added[] {
  const diff = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "-U0", "-M"];
  const prefixes = ["--src-prefix=a/", "--dst-prefix=b/"];
  const added = addedLines(git(cwd, [...diff, ...prefixes, range]));
  const textual = attributeBinaries(cwd, range);
  if (textual.length === 0) return added;
  const args = ["--literal-pathspecs", ...diff, "--text", ...prefixes, range, "--", ...textual];
  return [...added, ...addedLines(git(cwd, args))];
}

/** A glob from `.private-allow`: `**` crosses folders, `*` and `?` do not. */
function globRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] ?? "";
    if (glob.startsWith("**/", i)) {
      source += "(?:.*/)?";
      i += 2;
    } else if (glob.startsWith("**", i)) {
      source += ".*";
      i += 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

function allowGlobs(cwd: string): RegExp[] {
  let text: string;
  try {
    text = git(cwd, ["show", `HEAD:${ALLOW_FILE}`]);
  } catch {
    return [];
  }
  return text
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "" && !entry.startsWith("#"))
    .map(globRegExp);
}

const homeName = (text: string) =>
  forms(text).some((form) =>
    [...form.matchAll(HOME_PATH)].some((match) => !PUBLIC_USERS.has(match[1] ?? "")),
  );

const sessionLog = (text: string) =>
  forms(text).some(
    (form) => TRANSCRIPT_KEY.test(form) || (SESSION_KEY.test(form) && CWD_KEY.test(form)),
  );

const sessionStart = (text: string) =>
  forms(text).some((form) => TRANSCRIPT_KEY.test(form) || SESSION_KEY.test(form));

const protectedRef = (ref: string) =>
  ref === "refs/heads/main" || ref.startsWith("refs/heads/cand/");

/** The private material `HEAD` adds over `base`, judged with the denylist and ref in `env`. */
export function privateReport(
  cwd: string,
  base: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): PrivateReport {
  const from = base ?? defaultBase(cwd);
  const range = `${from}...HEAD`;
  const problems: string[] = [];
  const warnings: string[] = [];
  const deny = (env[DENYLIST_ENV] ?? "")
    .split("\n")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
  if (deny.length === 0) {
    const ref = env.GITHUB_REF ?? "";
    if (protectedRef(ref)) {
      problems.push(`${DENYLIST_ENV} is empty; the private denylist must be set for ${ref}`);
    } else {
      warnings.push(`${DENYLIST_ENV} is empty; the private denylist rule is skipped`);
    }
  }
  const denied = (text: string) =>
    forms(text).some((form) => {
      const lower = form.toLowerCase();
      return deny.some((entry) => lower.includes(entry));
    });
  const globs = allowGlobs(cwd);
  const allowed = (path: string) => globs.some((glob) => glob.test(path));
  const shown = (path: string) => (denied(path) ? REDACTED : path);

  for (const path of addedPaths(cwd, range)) {
    if (denied(path)) problems.push(`${REDACTED}: an added file's name ${DENY_PROBLEM}`);
  }

  const added = addedText(cwd, range);
  const byFile = new Map<string, Added[]>();
  for (const entry of added) {
    const where = `${shown(entry.path)}:${entry.line}`;
    if (denied(entry.text)) problems.push(`${where}: ${DENY_PROBLEM}`);
    if (allowed(entry.path)) continue;
    if (homeName(entry.text)) problems.push(`${where}: ${HOME_PROBLEM}`);
    if (sessionLog(entry.text)) problems.push(`${where}: ${SESSION_PROBLEM}`);
    else if (/\.json$/i.test(entry.path)) {
      byFile.set(entry.path, [...(byFile.get(entry.path) ?? []), entry]);
    }
  }
  // A JSON file pretty-printed over several lines: its added lines together.
  for (const [path, lines] of byFile) {
    if (!sessionLog(lines.map((entry) => entry.text).join("\n"))) continue;
    const first = lines.find((entry) => sessionStart(entry.text));
    problems.push(`${shown(path)}:${first?.line ?? lines[0]?.line}: ${SESSION_PROBLEM}`);
  }
  return {
    base: from,
    problems,
    warnings,
    files: new Set(added.map((entry) => entry.path)).size,
    lines: added.length,
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // pnpm 12 passes a `--` on to the script.
  const base = process.argv.slice(2).find((arg) => arg !== "--");
  try {
    const report = privateReport(process.cwd(), base, process.env);
    for (const warning of report.warnings) console.error(`private: warning: ${warning}`);
    for (const problem of report.problems) console.error(`private: ${problem}`);
    if (report.problems.length > 0) {
      console.error(
        `private: ${report.problems.length} problem(s) in the lines added over ${report.base}; remove them, or list a fixture path in ${ALLOW_FILE} (rules 1 and 2 only)`,
      );
      process.exit(1);
    }
    console.log(
      `private: ${report.lines} added lines in ${report.files} files over ${report.base}, ok`,
    );
  } catch (error) {
    console.error(`private: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
