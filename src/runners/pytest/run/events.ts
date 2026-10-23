/**
 * The records `squeal_pytest` writes, one JSON line each (spec 007 D6; the
 * plugin's docstring lists them). Paths in `collect`, `collected` and
 * `import` are absolute real paths; `location.path` and node ids are
 * relative to pytest's rootdir.
 */
export type PytestEvent =
  | {
      readonly type: "start";
      readonly pid: number;
      readonly python: string;
      readonly pytest: string;
    }
  | { readonly type: "refused"; readonly flags: readonly string[] }
  | {
      readonly type: "collect";
      readonly nodeid: string;
      /** The collector's class: `Module`, `Package`, `Dir`, `Session`, a plugin's. */
      readonly kind: string;
      readonly path: string;
      readonly outcome: "passed" | "failed" | "skipped";
      readonly longrepr: string | null;
    }
  | { readonly type: "collected"; readonly items: readonly CollectedItem[] }
  | { readonly type: "deselected"; readonly nodeids: readonly string[] }
  | {
      readonly type: "focused";
      /** Per real path given texts: the items it collected and those the texts selected. */
      readonly files: Readonly<
        Record<string, { readonly collected: number; readonly matched: number }>
      >;
    }
  | { readonly type: "item"; readonly nodeid: string; readonly last: boolean }
  | PhaseEvent
  | {
      readonly type: "warning";
      readonly when: string;
      readonly nodeid: string;
      readonly category: string;
      readonly message: string;
    }
  | ImportEvent
  | SpawnedEvent
  | { readonly type: "session"; readonly exitstatus: number };

export interface CollectedItem {
  readonly nodeid: string;
  /**
   * The item's `name`, the last part of its node id, which a parametrize id
   * holding `::` makes ambiguous (task 007-43). Optional: without it only the
   * basetemp is scrubbed.
   */
  readonly name?: string;
  readonly path: string;
}

/** One `pytest_runtest_logreport`. */
export interface PhaseEvent {
  readonly type: "phase";
  readonly nodeid: string;
  readonly when: "setup" | "call" | "teardown";
  readonly outcome: "passed" | "failed" | "skipped";
  /** Seconds. */
  readonly duration: number;
  /** `report.location`: the line is zero-based (runner-api F2). */
  readonly location: {
    readonly path: string;
    readonly line: number | null;
    readonly domain: string;
  };
  readonly longrepr: string | null;
  /** `longrepr.reprcrash`: the line is one-based and may name a helper or fixture. */
  readonly crash: { readonly path: string; readonly line: number; readonly message: string } | null;
  readonly wasxfail: string | null;
}

/**
 * An import edge. `from` is the importing module's file when it is a project
 * file, else `null`; `ctx` is the file whose collector or item was in
 * progress, `null` outside them (start-up, conftests, directory collection).
 */
export interface ImportEvent {
  readonly type: "import";
  readonly from: string | null;
  readonly to: string;
  readonly ctx: string | null;
}

/**
 * A project file a Python process the test started found to import, or the
 * script it ran, written by that process's `sitecustomize` (task 007-55).
 * `ctx` is the test file in progress when the process started.
 */
export interface SpawnedEvent {
  readonly type: "spawned";
  readonly to: string;
  readonly ctx: string;
  readonly pid: number;
}

/**
 * Parses an events file. A line cut short by a kill, or anything that is
 * not a record, is skipped: the completion rule (`report.ts`) decides what a
 * partial stream is worth.
 */
export function parsePytestEvents(text: string): PytestEvent[] {
  const events: PytestEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value: unknown = JSON.parse(line);
      if (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { type?: unknown }).type === "string"
      ) {
        events.push(value as PytestEvent);
      }
    } catch {
      // a partial last line of a killed process
    }
  }
  return events;
}
