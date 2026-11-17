import { proofCommand } from "../../src/cli/proof.js";
import { PROOF_TIMEOUT_SECONDS, type ProofArgs } from "../../src/cli/proof-args.js";
import type { AtOptions } from "../../src/cli/status-at.js";
import { type Fixture, linkInstall } from "../commit/at-keys-fixture.js";
import { RELAUNCH } from "./status-at-kit.js";

/*
 * Row 023-08: one `squeal proof` call on a fixture, with its output and
 * its JSON report's files.
 */

export interface ProofFileJson {
  readonly path: string;
  readonly verdict: string;
  readonly reason: string | null;
  readonly red: {
    readonly end: string;
    readonly from: string | null;
    readonly stored: boolean;
    readonly failures: readonly { test: string; kind: string; text: string }[];
  };
  readonly green: { readonly end: string; readonly from: string | null } | null;
}

export async function prove(
  f: Fixture,
  args: Partial<ProofArgs> & Pick<ProofArgs, "files" | "base">,
  options: AtOptions = { cacheRoot: f.cacheRoot, install: linkInstall().install },
) {
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    stdout: (t: string) => out.push(t),
    stderr: (t: string) => err.push(t),
    cwd: f.root,
    relaunch: RELAUNCH,
  };
  const full = { case: null, timeoutSeconds: PROOF_TIMEOUT_SECONDS, json: true, ...args };
  const code = await proofCommand(full, io, options);
  const text = out.join("");
  const report = full.json ? JSON.parse(text) : null;
  return {
    code,
    out: text,
    err: err.join(""),
    report,
    files: (report?.files ?? []) as ProofFileJson[],
  };
}
