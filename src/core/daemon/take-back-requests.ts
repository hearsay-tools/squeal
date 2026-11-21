import { randomUUID } from "node:crypto";
import { PAYLOAD_SCHEMA_VERSION } from "../types/common.js";
import type { DaemonResponse, TakeBackResponse } from "../types/daemon.js";
import type { TakeBackResult } from "../types/scheduler.js";
import { errorResponse } from "./protocol.js";

/*
 * Spec 023 D4.11 (row 023-34, T1; a change in spec 011's files approved by
 * 023's coordinator): the socket's `take-back` requests, as `sync`'s are
 * kept. `take` hands the covered-files ids to the scheduler, never
 * awaited, and answers at once with a request id; `status` answers what
 * the scheduler did. The newest `max` are remembered.
 */

interface TakeBackState {
  result: TakeBackResult | null;
  error: string | null;
}

export function takeBackRequests(
  takeBack: ((coveredIds: readonly string[]) => Promise<TakeBackResult>) | undefined,
  max: number,
): {
  take(coveredIds: readonly string[]): DaemonResponse;
  status(requestId: string): DaemonResponse;
} {
  const requests = new Map<string, TakeBackState>();
  const answer = (requestId: string, state: TakeBackState): TakeBackResponse => ({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "take-back",
    requestId,
    result: state.result,
    error: state.error,
  });
  return {
    take(coveredIds) {
      if (takeBack === undefined) return errorResponse("this daemon cannot take back");
      const requestId = randomUUID();
      const state: TakeBackState = { result: null, error: null };
      requests.set(requestId, state);
      for (const old of requests.keys()) {
        if (requests.size <= max) break;
        requests.delete(old);
      }
      takeBack(coveredIds).then(
        (result) => {
          state.result = result;
        },
        (error: unknown) => {
          state.error = error instanceof Error ? error.message : String(error);
        },
      );
      return answer(requestId, state);
    },
    status(requestId) {
      const state = requests.get(requestId);
      return state === undefined
        ? errorResponse(`unknown request id ${requestId}`)
        : answer(requestId, state);
    },
  };
}
