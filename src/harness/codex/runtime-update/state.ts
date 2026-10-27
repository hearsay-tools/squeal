import { readFileSync } from "node:fs";
import { writeAtomic } from "../adapter/layout.js";
import { updateStateFile } from "./paths.js";

/*
 * Row 002-34 (spec 002 D8, `wave-5-contract.md`): the persisted result of
 * the last runtime-update check and when a scheduled check may run again.
 * Update state is separate from validation state: a failed check keeps the
 * selected runtime and is recorded here only. An explicit update ignores
 * the delay.
 */

/** After a successful check. */
export const CHECK_INTERVAL_MS = 60 * 60_000;
/** After a failure that can pass unchanged later: network, timeout, staging, HTTP 408, 429, 5xx. */
export const TRANSIENT_RETRY_MS = 5 * 60_000;
/** After a failure that needs a new release or another host. */
export const FAILURE_RETRY_MS = 60 * 60_000;

export interface UpdateFailure {
  /** A `RuntimeReleaseError` code, a store `RuntimeError` kind, or `internal`. */
  readonly code: string;
  readonly transient: boolean;
  readonly message: string;
}

export interface UpdateState {
  readonly schema: 1;
  /** When the last check ended, ISO 8601. */
  readonly checkedAt: string;
  /** The earliest time a scheduled check runs again, ISO 8601. */
  readonly nextCheckAt: string;
  /** `updated`: a newer runtime was selected; `current`: none newer exists. */
  readonly outcome: "updated" | "current" | "failed";
  /** The release tag the check resolved; `null` when it failed before. */
  readonly release: string | null;
  /** The runtime a new session selects after the check. */
  readonly selected: string | null;
  readonly failure: UpdateFailure | null;
  /** When a check last succeeded, ISO 8601; `null` before the first. */
  readonly lastSuccessAt: string | null;
}

/** The state, or `null` when there is none or it is unreadable: a check is then due. */
export function readUpdateState(data: string): UpdateState | null {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(updateStateFile(data), "utf8"));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const state = value as Partial<UpdateState>;
  return state.schema === 1 &&
    typeof state.checkedAt === "string" &&
    typeof state.nextCheckAt === "string" &&
    (state.outcome === "updated" || state.outcome === "current" || state.outcome === "failed")
    ? (value as UpdateState)
    : null;
}

/**
 * Whether a scheduled check may run at `now`. A next check further ahead
 * than the longest interval, as after the clock moved back, is due.
 */
export function isDue(state: UpdateState | null, now: number): boolean {
  if (state === null) return true;
  const next = Date.parse(state.nextCheckAt);
  return Number.isNaN(next) || next <= now || next - now > CHECK_INTERVAL_MS;
}

/** Records one check's result and schedules the next. */
export function recordCheck(
  data: string,
  result: {
    readonly outcome: UpdateState["outcome"];
    readonly release: string | null;
    readonly selected: string | null;
    readonly failure: UpdateFailure | null;
  },
  now: number,
): UpdateState {
  const delay =
    result.failure === null
      ? CHECK_INTERVAL_MS
      : result.failure.transient
        ? TRANSIENT_RETRY_MS
        : FAILURE_RETRY_MS;
  const at = new Date(now).toISOString();
  const state: UpdateState = {
    schema: 1,
    checkedAt: at,
    nextCheckAt: new Date(now + delay).toISOString(),
    ...result,
    lastSuccessAt: result.failure === null ? at : (readUpdateState(data)?.lastSuccessAt ?? null),
  };
  writeAtomic(updateStateFile(data), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}
