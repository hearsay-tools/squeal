import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type SshTarget, shellQuote, sshFailure, sshRun } from "../../ssh.js";

/*
 * Spec 026 D7.3.3 (row 026-15): what a fresh Agent37 instance needs before
 * the lane's first connect. Node at the local version (the environment
 * must match, 021 D11.2), installed from nodejs.org with its checksum when
 * the configured one differs, as the research's `setup-node.sh` did; and,
 * for `bootstrap: "git-bundle"`, the worktree's history: a `git bundle` of
 * HEAD and its tags made here and streamed over SSH, so the remote tree is
 * a Git repository without any Git credential on the instance.
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
 * installs under `~/.local/node-v$2`, linked first on the login's `PATH`
 * so the lockfile install runs under it too.
 */
const NODE_SCRIPT = `set -eu
N=$1; V=$2
if [ "$("$N" -v 2>/dev/null || true)" = "v$V" ]; then printf '%s\\n' "$N"; exit 0; fi
D=$HOME/.local/node-v$V
if [ ! -x "$D/bin/node" ]; then
  A=$(uname -m); case $A in x86_64) A=x64;; aarch64) A=arm64;; esac
  F=node-v$V-linux-$A.tar.xz
  W=$(mktemp -d); cd "$W"
  curl -fsSLO "https://nodejs.org/dist/v$V/$F"
  curl -fsSL "https://nodejs.org/dist/v$V/SHASUMS256.txt" | grep " $F\\$" | sha256sum -c - >&2
  mkdir -p "$D"; tar -xJf "$F" -C "$D" --strip-components=1
  cd /; rm -rf "$W"
fi
mkdir -p "$HOME/.local/bin"
for b in node npm npx corepack; do ln -sfn "$D/bin/$b" "$HOME/.local/bin/$b"; done
L='export PATH="$HOME/.local/bin:$PATH" # squeal-agent37'
for f in .bashrc .profile; do
  touch "$HOME/$f"
  grep -q squeal-agent37 "$HOME/$f" || { printf '%s\\n' "$L" | cat - "$HOME/$f" > "$HOME/$f.new"; mv "$HOME/$f.new" "$HOME/$f"; }
done
"$D/bin/corepack" enable --install-directory "$HOME/.local/bin" >&2 || true
printf '%s\\n' "$D/bin/node"`;

/** A one-off script on the remote: `sh -c <script> sh <args>`. */
function scriptCommand(script: string, args: readonly string[]): string {
  return ["sh", "-c", script, "sh", ...args].map(shellQuote).join(" ");
}

/** The Node the remote runs Squeal with: `node` when it is `version`, else one installed now. Throws naming the step. */
export async function ensureNode(
  target: SshTarget,
  node: string,
  version: string,
  deadlineMs: number,
): Promise<string> {
  const bare = version.replace(/^v/, "");
  const result = await sshRun(target, scriptCommand(NODE_SCRIPT, [node, bare]), { deadlineMs });
  const what = `could not provide Node ${version} on ${target.destination}`;
  if (result.code !== 0) throw new Error(sshFailure(what, result));
  const path = result.stdout.trim().split("\n").at(-1)?.trim() ?? "";
  if (path === "") throw new Error(`${what}: the script printed no Node`);
  return path;
}

/** Unpacks the bundle on stdin into `$1/root` as a Git repository at its HEAD; prints that commit. */
const UNPACK_SCRIPT = `set -eu
T=$1
mkdir -p "$T/root"
B=$(cd "$T" && pwd -P)/bootstrap.bundle
cat > "$B"
cd "$T/root"
fresh=; [ -z "$(ls -A)" ] && fresh=1
git init -q
git fetch -q --tags "$B" HEAD
if [ -n "$fresh" ]; then git reset -q --hard FETCH_HEAD; else git reset -q FETCH_HEAD; fi
rm -f "$B"
git rev-parse HEAD`;

/** How the remote tree got its `.git`: it had one, it was sent now, or it cannot have one. */
export type GitTree =
  | { readonly kind: "present" }
  | { readonly kind: "sent"; readonly commit: string }
  | { readonly kind: "none"; readonly why: string };

/**
 * Makes `<tree>/root` a Git repository at the local worktree's HEAD when it
 * is none yet. A worktree that cannot bundle (no commit yet) is `none`;
 * an SSH step that fails throws.
 */
export async function ensureGitTree(
  target: SshTarget,
  tree: string,
  root: string,
  deadlines: BootstrapDeadlines,
): Promise<GitTree> {
  const looked = await sshRun(target, `test -d ${shellQuote(`${tree}/root/.git`)}`, {
    deadlineMs: deadlines.sshMs,
  });
  if (looked.code === 0) return { kind: "present" };
  if (looked.code !== 1) {
    throw new Error(
      sshFailure(`could not look for ${tree}/root/.git on ${target.destination}`, looked),
    );
  }
  const dir = await mkdtemp(join(tmpdir(), "squeal-agent37-bundle-"));
  try {
    const bundle = join(dir, "head.bundle");
    try {
      await run("git", ["-C", root, "bundle", "create", "-q", bundle, "HEAD", "--tags"], {
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      const stderr = String((error as { stderr?: unknown }).stderr ?? error).trim();
      return { kind: "none", why: `git bundle failed: ${stderr.split("\n").at(-1) ?? ""}` };
    }
    const sent = await sshRun(target, scriptCommand(UNPACK_SCRIPT, [tree]), {
      input: createReadStream(bundle),
      deadlineMs: deadlines.bundleMs,
    });
    if (sent.code !== 0) {
      throw new Error(sshFailure(`could not unpack the git bundle on ${target.destination}`, sent));
    }
    return { kind: "sent", commit: sent.stdout.trim().split("\n").at(-1) ?? "" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
