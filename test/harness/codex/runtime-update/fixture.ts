import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  createReleaseDescriptor,
  LATEST_RELEASE_URL,
  packRuntime,
  type ReleaseResponse,
  type ReleaseTransport,
  RUNTIME_ARTIFACT_ASSET,
  RUNTIME_DESCRIPTOR_ASSET,
  releaseAssetUrl,
  serializeReleaseDescriptor,
} from "../../../../src/harness/codex/runtime-release/index.js";
import { tempDir } from "../../../store/helpers.js";
import { fixedPlugin, write } from "../adapter/fixture.js";
import { runtimeTree } from "../runtime-release/fixture.js";

/*
 * Row 002-34 (spec 002 D8, `wave-5-contract.md`): a fixed plugin with its
 * seed, a data directory, and an injected release transport that serves
 * packed runtimes from memory. No test reaches a real endpoint.
 */

/** The seed's runtime, an older release and a newer one. */
export const SEED = "0.1.900";
export const NEXT = "0.1.901";
export const LATER = "0.1.902";

/** One machine: the fixed plugin (a valid adapter: `hooks/hooks.json` and `seed/`) and its data. */
export function machine(seed = SEED): { readonly plugin: string; readonly data: string } {
  const dir = tempDir("squeal-runtime-update-");
  const plugin = fixedPlugin(join(dir, "plugin"), seed);
  write(join(plugin, "hooks", "hooks.json"), "{}\n");
  return { plugin, data: join(dir, "data") };
}

/** A runtime release as GitHub would serve it: its tag, descriptor and artifact. */
export interface Release {
  readonly version: string;
  readonly tag: string;
  readonly descriptor: string;
  readonly artifact: Buffer;
}

export function release(version: string): Release {
  const packed = packRuntime(runtimeTree(version));
  const descriptor = createReleaseDescriptor({
    version,
    sha256: packed.sha256,
    releaseCommit: "c".repeat(40),
  });
  return {
    version,
    tag: descriptor.releaseTag,
    descriptor: serializeReleaseDescriptor(descriptor),
    artifact: packed.artifact,
  };
}

/** What a test server answers for an artifact request instead of the bytes. */
export type ArtifactAnswer = () => Promise<ReleaseResponse>;

export interface Server {
  readonly transport: ReleaseTransport;
  /** Every URL requested, in order. */
  readonly requests: string[];
  /** The release the latest listing names; `null` answers 404. */
  latest: Release | null;
  /** When set, answers the next artifact request in place of the bytes. */
  artifact: ArtifactAnswer | null;
}

/** One response of `status` with `bytes` as its whole body. */
export const answer = (status: number, bytes: Buffer | string | null): ReleaseResponse => ({
  status,
  headers: { get: () => null },
  body:
    bytes === null
      ? null
      : (async function* () {
          yield Buffer.from(bytes);
        })(),
});

/** A release server over `releases`, the last of them the latest. */
export function server(...releases: Release[]): Server {
  const byTag = new Map(releases.map((r) => [r.tag, r]));
  const s: Server = {
    requests: [],
    latest: releases.at(-1) ?? null,
    artifact: null,
    transport: async (url) => {
      s.requests.push(url);
      if (url === LATEST_RELEASE_URL) {
        if (s.latest === null) return answer(404, "{}");
        return answer(
          200,
          JSON.stringify({
            tag_name: s.latest.tag,
            draft: false,
            prerelease: false,
            assets: [{ name: RUNTIME_ARTIFACT_ASSET }, { name: RUNTIME_DESCRIPTOR_ASSET }],
          }),
        );
      }
      for (const r of byTag.values()) {
        if (url === releaseAssetUrl(r.tag, RUNTIME_DESCRIPTOR_ASSET))
          return answer(200, r.descriptor);
        if (url === releaseAssetUrl(r.tag, RUNTIME_ARTIFACT_ASSET)) {
          const instead = s.artifact;
          s.artifact = null;
          return instead === null ? answer(200, r.artifact) : instead();
        }
      }
      return answer(404, null);
    },
  };
  return s;
}

/** An artifact body that sends half the bytes, then fails as a dropped connection does. */
export function droppedAfterHalf(r: Release): ArtifactAnswer {
  return async () => ({
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      yield r.artifact.subarray(0, r.artifact.length >> 1);
      throw new TypeError("terminated", { cause: { code: "ECONNRESET" } });
    })(),
  });
}

/** An artifact answer held until `open()`, then served whole. */
export function gated(r: Release): { readonly answer: ArtifactAnswer; readonly open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    answer: async () => {
      await opened;
      return answer(200, r.artifact);
    },
    open: () => open(),
  };
}

/** The pid of a process that has exited: a lock owner that was killed. */
export function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
    encoding: "utf8",
  });
  return Number(r.stdout);
}
