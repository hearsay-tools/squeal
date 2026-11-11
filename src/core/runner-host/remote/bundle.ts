import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type SshResult, type SshTarget, shellQuote, sshFailure, sshRun } from "./ssh.js";
import { tarOf } from "./tar.js";

/*
 * Spec 021 D14 (row 021-13; the human, 2026-11-11: "Daemon copies itself"):
 * at first connect the daemon copies its own runtime bundle over the same
 * SSH access to `<remote cache>/squeal/<version>/`, checks it there by a
 * checksum, and starts `squeal runner-host` from it. A version already there
 * and whole is used as it is. Node on the remote is the user's; Squeal never
 * installs it.
 */

/** The bundle a daemon runs from: the directory around its CLI's own (`dist/`). */
export interface Bundle {
  readonly root: string;
  /** Every file of the bundle's directories, relative with `/`, sorted: the hook bundles beside them stay. */
  readonly files: readonly string[];
  /** The CLI script, relative to `root`: `cli/squeal.mjs`. */
  readonly cli: string;
  readonly checksum: string;
}

/**
 * The bundle whose CLI is `cli`, or `null` when `cli` is no bundle's: a
 * daemon from the sources (`src/cli/index.ts` under `tsx`) has nothing it can copy.
 */
export function readBundle(cli: string): Bundle | null {
  if (!cli.endsWith(".mjs")) return null;
  const root = dirname(dirname(cli));
  const files: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), path);
      // Only the directories: the hook bundles at the top serve the harness, not a host.
      else if (entry.isFile() && rel !== "") files.push(path);
    }
  };
  walk(root, "");
  files.sort();
  const relCli = `${basename(dirname(cli))}/${basename(cli)}`;
  if (!files.includes(relCli)) return null;
  return { root, files, cli: relCli, checksum: checksumOf(root, files) };
}

/** The checksum `CHECK_SCRIPT` computes on the remote: each path, its size and its bytes. */
export function checksumOf(root: string, files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    const bytes = readFileSync(join(root, file));
    hash.update(`${file}\n${bytes.byteLength}\n`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

/**
 * Runs on the remote under the user's Node: `check <dir> <checksum>` prints
 * the remote's Node and whether the bundle at `<dir>` is `present` (whole),
 * `absent` or `differs`, and exits 0; `verify` exits 1 unless it is present.
 * Its walk and checksum are `readBundle`'s and `checksumOf`'s.
 */
export const CHECK_SCRIPT = [
  'const fs=require("fs"),path=require("path"),crypto=require("crypto");',
  "const [,mode,dir,want]=process.argv;const files=[];",
  'const walk=(d,r)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=r===""?e.name:r+"/"+e.name;',
  "if(e.isDirectory())walk(path.join(d,e.name),p);else if(e.isFile())files.push(p);}};",
  'let got="absent";try{walk(dir,"");files.sort();const h=crypto.createHash("sha256");',
  'for(const f of files){const b=fs.readFileSync(path.join(dir,f));h.update(f+"\\n"+b.length+"\\n");h.update(b);}',
  'got=h.digest("hex");}catch{}',
  'const bundle=got===want?"present":got==="absent"?"absent":"differs";',
  'if(mode==="verify")process.exit(bundle==="present"?0:1);',
  "process.stdout.write(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,bundle}));",
].join("");

/** Where things live on the remote, relative to its home unless the user names an absolute cache. */
export interface RemotePlaces {
  /** The user's Node on the remote: `node` on the login's `PATH`, or a path. */
  readonly node: string;
  /** The remote cache directory; Squeal's part is `<cache>/squeal`. */
  readonly cache: string;
}

/** `<cache>/squeal/<version>`. */
export function bundleDir(places: RemotePlaces, version: string): string {
  return `${places.cache}/squeal/${version}`;
}

/** What the remote said at the check: its Node, and the bundle there. */
export interface RemoteCheck {
  readonly node: string;
  readonly platform: string;
  readonly arch: string;
  readonly bundle: "present" | "absent" | "differs";
}

export interface EnsureOptions {
  readonly target: SshTarget;
  readonly places: RemotePlaces;
  readonly version: string;
  readonly bundle: Bundle;
  /** Each ssh step's deadline. */
  readonly deadlineMs: number;
}

/** How the bundle reached the remote: it was there whole, or was copied now. */
export interface Ensured {
  readonly check: RemoteCheck;
  readonly copied: boolean;
}

/**
 * Makes the remote hold this bundle whole at `bundleDir`: checks it, and
 * copies it when absent or different, into a directory of its own that
 * replaces the old one only once checked (two daemons copying at once each
 * keep a whole one). Throws with the step that failed.
 */
export async function ensureBundle(options: EnsureOptions): Promise<Ensured> {
  const { target, places, bundle, deadlineMs } = options;
  const dir = bundleDir(places, options.version);
  const node = shellQuote(places.node);
  const script = shellQuote(CHECK_SCRIPT);
  const checked = await sshRun(
    target,
    `${node} -e ${script} check ${shellQuote(dir)} ${bundle.checksum}`,
    {
      deadlineMs,
    },
  );
  const check = parseCheck(checked, target.destination);
  if (check.bundle === "present") return { check, copied: false };
  const q = shellQuote(dir);
  const verify = (at: string) => `${node} -e ${script} verify ${at} ${bundle.checksum}`;
  const copy = [
    "set -e",
    `t=${q}.part.$$`,
    'rm -rf "$t"',
    'mkdir -p "$t"',
    'tar -xf - -C "$t"',
    verify('"$t"'),
    // Another daemon's whole copy stays: a host may be running from it.
    `if ${verify(q)}; then rm -rf "$t"; else rm -rf ${q}.old.$$; if [ -e ${q} ]; then mv ${q} ${q}.old.$$; fi; mv "$t" ${q}; rm -rf ${q}.old.$$; fi`,
  ].join("\n");
  const archive = tarOf(
    bundle.files.map((path) => ({ path, bytes: readFileSync(join(bundle.root, path)) })),
  );
  const copied = await sshRun(target, `sh -c ${shellQuote(copy)}`, { input: archive, deadlineMs });
  if (copied.code !== 0) {
    throw new Error(sshFailure(`could not copy Squeal to ${target.destination}:${dir}`, copied));
  }
  return { check, copied: true };
}

function parseCheck(result: SshResult, destination: string): RemoteCheck {
  if (result.code !== 0) {
    throw new Error(sshFailure(`could not check Squeal on ${destination}`, result));
  }
  try {
    const parsed = JSON.parse(result.stdout) as RemoteCheck;
    if (typeof parsed.node === "string" && typeof parsed.bundle === "string") return parsed;
  } catch {
    // Below.
  }
  throw new Error(
    `could not check Squeal on ${destination}: its Node printed ${JSON.stringify(result.stdout.slice(0, 200))}`,
  );
}
