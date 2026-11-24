import type { RemotePlaces } from "./bundle.js";
import type { DiskCheck } from "./settings.js";
import { type SshTarget, shellQuote, sshFailure, sshRun } from "./ssh.js";

/*
 * Spec 026 D11 (row 026-13): the connect-time disk health check. Some
 * machines flush a 4 KiB write to disk in 34 to 123 ms instead of under
 * one (research `boat-sandboxes.md` Q3), and their runs then store false
 * timeouts. Once per machine incarnation, before its first host starts,
 * the remote's own Node writes 4 KiB 20 times with a data sync each
 * (`O_DSYNC`, else `fdatasync`) in `<cache>/squeal`, removes its file and
 * prints each write's time. The median above `maxWriteMs` is a degraded
 * disk: named in the log and status, then warned of or refused
 * (`onSlowDisk`). The machine share keeps the verdict per incarnation.
 */

/** How many writes the probe makes, and how large each is. */
export const DISK_WRITES = 20;
export const DISK_BLOCK = 4096;

/** How long the probe may take: 20 writes take under 3 s on the slowest disk measured. */
export const DISK_PROBE_MS = 60_000;

/**
 * The probe, run by the remote's Node with its directory as `argv[1]`:
 * prints a JSON array of each write's milliseconds. Its file goes in every case.
 */
export const DISK_SCRIPT = [
  'const fs=require("fs"),path=require("path");',
  "const dir=process.argv[1];fs.mkdirSync(dir,{recursive:true});",
  'const file=path.join(dir,".disk-check-"+process.pid+"-"+Date.now());',
  'const c=fs.constants,dsync=typeof c.O_DSYNC==="number";',
  "const flags=c.O_WRONLY|c.O_CREAT|c.O_TRUNC|(dsync?c.O_DSYNC:0);",
  `const block=Buffer.alloc(${DISK_BLOCK},7),ms=[];let fd=-1;`,
  "try{fd=fs.openSync(file,flags,0o600);",
  `for(let i=0;i<${DISK_WRITES};i++){const t=process.hrtime.bigint();`,
  `fs.writeSync(fd,block,0,${DISK_BLOCK},i*${DISK_BLOCK});if(!dsync)fs.fdatasyncSync(fd);`,
  "ms.push(Number(process.hrtime.bigint()-t)/1e6);}}",
  "finally{if(fd>=0)fs.closeSync(fd);fs.rmSync(file,{force:true});}",
  "process.stdout.write(JSON.stringify(ms));",
].join("");

/** What the probe measured: each write's time with its sync, and their median. */
export interface DiskProbe {
  readonly medianMs: number;
  readonly samplesMs: readonly number[];
}

/** The median of `samples`; 0 for none. */
export function medianOf(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** The directory the probe writes in: Squeal's part of the remote cache. */
export function diskDir(places: RemotePlaces): string {
  return `${places.cache}/squeal`;
}

/** Runs the probe on `target` under its Node. Throws when it cannot run or prints no samples. */
export async function probeDisk(
  target: SshTarget,
  places: RemotePlaces,
  deadlineMs = DISK_PROBE_MS,
): Promise<DiskProbe> {
  const command = [places.node, "-e", DISK_SCRIPT, diskDir(places)].map(shellQuote).join(" ");
  const ran = await sshRun(target, command, { deadlineMs });
  const what = `could not measure the disk of ${target.destination}`;
  if (ran.code !== 0) throw new Error(sshFailure(what, ran));
  let samples: unknown;
  try {
    samples = JSON.parse(ran.stdout);
  } catch {
    samples = null;
  }
  if (
    !Array.isArray(samples) ||
    samples.length !== DISK_WRITES ||
    !samples.every((ms) => typeof ms === "number" && Number.isFinite(ms) && ms >= 0)
  ) {
    throw new Error(`${what}: its Node printed ${JSON.stringify(ran.stdout.slice(0, 200))}`);
  }
  return { medianMs: medianOf(samples), samplesMs: samples };
}

/** `ms` as status shows it: whole above 10, else one decimal. */
function shown(ms: number): string {
  return ms >= 10 ? String(Math.round(ms)) : String(Math.round(ms * 10) / 10);
}

/** D11.2's line: `degraded disk: 34 ms/sync, limit 10 ms`. */
export function degradedText(medianMs: number, maxWriteMs: number): string {
  return `degraded disk: ${shown(medianMs)} ms/sync, limit ${shown(maxWriteMs)} ms`;
}

/** What the check found: not run, a healthy disk, a slow one, or no measurement. */
export type DiskVerdict =
  | { readonly kind: "skipped" }
  | { readonly kind: "healthy"; readonly probe: DiskProbe }
  | { readonly kind: "slow"; readonly probe: DiskProbe; readonly text: string }
  | { readonly kind: "unmeasured"; readonly why: string };

/** The verdict of `check` over `probe`, which runs only when the check is enabled. Never rejects. */
export async function judgeDisk(
  check: DiskCheck,
  probe: () => Promise<DiskProbe>,
): Promise<DiskVerdict> {
  if (!check.enabled) return { kind: "skipped" };
  const measured = await probe().catch((error: unknown) => error as Error);
  if (measured instanceof Error) return { kind: "unmeasured", why: measured.message };
  if (measured.medianMs <= check.maxWriteMs) return { kind: "healthy", probe: measured };
  return { kind: "slow", probe: measured, text: degradedText(measured.medianMs, check.maxWriteMs) };
}
