import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { blobHash } from "../../hash/blob.js";

/*
 * Spec 021 D10 (row 021-13): the tree messages between the daemon and a
 * remote runner host. The daemon names its tree by path and blob id; the
 * host answers what it lacks; the daemon sends those files' bytes. Each
 * revision's changed files ride on the host's `invalidate`, in one message.
 */

/** A file of the tree: its path relative to the root with `/`, and how the host must make it. */
export interface TreeEntry {
  readonly path: string;
  /** The git blob id (SHA-1) of its bytes: of a link, of its target. */
  readonly blob: string;
  /** `x`: an executable file; `link`: a symbolic link; absent: a plain file. */
  readonly mode?: "x" | "link";
}

/** A file of a write: its entry and how many bytes of the write's `gzip` are its. */
export interface WireFile extends TreeEntry {
  readonly size: number;
}

/**
 * Files to write and paths to remove, in that order. Row 021-25: the
 * files' bytes, one after another in the files' order, ride gzip-compressed
 * and then base64 in `gzip` (`""` with no file); the daemon and its host
 * are one version (D14), so both ends read this one form.
 */
export interface TreeWrite {
  readonly files: readonly WireFile[];
  readonly gzip: string;
  readonly removed: readonly string[];
}

/** `tree`'s answer: the entries the host lacks or holds in another form. */
export interface TreeAnswer {
  readonly missing: readonly string[];
}

/** `install`'s answer: whether the host installed, and with what. */
export interface InstallAnswer {
  readonly ran: boolean;
  readonly command: string | null;
  /**
   * Row 021-24: the lockfile was the one last installed, but the install
   * had changed since, as a restore onto a new machine leaves it: it was
   * made again from scratch.
   */
  readonly again?: true;
}

/**
 * What a remote run carries beside `RunOptions` (spec 021 D11, D13): the
 * blob id of each path of the run's closure as the daemon has it (`null`:
 * absent there), which the host proves before it runs, and how often the
 * host tells the daemon the run is still in flight; `admitted`, the run
 * holds the grant the host's last `admit` gave (D18, row 021-21).
 */
export interface RemoteRunOptions {
  readonly expected?: Readonly<Record<string, string | null>>;
  readonly alive?: number;
  readonly admitted?: true;
}

/**
 * What a remote run's reply carries beside the `RunReport`: the paths whose
 * blob ids differed before the run (`refused`; the run did not start), or
 * after it the blob id of each expected and observed path (`proof`), and
 * the run's logs.
 */
export interface RemoteRunReply {
  readonly refused?: readonly string[];
  /**
   * The run came with no grant of the host's machine held for it (spec 021
   * D18, review 0.1.445 R1): it did not start, and the daemon asks again.
   */
  readonly unadmitted?: true;
  readonly proof?: Readonly<Record<string, string | null>>;
  readonly logs?: readonly WireLog[];
}

/** The host's own environment inputs (spec 021 D11): what the key holds of a process. */
export interface HostCore {
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly installedDependencies: string;
  /** The allow-listed variables that are set, by name. */
  readonly env: Readonly<Record<string, string>>;
}

/** A run's log file, its path relative to the run's directory, its bytes base64. */
export interface WireLog {
  readonly name: string;
  readonly data: string;
}

/** What a run's logs carry back at most, in bytes before base64. */
export const LOG_BYTES = 2 * 1024 * 1024;

/** The blob id the tree messages name: git's, SHA-1, whatever the repository's own format. */
export function treeBlob(bytes: Uint8Array): string {
  return blobHash(bytes, "sha1");
}

/**
 * Whether `path` names a place inside a root: relative, `/`-separated, no
 * empty, `.` or `..` part, no NUL, and not inside `.git`. The host refuses
 * any other (it never writes outside its root).
 */
export function insideRoot(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\0")) return false;
  const parts = path.split("/");
  if (parts[0] === ".git") return false;
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

const zip = promisify(gzip);
const unzip = promisify(gunzip);

/** The files of one write, their bytes packed into its `gzip`. */
export async function packFiles(
  read: readonly { readonly entry: TreeEntry; readonly bytes: Buffer }[],
): Promise<Pick<TreeWrite, "files" | "gzip">> {
  if (read.length === 0) return { files: [], gzip: "" };
  const packed = await zip(Buffer.concat(read.map((file) => file.bytes)));
  return {
    files: read.map(({ entry, bytes }) => ({ ...entry, size: bytes.byteLength })),
    gzip: packed.toString("base64"),
  };
}

/** Each file of `write` with its bytes; rejects when the bytes are not as long as the sizes say. */
export async function unpackFiles(
  write: Pick<TreeWrite, "files" | "gzip">,
): Promise<{ readonly file: WireFile; readonly bytes: Buffer }[]> {
  if (write.files.length === 0) return [];
  const total = write.files.reduce((sum, file) => sum + file.size, 0);
  const all = await unzip(Buffer.from(write.gzip, "base64"), {
    maxOutputLength: Math.max(1, total),
  }).catch((error: Error) => {
    throw new Error(`runner host: a write's bytes do not unpack: ${error.message}`);
  });
  if (all.byteLength !== total) {
    throw new Error(`runner host: a write holds ${all.byteLength} bytes, its files ${total}`);
  }
  let at = 0;
  return write.files.map((file) => {
    const bytes = all.subarray(at, at + file.size);
    at += file.size;
    return { file, bytes };
  });
}
