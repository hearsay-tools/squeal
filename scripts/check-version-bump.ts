import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * CI check (001-76): when plugins/claude-code/dist differs between two commits, the root
 * package.json version must be greater at the later one. Claude Code updates an installed
 * plugin only when the manifest's version changes, and the build writes that version from
 * package.json. Self-contained so Node runs it with type stripping:
 *
 *   node --experimental-strip-types scripts/check-version-bump.ts <base> [head]
 */

const BUNDLES = "plugins/claude-code/dist";

const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

function versionAt(cwd: string, commit: string): string {
  const manifest = JSON.parse(git(cwd, ["show", `${commit}:package.json`])) as { version: string };
  return manifest.version;
}

function parts(version: string): number[] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match === null ? undefined : match.slice(1).map(Number);
}

/** Why `head` may not ship its bundles over `base`, or `undefined` when it may. */
export function versionBumpProblem(base: string, head: string, cwd: string): string | undefined {
  const changed = git(cwd, ["diff", "--name-only", base, head, "--", BUNDLES]).trim() !== "";
  if (!changed) return undefined;
  const before = versionAt(cwd, base);
  const after = versionAt(cwd, head);
  const b = parts(before);
  const a = parts(after);
  if (a === undefined || b === undefined) {
    return `package.json version "${a === undefined ? after : before}" is not major.minor.patch`;
  }
  const index = a.findIndex((n, i) => n !== b[i]);
  if (index !== -1 && (a[index] ?? 0) > (b[index] ?? 0)) return undefined;
  return `${BUNDLES} changed but package.json version ${after} is not greater than ${before}: bump the patch version so installed plugins update`;
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
    console.log(
      `version bump: ${versionAt(process.cwd(), base)} -> ${versionAt(process.cwd(), head)}, ok`,
    );
  }
}
