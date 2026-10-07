/**
 * The `TestsStream` events Squeal's reporter writes, one NDJSON line each
 * (spec 003 D5). Only the fields Squeal reads are typed; research
 * runner-api 1 lists the rest. Node 24 adds `testId`, `parentId` and
 * `entryFile`; Node 22 has none of them.
 */
export interface TestEventData {
  readonly name?: string;
  readonly nesting?: number;
  readonly testId?: number;
  readonly parentId?: number;
  /** Absolute path; `null` on the run's final `test:summary`. A relative path on `test:stderr`. */
  readonly file?: string | null;
  /** Node 24.20 and later, on events forwarded from a test file's process. */
  readonly entryFile?: string;
  readonly line?: number;
  readonly column?: number;
  /** A directive: `true` or the reason string. */
  readonly skip?: boolean | string;
  readonly todo?: boolean | string;
  readonly message?: string;
  readonly details?: {
    readonly duration_ms?: number;
    readonly type?: "suite" | "test";
    readonly passed?: boolean;
    readonly error?: SerializedTestError;
  };
}

/** An `ERR_TEST_FAILURE` with its own properties copied by the reporter. */
export interface SerializedTestError {
  readonly name?: string;
  readonly message?: string;
  readonly stack?: string | null;
  readonly code?: string;
  readonly failureType?: string;
  /** The thrown value: an error's own properties, or a primitive. */
  readonly cause?: unknown;
}

export interface TestEvent {
  readonly type: string;
  readonly data: TestEventData;
}

/**
 * Parses an events file. A line cut short by a kill, or anything that is not
 * an event, is skipped: the completion rule (`report.ts`) decides what a
 * partial stream is worth.
 */
export function parseEvents(text: string): TestEvent[] {
  const events: TestEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isEvent(value)) events.push(value);
    } catch {
      // a partial last line of a killed process
    }
  }
  return events;
}

function isEvent(value: unknown): value is TestEvent {
  if (typeof value !== "object" || value === null) return false;
  const { type, data } = value as { type?: unknown; data?: unknown };
  return typeof type === "string" && typeof data === "object" && data !== null;
}
