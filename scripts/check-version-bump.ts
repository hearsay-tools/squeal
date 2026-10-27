import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * CI check (001-76): when any plugin's dist differs between two commits, the root
 * package.json version must be greater at the later one. Claude Code updates an installed
 * plugin only when the manifest's version changes, a Codex runtime release is keyed by its
 * version (spec 002 D8), install.sh puts the Pi and OpenCode packages in directories named by
 * their version (spec 009 D1, spec 008 D1), and the build writes every version from
 * package.json. The fixed Codex plugin has a version of its own (spec 002 D7): any change to
 * it is an adapter release, which users approve again, so it must raise that version, and a
 * root raise does not stand in for it. Self-contained so Node runs it with type stripping:
 *
 *   node --experimental-strip-types scripts/check-version-bump.ts <base> [head]
 */

const BUNDLES = [
  "plugins/claude-code/dist",
  "plugins/codex-runtime",
  "plugins/pi/dist",
  "plugins/opencode/dist",
] as const;

/** The fixed Codex plugin, every file of it, and the manifest that names its version. */
const ADAPTER = "plugins/codex";
const ADAPTER_MANIFEST = `${ADAPTER}/.codex-plugin/plugin.json`;

const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const changedUnder = (cwd: string, base: string, head: string, dirs: readonly string[]) =>
  git(cwd, ["diff", "--name-only", base, head, "--", ...dirs.map((d) => `${d}/`)])
    .split("\n")
    .filter((path) => path !== "");

/** The `version` of the JSON file `path` at `commit`; `undefined` when it does not exist there. */
function versionOf(cwd: string, commit: string, path: string): string | undefined {
  let text: string;
  try {
    text = git(cwd, ["show", `${commit}:${path}`]);
  } catch {
    return undefined;
  }
  return String((JSON.parse(text) as { version: unknown }).version);
}

function versionAt(cwd: string, commit: string): string {
  return versionOf(cwd, commit, "package.json") ?? "";
}

function parts(version: string): number[] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match === null ? undefined : match.slice(1).map(Number);
}

/** Why `after` is no raise over `before`, naming `what`; `undefined` when it is greater. */
function raiseProblem(what: string, before: string, after: string): string | undefined {
  const b = parts(before);
  const a = parts(after);
  if (a === undefined || b === undefined) {
    return `${what} "${a === undefined ? after : before}" is not major.minor.patch`;
  }
  const index = a.findIndex((n, i) => n !== b[i]);
  if (index !== -1 && (a[index] ?? 0) > (b[index] ?? 0)) return undefined;
  return `${what} ${after} is not greater than ${before}`;
}

/** Why `head` may not ship its bundles over `base`, or `undefined` when it may. */
export function versionBumpProblem(base: string, head: string, cwd: string): string | undefined {
  const problems: string[] = [];
  const changed = changedUnder(cwd, base, head, BUNDLES);
  if (changed.length > 0) {
    const bundles = BUNDLES.filter((dir) => changed.some((p) => p.startsWith(`${dir}/`)));
    const problem = raiseProblem(
      "package.json version",
      versionAt(cwd, base),
      versionAt(cwd, head),
    );
    if (problem !== undefined) {
      problems.push(
        problem.endsWith("major.minor.patch")
          ? problem
          : `${bundles.join(" and ")} changed but ${problem}: bump the patch version so installed plugins update`,
      );
    }
  }
  const before = versionOf(cwd, base, ADAPTER_MANIFEST);
  const after = versionOf(cwd, head, ADAPTER_MANIFEST) ?? "";
  if (before !== undefined && changedUnder(cwd, base, head, [ADAPTER]).length > 0) {
    const problem = raiseProblem(`its adapter version in ${ADAPTER_MANIFEST}`, before, after);
    if (problem !== undefined) {
      problems.push(
        `${ADAPTER} changed but ${problem}: any change to the fixed Codex plugin is an adapter release, which users approve again (spec 002 D7)`,
      );
    }
  }
  return problems.length === 0 ? undefined : problems.join("\n");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base, head = "HEAD"] = process.argv.slice(2);
  if (base === undefined || /^0+$/.test(base)) {
    console.log("version bump: no base commit; skipped");
  } else {
    const problem = versionBumpProblem(base, head, process.cwd());
    if (problem !== undefined) {
      console.error(`version bump: ${problem}`);
      process.exit(1);
    }
    const cwd = process.cwd();
    console.log(`version bump: ${versionAt(cwd, base)} -> ${versionAt(cwd, head)}, ok`);
    const adapter = [base, head].map((c) => versionOf(cwd, c, ADAPTER_MANIFEST) ?? "none");
    console.log(`adapter version: ${adapter.join(" -> ")}, ok`);
  }
}
