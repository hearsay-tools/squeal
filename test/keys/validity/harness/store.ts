import { newFileState } from "../../../../src/core/scheduler/files.js";
import {
  type StoreDecision,
  storeDecision,
  tierEnd,
} from "../../../../src/core/scheduler/store-decision.js";
import type { CaseOutput, StoreInput } from "../case.js";
import { keysOf, observationsOf, recorded, refOf } from "./store-input.js";

/*
 * The `store` kind (task 011-37 section 3, row 011-40): each file's
 * `storeDecision` over its tier's end (`tierEnd`). A decision with the same
 * effects is named alike: nothing recorded, whether the file is gone, grew
 * under a key an edit moved, or first saw a path with no re-run due.
 */

function named(d: StoreDecision, keys: ReturnType<typeof keysOf>): string {
  switch (d.kind) {
    case "superseded":
    case "withheld":
    case "requeue":
    case "unknown":
    case "environment":
      return d.kind;
    case "gone":
    case "no-key":
      return "nothing";
    case "not-started":
      return "not started";
    case "split":
      return `split at ${d.cap}`;
    case "unstable":
      return `unstable: ${d.paths.join(", ")}`;
    case "first-seen":
      return d.rerun ? "first seen" : "nothing";
    case "store":
      return `store at ${d.at === "ran" ? keys.ran : keys.grown}`;
  }
}

/** What recording `input`'s tier decides for each file. */
export function storeCase(input: StoreInput, _scratch: string): CaseOutput {
  const { report, requeue } = recorded(input);
  const files = input.files.map((f) => {
    const keys = keysOf(f);
    const file = newFileState(refOf(f.path));
    Object.assign(file, { key: keys.key, runningKey: keys.running, resultKey: keys.result });
    return { f, keys, entry: { file, key: keys.ran, inputs: f.inputs ?? [] } };
  });
  const end = tierEnd(
    {
      files: files.map(({ entry }) => ({ ...entry, checkpointId: null, forced: false })),
      lane: "",
      changes: new Set(),
      cancel: input.cancelled === true ? aborted() : null,
    },
    report,
    new Set(input.changed ?? []),
    requeue,
    observationsOf(input),
  );
  const decisions = files.map(({ f, keys, entry }) => {
    const d = storeDecision(entry, end, f.held !== false);
    return {
      path: f.path,
      decision: named(d, keys),
      grown: "growth" in d && d.growth !== undefined,
      current: d.kind === "store" && d.current,
    };
  });
  return { outputs: { decisions }, wording: { failure: report.failure } };
}

function aborted(): AbortController {
  const controller = new AbortController();
  controller.abort();
  return controller;
}
