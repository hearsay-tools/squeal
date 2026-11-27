import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { type SshTarget, shellQuote, sshFailure, sshRun } from "../../ssh.js";
import { createGitBundle, sharedFullBundle } from "./bundle-cache.js";
import { INDEX_HASH, INDEX_SCRIPT, stagedIndex } from "./git-index.js";

/*
 * Spec 026 D7.3.3 (row 026-15): what a fresh Agent37 instance needs before
 * the lane's first connect. Node at the local version (the environment
 * must match, 021 D11.2), installed from nodejs.org with its checksum when
 * the configured one differs, as the research's `setup-node.sh` did; and,
 * for `bootstrap: "git-bundle"`, the worktree's history: a `git bundle` of
 * HEAD and its tags made here and streamed over SSH, so the remote tree is
 * a Git repository without any Git credential on the instance.
 *
 * Review 0.1.619 B2, B3: the bundle fills `.git` alone: its objects, HEAD
 * (the branch, or detached), the tags and the index. No working-tree file
 * is written, so the tree host owns every one of them from the first
 * connect, and a file deleted here never appears there. The remote `.git`
 * is `present` only when its HEAD, branch and tags equal the worktree's
 * now; else it is brought there, with a bundle of the commits it lacks
 * when its HEAD is a commit here, of the whole history when not.
 *
 * Row 026-39 (#303): and its index the worktree's staged index, which a
 * `git mv` changes with HEAD unchanged (`git-index.ts`).
 */

const run = promisify(execFile);

export interface BootstrapDeadlines {
  readonly nodeMs: number;
  readonly bundleMs: number;
  readonly sshMs: number;
}

export const BOOTSTRAP_DEADLINES: BootstrapDeadlines = {
  nodeMs: 300_000,
  bundleMs: 900_000,
  sshMs: 120_000,
};

/**
 * Prints the Node to use: `$1` when it is version `$2`, else the one it
 * installs under `~/.local/node-v$2` (`.tar.xz`, or `.tar.gz` where the
 * image has no `xz`, row 026-29), linked first on the login's `PATH`
 * so the lockfile install runs under it too. Node 25 and later ship no
 * corepack: it is linked and enabled only when present (an earlier
 * bootstrap's dangling link is removed), and the tree host
 * installs a missing pnpm or yarn itself (row 026-22).
 */
const NODE_SCRIPT = `set -eu
N=$1; V=$2
if [ "$("$N" -v 2>/dev/null || true)" = "v$V" ]; then printf '%s\\n' "$N"; exit 0; fi
D=$HOME/.local/node-v$V
if [ ! -x "$D/bin/node" ]; then
  A=$(uname -m); case $A in x86_64) A=x64;; aarch64) A=arm64;; esac
  if command -v xz >/dev/null 2>&1; then F=node-v$V-linux-$A.tar.xz; X=-xJf
  else F=node-v$V-linux-$A.tar.gz; X=-xzf; fi
  W=$(mktemp -d); cd "$W"
  curl -fsSLO "https://nodejs.org/dist/v$V/$F"
  curl -fsSL "https://nodejs.org/dist/v$V/SHASUMS256.txt" | grep " $F\\$" | sha256sum -c - >&2
  mkdir -p "$D"; tar "$X" "$F" -C "$D" --strip-components=1
  cd /; rm -rf "$W"
fi
mkdir -p "$HOME/.local/bin"
for b in node npm npx corepack; do
  P=$HOME/.local/bin/$b
  if [ -x "$D/bin/$b" ]; then ln -sfn "$D/bin/$b" "$P"
  elif [ -L "$P" ] && [ ! -e "$P" ]; then rm -f "$P"; fi
done
L='export PATH="$HOME/.local/bin:$PATH" # squeal-agent37'
for f in .bashrc .profile; do
  touch "$HOME/$f"
  grep -q squeal-agent37 "$HOME/$f" || { printf '%s\\n' "$L" | cat - "$HOME/$f" > "$HOME/$f.new"; mv "$HOME/$f.new" "$HOME/$f"; }
done
if [ -x "$D/bin/corepack" ]; then "$D/bin/corepack" enable --install-directory "$HOME/.local/bin" >&2 || true; fi
printf '%s\\n' "$D/bin/node"`;

/** A one-off script on the remote: `sh -c <script> sh <args>`. */
function scriptCommand(script: string, args: readonly string[]): string {
  return ["sh", "-c", script, "sh", ...args].map(shellQuote).join(" ");
}

/**
 * The Node the remote runs Squeal with: `node` when it is `version`, else
 * one installed now. Throws naming the step, and once `signal` aborted.
 */
export async function ensureNode(
  target: SshTarget,
  node: string,
  version: string,
  deadlineMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const bare = version.replace(/^v/, "");
  const result = await sshRun(target, scriptCommand(NODE_SCRIPT, [node, bare]), {
    deadlineMs,
    ...(signal === undefined ? {} : { signal }),
  });
  signal?.throwIfAborted();
  const what = `could not provide Node ${version} on ${target.destination}`;
  if (result.code !== 0) throw new Error(sshFailure(what, result));
  const path = result.stdout.trim().split("\n").at(-1)?.trim() ?? "";
  if (path === "") throw new Error(`${what}: the script printed no Node`);
  return path;
}

/**
 * The Git state of the directory it runs in: HEAD's branch (an empty line
 * when detached), a `.` line, HEAD's commit and each tag (`git show-ref
 * --head --tags`), a `.` line, then the index's hash (row 026-39). The
 * same text here and there.
 */
const STATE = `git symbolic-ref -q HEAD || true
echo .
git show-ref --head --tags || true
echo .
${INDEX_HASH}`;

/** Prints `missing` when `$1/root` has no `.git`, else its Git state. */
const LOOK_SCRIPT = `cd "$1/root" 2>/dev/null && [ -d .git ] || { echo missing; exit 0; }
${STATE}`;

/**
 * Brings `$1/root/.git` to the state stdin names: `head <commit>`, `ref
 * <branch>` unless detached, `tag <object> <name>` per tag, a `.` line,
 * then a bundle of the objects it lacks (none: empty). Only `.git` changes:
 * objects, refs, HEAD and the index; never a working-tree file. Exits 3
 * when objects are missing (a bundle's prerequisite, or a ref's object),
 * so the whole history must come. Prints the state it reached.
 */
const SYNC_SCRIPT = `set -eu
T=$1
mkdir -p "$T/root"
D=$(cd "$T" && pwd -P)
B=$D/git.bundle; R=$D/git.refs; N=$D/git.tags
trap 'rm -f "$B" "$R" "$N"' EXIT
: > "$R"
while IFS= read -r l; do [ "$l" = . ] && break; printf '%s\\n' "$l" >> "$R"; done
cat > "$B"
cd "$T/root"
[ -d .git ] || git init -q
if [ -s "$B" ]; then git bundle unbundle "$B" > /dev/null || exit 3; fi
H=$(sed -n 's/^head //p' "$R"); S=$(sed -n 's/^ref //p' "$R")
sed -n 's/^tag [^ ]* //p' "$R" > "$N"
{
  git for-each-ref --format='%(refname)' refs/tags | grep -vxF -f "$N" | sed 's/^/delete /'
  sed -n 's/^tag \\([^ ]*\\) \\(.*\\)$/update \\2 \\1/p' "$R"
  if [ -n "$S" ]; then echo "update $S $H"; fi
} | git update-ref --stdin || exit 3
if [ -n "$S" ]; then git symbolic-ref HEAD "$S"; else git update-ref --no-deref HEAD "$H" || exit 3; fi
git read-tree --reset HEAD
${STATE}`;

/** A tree's Git state: HEAD's commit, and `key`, equal when HEAD, its branch, the tags and the index are. */
export interface GitState {
  readonly head: string;
  readonly key: string;
  /** What `SYNC_SCRIPT` reads on stdin before the bundle. */
  readonly refs: string;
}

/** The state `STATE` printed; `null` when HEAD has no commit yet. */
export function gitStateOf(text: string): GitState | null {
  const lines = text.split("\n").map((line) => line.trim());
  const dot = lines.indexOf(".");
  if (dot < 0) return null;
  const ref = lines.slice(0, dot).find((line) => line !== "") ?? "";
  const end = lines.indexOf(".", dot + 1);
  if (end < 0) return null;
  const shown = lines.slice(dot + 1, end).map((line) => line.split(" "));
  const index = lines.slice(end + 1).find((line) => line !== "") ?? "";
  const head = shown.find(([, name]) => name === "HEAD")?.[0];
  if (head === undefined || !/^[0-9a-f]{40,64}$/.test(head)) return null;
  const tags = shown
    .filter(([object, name]) => object !== undefined && name?.startsWith("refs/tags/") === true)
    .map(([object, name]) => `tag ${object} ${name}`)
    .sort();
  const refs = [`head ${head}`, ...(ref === "" ? [] : [`ref ${ref}`]), ...tags].join("\n");
  return { head, key: `${refs}\nindex ${index}`, refs };
}

/** The worktree's Git state now, read here; `null` when HEAD has no commit yet. */
export async function localGitState(root: string): Promise<GitState | null> {
  const { stdout } = await run("sh", ["-c", STATE], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return gitStateOf(stdout);
}

/** How the remote tree got its `.git`: it was current, it was brought current now, or it cannot have one. */
export type GitTree =
  | { readonly kind: "present"; readonly commit: string; readonly state: GitState }
  | { readonly kind: "sent"; readonly commit: string; readonly state: GitState | null }
  | { readonly kind: "none"; readonly why: string };

/** The Git state of `<tree>/root` there; `null` when it has no `.git` or no commit. Throws when SSH fails. */
async function remoteGitState(
  target: SshTarget,
  tree: string,
  deadlines: BootstrapDeadlines,
  signal?: AbortSignal,
): Promise<GitState | null> {
  const looked = await sshRun(target, scriptCommand(LOOK_SCRIPT, [tree]), {
    deadlineMs: deadlines.sshMs,
    ...(signal === undefined ? {} : { signal }),
  });
  signal?.throwIfAborted();
  if (looked.code !== 0) {
    throw new Error(
      sshFailure(`could not read ${tree}/root/.git on ${target.destination}`, looked),
    );
  }
  return gitStateOf(looked.stdout);
}

/** Whether `commit` is a commit here, so a bundle may leave out what it reaches. */
async function knownHere(root: string, commit: string): Promise<boolean> {
  return run("git", ["-C", root, "cat-file", "-e", `${commit}^{commit}`]).then(
    () => true,
    () => false,
  );
}

/**
 * Makes `<tree>/root/.git` the local worktree's Git state: HEAD, its branch,
 * the tags and the index, and no working-tree file. A worktree with no
 * commit yet is `none`; an SSH step that fails throws, as every step does
 * once `signal` aborted (row 026-20).
 */
export async function ensureGitTree(
  target: SshTarget,
  tree: string,
  root: string,
  deadlines: BootstrapDeadlines,
  signal?: AbortSignal,
): Promise<GitTree> {
  const local = await localGitState(root).catch(() => null);
  signal?.throwIfAborted();
  if (local === null) return { kind: "none", why: "the worktree has no commit yet" };
  const remote = await remoteGitState(target, tree, deadlines, signal);
  if (remote?.key === local.key) return { kind: "present", commit: local.head, state: remote };
  const dir = await mkdtemp(join(tmpdir(), "squeal-agent37-bundle-"));
  try {
    let sent: GitState | null | "missing" = remote;
    if (remote?.refs !== local.refs) {
      const base = remote !== null && (await knownHere(root, remote.head)) ? remote.head : null;
      const send = (since: string | null) =>
        sendGit(target, tree, root, { local, base: since, dir, deadlines, signal });
      sent = await send(base);
      // Its objects did not reach that far back (gc'd, or another history): the whole history.
      if (sent === "missing" && base !== null) sent = await send(null);
      if (sent === "missing") return { kind: "none", why: "the git bundle lacked objects there" };
    }
    // Row 026-39: HEAD there, its index reset to HEAD's tree; the staged index here differs.
    if (sent !== null && sent.key !== local.key) {
      sent = await sendIndex(target, tree, root, { dir, deadlines, signal });
      if (sent === "missing") return { kind: "none", why: "the staged index did not apply there" };
    }
    return { kind: "sent", commit: local.head, state: sent };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * `local`'s refs and a bundle of the history `base` lacks (all of it: no
 * `base`) sent and applied there; the state it reached, or `missing`.
 */
async function sendGit(
  target: SshTarget,
  tree: string,
  root: string,
  send: {
    readonly local: GitState;
    readonly base: string | null;
    readonly dir: string;
    readonly deadlines: BootstrapDeadlines;
    readonly signal: AbortSignal | undefined;
  },
): Promise<GitState | null | "missing"> {
  const { local, base, dir, deadlines, signal } = send;
  signal?.throwIfAborted();
  let bundle: string | null = null;
  if (base === null) {
    try {
      bundle = await sharedFullBundle(root, local, dir, deadlines.bundleMs, signal);
    } catch (error) {
      signal?.throwIfAborted();
      const stderr = String((error as { stderr?: unknown }).stderr ?? error).trim();
      throw new Error(`git bundle failed: ${stderr.split("\n").at(-1) ?? ""}`);
    }
  } else {
    const sincePath = join(dir, "since.bundle");
    const created = await createGitBundle(
      root,
      sincePath,
      ["HEAD", "--tags", `^${base}`],
      signal,
    ).then(
      () => true,
      () => {
        signal?.throwIfAborted();
        // Nothing new since `base` (only refs moved): no bundle; the refs alone.
        return false;
      },
    );
    if (created) bundle = sincePath;
  }
  const input = Readable.from(
    (async function* () {
      yield Buffer.from(`${local.refs}\n.\n`);
      if (bundle !== null) yield* createReadStream(bundle);
    })(),
  );
  const sent = await sshRun(target, scriptCommand(SYNC_SCRIPT, [tree]), {
    input,
    deadlineMs: deadlines.bundleMs,
    ...(signal === undefined ? {} : { signal }),
  });
  signal?.throwIfAborted();
  if (sent.code === 3) return "missing";
  if (sent.code !== 0) {
    throw new Error(sshFailure(`could not unpack the git bundle on ${target.destination}`, sent));
  }
  return gitStateOf(sent.stdout);
}

/** The staged index here, applied there (`INDEX_SCRIPT`); the state it reached, or `missing`. */
async function sendIndex(
  target: SshTarget,
  tree: string,
  root: string,
  send: {
    readonly dir: string;
    readonly deadlines: BootstrapDeadlines;
    readonly signal: AbortSignal | undefined;
  },
): Promise<GitState | null | "missing"> {
  const { dir, deadlines, signal } = send;
  const staged = await stagedIndex(root, dir);
  signal?.throwIfAborted();
  const input = Readable.from(
    (async function* () {
      yield Buffer.from(`${staged.lines}.\n`);
      if (staged.pack !== null) yield* createReadStream(staged.pack);
    })(),
  );
  const sent = await sshRun(target, scriptCommand(`${INDEX_SCRIPT}${STATE}`, [tree]), {
    input,
    deadlineMs: deadlines.bundleMs,
    ...(signal === undefined ? {} : { signal }),
  });
  signal?.throwIfAborted();
  if (sent.code === 3) return "missing";
  if (sent.code !== 0) {
    throw new Error(sshFailure(`could not set the git index on ${target.destination}`, sent));
  }
  return gitStateOf(sent.stdout);
}
