import type { TestFileRef } from "../types/keys.js";
import type { RunOptions } from "../types/runner.js";
import type { WireCoverageRun } from "./coverage-wire.js";

/*
 * Spec 021 D6 (row 021-11): the runner host's protocol. One JSON object per
 * line, in both directions, each line starting with `MARKER`, so output a
 * library writes to the host's stdout is never read as a message. The daemon
 * sends requests, each with an `id` its one reply names, and notices
 * without one. The host sends replies and events.
 */

/** Compared at `start`: a host of another protocol or Squeal version is refused. */
export const RUNNER_HOST_PROTOCOL = 1;

/** What every protocol line starts with. JSON escapes U+0001 in strings, so no value holds it. */
export const MARKER = "\u0001squeal-runner-host ";

/** The runners a host builds (spec 021 D8: Vitest first). */
export const HOST_RUNNERS = ["vitest"] as const;
export type HostRunner = (typeof HOST_RUNNERS)[number];

/** The requests a host answers, each once. */
export type HostMethod =
  | "start"
  | "invalidate"
  | "recheck"
  | "affected"
  | "closure"
  | "enumerate"
  | "testFiles"
  | "globalSetups"
  | "environment"
  | "run"
  | "cancel"
  | "close";

export interface HostRequest {
  readonly id: number;
  readonly m: HostMethod;
  readonly a: readonly unknown[];
}

/**
 * A message of the daemon that takes no reply: the policy values the
 * adapter's options read (`policy`), or the end of `beforeForce` for the run
 * of request `a[0]` (`forced`).
 */
export type HostNotice =
  | { readonly m: "policy"; readonly a: readonly [HostPolicy] }
  | { readonly m: "forced"; readonly a: readonly [number] };

/** What the daemon sends. */
export type DaemonMessage = HostRequest | HostNotice;

/** A failed request: the error's message, as the adapter threw it. */
export interface HostError {
  readonly message: string;
}

export type HostReply =
  | { readonly id: number; readonly r: unknown }
  | { readonly id: number; readonly e: HostError };

/** What a host tells the daemon without a request. */
export type HostEvent =
  | { readonly ev: "note"; readonly text: string }
  | { readonly ev: "optimizer"; readonly projects: readonly string[] }
  | { readonly ev: "values"; readonly values: HostValues }
  | { readonly ev: "fileEnded"; readonly run: number; readonly testFile: TestFileRef }
  /** `RunOptions.beforeForce` of request `run`; the host waits for the daemon's `forced`. */
  | {
      readonly ev: "beforeForce";
      readonly run: number;
      readonly env: Readonly<Record<string, unknown>>;
    }
  | { readonly ev: "coverage"; readonly run: WireCoverageRun };

/** What the host sends. */
export type HostMessage = HostReply | HostEvent;

/**
 * The policy values the adapter's options read as functions in the daemon
 * (`observe`, `exclude`, `excludeProjects`, coverage's `enabled` and
 * `children`). The daemon sends them again before a request once they change.
 */
export interface HostPolicy {
  readonly observe: boolean;
  readonly exclude: readonly string[];
  readonly excludeProjects: readonly string[];
  readonly coverage: boolean;
  readonly coverageChildren: boolean;
}

/** The adapter's options that are data, given once at `start`. */
export interface HostAdapterOptions {
  /** The daemon's mark of the instance's lane for its workers (001 D12). */
  readonly childEnv: Readonly<Record<string, string>>;
  readonly maxWorkers?: number;
  /** Squeal's coverage provider and the temp directory its payloads go to; absent, no coverage. */
  readonly coverage?: { readonly provider: string; readonly tempDir: string };
}

/** `start`'s argument. */
export interface HostStart {
  readonly protocol: number;
  readonly version: string;
  readonly runner: HostRunner;
  readonly options: HostAdapterOptions;
  readonly policy: HostPolicy;
}

/**
 * The values the synchronous members answer from (spec 021 D6): sent in
 * `start`'s reply, and in a `values` event before any reply after which
 * they differ, such as after an instance restart.
 */
export interface HostValues {
  /** `omittedTestFiles()`. */
  readonly omittedTestFiles: number;
  /** Vitest's widths (`WidthTable`); `null` for a runner without, or before a start. */
  readonly widths: unknown;
}

/** `start`'s reply. */
export interface HostStarted {
  readonly protocol: number;
  readonly version: string;
  /** The host's process: what the environment descriptor holds of it (spec 018 D1). */
  readonly host: {
    readonly pid: number;
    readonly nodeVersion: string;
    readonly platform: string;
    readonly arch: string;
  };
  readonly adapter: {
    readonly name: string;
    readonly adapterVersion: string;
    readonly focuses: boolean;
    /** The optional asynchronous members the adapter has, such as `recheck`. */
    readonly members: readonly ("recheck" | "globalSetups")[];
  };
  readonly values: HostValues;
}

/**
 * `run`'s options as data. `signal` and `stop` become `cancel` requests,
 * `fileEnded` an event; `beforeForce` is `true` when the daemon has one,
 * which the host calls through a `beforeForce` event and the `forced` notice.
 */
export interface WireRunOptions
  extends Omit<RunOptions, "signal" | "stop" | "fileEnded" | "beforeForce"> {
  readonly beforeForce?: true;
}

/** One protocol line for `message`. */
export function encodeLine(message: DaemonMessage | HostMessage): string {
  return `${MARKER}${JSON.stringify(message)}\n`;
}

/**
 * Splits a stream's text into lines and yields the payload of each protocol
 * line; a line without the marker is someone else's output and is skipped.
 */
export class LineReader {
  #rest = "";

  /** The protocol lines `chunk` completes, each parsed. A line that does not parse throws. */
  push(chunk: string): unknown[] {
    const text = this.#rest + chunk;
    const lines = text.split("\n");
    this.#rest = lines.pop() ?? "";
    const messages: unknown[] = [];
    for (const line of lines) {
      if (!line.startsWith(MARKER)) continue;
      messages.push(JSON.parse(line.slice(MARKER.length)));
    }
    return messages;
  }
}

/** The text of a thrown value, for a reply's `e`. */
export function errorOf(cause: unknown): HostError {
  return { message: cause instanceof Error ? cause.message : String(cause) };
}
