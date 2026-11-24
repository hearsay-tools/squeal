import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type TreeEntry, treeBlob } from "./tree-wire.js";

/*
 * Materializes missing working-tree entries directly from `<root>/.git` on a
 * remote host (`git cat-file --batch`) when the exact blob SHA-1 is already
 * present there (e.g. after `git-bundle` bootstrap).
 *
 * Only paths named in `entries` are materialized, each blob's SHA-1 is
 * verified against `treeBlob(bytes)`, and each file is written through the
 * tree host's own safe writer so `files.json` owns it identically to a wire
 * write. Any entry whose blob is absent or fails to write stays in `missing`
 * for the daemon to transfer normally.
 */

const SHA1_HEX = /^[0-9a-f]{40}$/;

/**
 * Materializes entries whose exact blob SHA-1 exists in `<root>/.git`.
 * Returns the set of entry paths materialized; callers send only the rest.
 */
export async function materializeFromGit(
  root: string,
  entries: readonly TreeEntry[],
  writeEntry: (entry: TreeEntry, bytes: Buffer) => Promise<void>,
): Promise<Set<string>> {
  const done = new Set<string>();
  const gitDir = join(root, ".git");
  if (entries.length === 0 || !existsSync(gitDir)) return done;

  const byBlob = new Map<string, TreeEntry[]>();
  for (const entry of entries) {
    if (!SHA1_HEX.test(entry.blob)) continue;
    const list = byBlob.get(entry.blob);
    if (list === undefined) byBlob.set(entry.blob, [entry]);
    else list.push(entry);
  }
  if (byBlob.size === 0) return done;

  const blobs = [...byBlob.keys()];
  const child = spawn("git", ["--git-dir", gitDir, "cat-file", "--batch"], {
    stdio: ["pipe", "pipe", "ignore"],
  });

  // Feed requested SHAs with backpressure; ignore EPIPE if git exits early.
  child.stdin.on("error", () => {});
  void (async () => {
    const CHUNK = 256;
    for (let i = 0; i < blobs.length; i += CHUNK) {
      const text = `${blobs.slice(i, i + CHUNK).join("\n")}\n`;
      if (!child.stdin.write(text)) {
        await new Promise<void>((resolve) => child.stdin.once("drain", resolve));
      }
    }
    child.stdin.end();
  })();

  await new Promise<void>((resolve) => {
    let buf: Buffer = Buffer.alloc(0);
    let pending: { sha: string; type: string; size: number } | null = null;
    let processing = false;
    let ended = false;
    let failed = false;

    const finish = () => {
      if (!processing && (ended || failed)) resolve();
    };

    const drain = async () => {
      if (processing) return;
      processing = true;
      child.stdout.pause();
      try {
        while (!failed) {
          if (pending === null) {
            const nl = buf.indexOf(0x0a);
            if (nl < 0) break;
            const header = buf.subarray(0, nl).toString("utf8");
            buf = buf.subarray(nl + 1);
            const parts = header.split(" ");
            const sha = parts[0] ?? "";
            const kind = parts[1] ?? "";
            if (kind === "missing" || parts.length < 3) continue;
            const size = Number(parts[2]);
            if (!Number.isSafeInteger(size) || size < 0) {
              failed = true;
              break;
            }
            pending = { sha, type: kind, size };
          }
          // Body bytes + trailing LF emitted by `cat-file --batch`.
          const need = pending.size + 1;
          if (buf.byteLength < need) break;
          const bytes = buf.subarray(0, pending.size);
          buf = buf.subarray(need);
          const item = pending;
          pending = null;
          if (item.type !== "blob") continue;
          const targets = byBlob.get(item.sha);
          if (targets === undefined || treeBlob(bytes) !== item.sha) continue;
          for (const entry of targets) {
            try {
              await writeEntry(entry, bytes);
              done.add(entry.path);
            } catch {
              // Leave in `missing` so the daemon's wire write surfaces or retries it.
            }
          }
        }
      } finally {
        processing = false;
        if (!ended && !failed) child.stdout.resume();
        finish();
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      buf = buf.byteLength === 0 ? chunk : Buffer.concat([buf, chunk]);
      void drain();
    });
    child.on("error", () => {
      failed = true;
      finish();
    });
    child.stdout.on("end", () => {
      ended = true;
      void drain();
    });
    child.on("close", () => {
      ended = true;
      finish();
    });
  });

  return done;
}
