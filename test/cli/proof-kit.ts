import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { proofCommand } from "../../src/cli/proof.js";
import { PROOF_TIMEOUT_SECONDS, type ProofArgs } from "../../src/cli/proof-args.js";
import type { AtOptions } from "../../src/cli/status-at.js";
import { type Fixture, linkInstall } from "../commit/at-keys-fixture.js";
import { RELAUNCH } from "./status-at-kit.js";

/*
 * Row 023-08: one `squeal proof` call on a fixture, with its output and
 * its JSON report's files; row 023-11: under an environment of its own
 * (a `HOME` and variables the fixture sets).
 */

export interface ProofFileJson {
  readonly project: string;
  readonly path: string;
  readonly verdict: string;
  readonly reason: string | null;
  readonly red: {
    readonly end: string;
    readonly reason: string | null;
    readonly from: string | null;
    readonly stored: boolean;
    readonly notStored: string | null;
    readonly runs: number;
    readonly failures: readonly { test: string; kind: string; text: string }[];
  };
  readonly green: {
    readonly end: string;
    readonly from: string | null;
    readonly stored: boolean;
    readonly notStored: string | null;
    readonly runs: number;
  } | null;
}

export async function prove(
  f: Fixture,
  args: Partial<ProofArgs> & Pick<ProofArgs, "files" | "base">,
  options: AtOptions = { cacheRoot: f.cacheRoot, install: linkInstall().install },
  env?: NodeJS.ProcessEnv,
) {
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    stdout: (t: string) => out.push(t),
    stderr: (t: string) => err.push(t),
    cwd: f.root,
    relaunch: RELAUNCH,
    ...(env === undefined ? {} : { env }),
  };
  const full = { case: null, timeoutSeconds: PROOF_TIMEOUT_SECONDS, json: true, ...args };
  const code = await proofCommand(full, io, options);
  const text = out.join("");
  const report = full.json && text !== "" ? JSON.parse(text) : null;
  return {
    code,
    out: text,
    err: err.join(""),
    report,
    files: (report?.files ?? []) as ProofFileJson[],
  };
}

/** Row 023-11: how many results the fixture's shared store holds. */
export function resultRows(f: Fixture): number {
  const path = join(f.root, ".git", "squeal", "store.sqlite");
  if (!existsSync(path)) return 0;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Number((db.prepare("SELECT count(*) AS n FROM results").get() as { n: number }).n);
  } finally {
    db.close();
  }
}
