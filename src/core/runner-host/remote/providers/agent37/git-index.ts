import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { SINGLE_THREAD_PACK } from "./bundle-cache.js";

/*
 * Row 026-39 (#303, spec 026 D7.3, D8.4): the remote `.git`'s index is the
 * worktree's staged index, not HEAD's tree. After `git mv` with no commit,
 * HEAD and the tags are unchanged, yet Git here lists the new path only;
 * a test that reads `git ls-files` there must see the same list.
 *
 * The Git state (`STATE` in `bootstrap.ts`) ends with `INDEX_HASH`: a hash
 * of `git ls-files -s -z`, the same text here and there, so a staged change
 * moves the key and an unchanged index makes no SSH call. `INDEX_SCRIPT`
 * resets the remote index to HEAD and applies, per path whose entries
 * differ from HEAD here, a removal then its entries here (stages too, for
 * a merge in progress), with a pack of the blobs those entries name.
 *
 * Review 0.1.662 B2: `ls-files -s` and `--index-info` drop the
 * intent-to-add flag (`git add -N`), so such an entry arrived as a staged
 * empty file and the hash could not tell. The hash also covers `git diff
 * --cached --name-status`, which lists a staged empty file and omits an
 * intent-to-add one; `INDEX_SCRIPT` marks those paths again with `git
 * reset -N`, which writes no working-tree file.
 */

const run = promisify(execFile);

/**
 * Prints the index's hash, from `git ls-files -s -z` and the staged diff's
 * names (intent-to-add, B2): equal there and here when the indexes are.
 * The diff's options fix what a user's config would change.
 */
export const INDEX_HASH = `{ git ls-files -s -z; printf '.\\0'; git diff --cached --no-renames --no-color --no-ext-diff --ignore-submodules=none --name-status -z; } | git hash-object --stdin`;

/**
 * Sets `$1/root/.git`'s index from stdin: `git update-index --index-info`
 * lines, a `.` line, the intent-to-add paths (C-quoted), a `.` line, then
 * a pack of the blobs the entries name (none: empty). Exits 3 when the
 * pack or the lines do not apply. The caller appends the Git state to print.
 */
export const INDEX_SCRIPT = `set -eu
D=$(cd "$1" && pwd -P)
E=$D/git.index; A=$D/git.intent; P=$D/git.pack
trap 'rm -f "$E" "$A" "$P"' EXIT
: > "$E"; : > "$A"
while IFS= read -r l; do [ "$l" = . ] && break; printf '%s\\n' "$l" >> "$E"; done
while IFS= read -r l; do [ "$l" = . ] && break; printf '%s\\n' "$l" >> "$A"; done
cat > "$P"
cd "$1/root"
if [ -s "$P" ]; then git unpack-objects -q < "$P" || exit 3; fi
git hash-object -w --stdin < /dev/null > /dev/null
git read-tree --reset HEAD
if [ -s "$E" ]; then git update-index --index-info < "$E" || exit 3; fi
if [ -s "$A" ]; then GIT_LITERAL_PATHSPECS=1 git reset -q -N HEAD --pathspec-from-file="$A" || exit 3; fi
`;

/** The staged index as `INDEX_SCRIPT` takes it. */
export interface StagedIndex {
  /** `--index-info` lines, each ending in a newline; empty when the index is HEAD's tree. */
  readonly lines: string;
  /** The intent-to-add paths, C-quoted, each ending in a newline; empty: none. */
  readonly intent: string;
  /** A pack of the blobs those lines name; `null`: none. */
  readonly pack: string | null;
}

const GITLINK = "160000";

/** Lines of `git <args>` in `root`, paths C-quoted (`core.quotePath`), so none spans two lines. */
async function gitLines(root: string, args: readonly string[]): Promise<string[]> {
  const { stdout } = await run("git", ["-C", root, "-c", "core.quotePath=true", ...args], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout.split("\n").filter((line) => line !== "");
}

/** `line`'s path, after its tab. */
const pathOf = (line: string) => line.slice(line.indexOf("\t") + 1);

/** Lines by path, in the order given. */
function byPath(lines: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of lines) {
    const path = pathOf(line);
    const got = out.get(path);
    if (got === undefined) out.set(path, [line]);
    else got.push(line);
  }
  return out;
}

/**
 * What `INDEX_SCRIPT` needs to make the remote index `root`'s: the entries
 * of every path whose entries differ from HEAD's, and a pack in `dir` of
 * the blobs they name. Gitlinks name commits of another repository and the
 * empty blob may be no object here (`git add -N`): neither is packed.
 */
export async function stagedIndex(root: string, dir: string): Promise<StagedIndex> {
  const [staged, tree, debug] = await Promise.all([
    gitLines(root, ["ls-files", "-s"]),
    gitLines(root, ["ls-tree", "-r", "--full-tree", "HEAD"]),
    gitLines(root, ["ls-files", "--debug"]),
  ]);
  // `mode type object\tpath` as `ls-files -s` prints it: `mode object 0\tpath`.
  const head = byPath(
    tree.map((line) => {
      const [mode, , object] = line.slice(0, line.indexOf("\t")).split(" ");
      return `${mode} ${object} 0\t${pathOf(line)}`;
    }),
  );
  const here = byPath(staged);
  // The empty blob (`git add -N`'s), here only by name; its length is the object names'.
  const empty = (
    await run("git", ["-C", root, "hash-object", "-t", "blob", "/dev/null"])
  ).stdout.trim();
  const zero = "0".repeat(empty.length);
  const out: string[] = [];
  const blobs = new Set<string>();
  for (const path of new Set([...head.keys(), ...here.keys()])) {
    const mine = here.get(path) ?? [];
    if (mine.join("\n") === (head.get(path) ?? []).join("\n")) continue;
    out.push(`0 ${zero}\t${path}`, ...mine);
    for (const line of mine) {
      const [mode, object] = line.split(" ");
      if (mode !== GITLINK && object !== undefined && object !== empty) blobs.add(object);
    }
  }
  if (out.length === 0) return { lines: "", intent: "", pack: null };
  const lines = `${out.join("\n")}\n`;
  const marked = intentToAdd(debug);
  const intent = marked.length === 0 ? "" : `${marked.join("\n")}\n`;
  if (blobs.size === 0) return { lines, intent, pack: null };
  const pack = join(dir, "staged.pack");
  await packBlobs(root, [...blobs], pack);
  return { lines, intent, pack };
}

/** Git's `CE_INTENT_TO_ADD` entry flag, as `ls-files --debug` prints flags (hex). */
const INTENT_TO_ADD = 0x20000000;

/**
 * The paths `git ls-files --debug` flags intent-to-add: a path line, then
 * its indented stat lines, the last with `flags: <hex>`.
 */
function intentToAdd(debug: readonly string[]): string[] {
  const out: string[] = [];
  let path = "";
  for (const line of debug) {
    if (!/^\s/.test(line)) {
      path = line;
      continue;
    }
    const flags = /flags: ([0-9a-f]+)\s*$/.exec(line)?.[1];
    if (flags !== undefined && (Number.parseInt(flags, 16) & INTENT_TO_ADD) !== 0) out.push(path);
  }
  return out;
}

/** Writes a pack of `blobs` to `path`, one thread as the bundles are. */
async function packBlobs(root: string, blobs: readonly string[], path: string): Promise<void> {
  const child = spawn(
    "git",
    ["-C", root, ...SINGLE_THREAD_PACK, "pack-objects", "--stdout", "-q"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  child.stdin.end(`${blobs.join("\n")}\n`);
  await pipeline(child.stdout, createWriteStream(path));
  const code = await exited;
  if (code !== 0) throw new Error(`git pack-objects failed: ${stderr.trim().split("\n").at(-1)}`);
}
