import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import {
  createReleaseDescriptor,
  createRuntimeManifest,
  LATEST_RELEASE_URL,
  packRuntime,
  RUNTIME_ARTIFACT_ASSET,
  RUNTIME_DESCRIPTOR_ASSET,
  releaseAssetUrl,
  serializeReleaseDescriptor,
  serializeRuntimeManifest,
} from "../../src/harness/codex/runtime-release/index.js";
import { copyPlugin, suppressCodexUpdate } from "./plugins.js";

export const VERSION = (
  JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { version: string }
).version;
export const NEXT = VERSION.replace(/\d+$/, (patch) => String(Number(patch) + 1));
export const write = (file: string, value: string | Buffer) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value);
};

/** Every installed byte and mode, including seed and static skills. */
export function tree(root: string, normalizedModes = false): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      for (const [name, hash] of Object.entries(tree(path, normalizedModes)))
        out[`${entry.name}/${name}`] = hash;
    } else
      out[entry.name] =
        `${normalizedModes ? (statSync(path).mode & 0o111 ? 0o755 : 0o644) : statSync(path).mode & 0o777}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  }
  return out;
}

/** No production HOME/config/credentials. Node fetch is a local injected release transport. */
export function shippedMachine() {
  const base = mkdtempSync("/tmp/squeal codex proof ");
  const runtime = mkdtempSync("/tmp/sq-proof-");
  const home = join(base, "home");
  const codexHome = join(home, ".codex");
  const data = join(codexHome, "plugins/data/squeal-hearsay");
  const market = join(base, "market");
  const repo = join(base, "repo");
  const plugin = join(codexHome, "plugins/cache/hearsay/squeal/1.0.0");
  const fetchLog = join(base, "fetch.jsonl");
  const routes = join(base, "routes.json");
  const preload = join(base, "transport.mjs");
  write(routes, "{}");
  write(fetchLog, "");
  write(
    preload,
    `import {readFileSync,appendFileSync} from 'node:fs';
globalThis.fetch = async (url) => {
  appendFileSync(${JSON.stringify(fetchLog)}, JSON.stringify(String(url))+'\\n');
  const path=JSON.parse(readFileSync(${JSON.stringify(routes)},'utf8'))[String(url)];
  if (!path) throw new Error('Offline proof: no transport route for '+url);
  return new Response(readFileSync(path),{status:200});
};\n`,
  );
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: home,
    CODEX_HOME: codexHome,
    XDG_RUNTIME_DIR: runtime,
    XDG_CONFIG_HOME: join(home, ".config"),
    NODE_OPTIONS: `--import=${JSON.stringify(preload)}`,
    LANG: "C.UTF-8",
    SHELL: "/bin/bash",
  };
  write(
    join(codexHome, "config.toml"),
    `model = "gpt-6.1-sol"
model_provider = "openai-offline-proof"
[model_providers.openai-offline-proof]
name = "OpenAI"
base_url = "http://127.0.0.1:1/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
`,
  );
  write(
    join(market, ".agents/plugins/marketplace.json"),
    JSON.stringify({
      name: "hearsay",
      plugins: [{ name: "squeal", source: "./plugins/codex" }],
    }),
  );
  copyPlugin("codex", join(market, "plugins/codex"));
  write(join(repo, "package.json"), '{"name":"proof","private":true,"type":"module"}');
  write(
    join(repo, "squeal.config.json"),
    JSON.stringify({
      nodeTest: [{ name: "unit", node: process.execPath, argv: [], include: ["test/*.test.mjs"] }],
    }),
  );
  write(
    join(repo, "test/value.test.mjs"),
    "import {test} from 'node:test'; test('value',()=>{});\n",
  );
  execFileSync("git", ["init", "-q"], { cwd: repo, env });
  suppressCodexUpdate(data);
  const run = (command: string, args: string[], extra: NodeJS.ProcessEnv = {}) =>
    spawnSync(command, args, {
      cwd: repo,
      env: { ...env, ...extra },
      encoding: "utf8",
      timeout: 30_000,
    });
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) =>
    run(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", join(plugin, "seed/dist/cli/squeal.mjs"), ...args],
      extra,
    );
  return {
    base,
    home,
    codexHome,
    data,
    market,
    repo,
    plugin,
    env,
    run,
    cli,
    fetches: () =>
      readFileSync(fetchLog, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string),
    /** Test-only B: current shipped bytes with runtime identity rewritten, no product build. */
    release(version = NEXT) {
      const root = join(base, "release");
      copyPlugin("codex-runtime", root);
      for (const name of Object.keys(tree(root))) {
        if (name.endsWith(".wasm")) continue;
        const path = join(root, name);
        writeFileSync(path, readFileSync(path, "utf8").replaceAll(VERSION, version));
      }
      write(
        join(root, "runtime.json"),
        serializeRuntimeManifest(createRuntimeManifest({ root, version, nodeFloor: "22.19.0" })),
      );
      chmodSync(join(root, "bin/squeal-launcher"), 0o755);
      const packed = packRuntime(root);
      const descriptor = createReleaseDescriptor({
        version,
        sha256: packed.sha256,
        releaseCommit: "b".repeat(40),
      });
      const tag = descriptor.releaseTag;
      const artifactPath = join(base, RUNTIME_ARTIFACT_ASSET);
      const descriptorPath = join(base, RUNTIME_DESCRIPTOR_ASSET);
      const latestPath = join(base, "latest.json");
      write(artifactPath, packed.artifact);
      write(descriptorPath, serializeReleaseDescriptor(descriptor));
      write(
        latestPath,
        JSON.stringify({
          tag_name: tag,
          draft: false,
          prerelease: false,
          assets: [{ name: RUNTIME_ARTIFACT_ASSET }, { name: RUNTIME_DESCRIPTOR_ASSET }],
        }),
      );
      write(
        routes,
        JSON.stringify({
          [LATEST_RELEASE_URL]: latestPath,
          [releaseAssetUrl(tag, RUNTIME_ARTIFACT_ASSET)]: artifactPath,
          [releaseAssetUrl(tag, RUNTIME_DESCRIPTOR_ASSET)]: descriptorPath,
        }),
      );
      return tag;
    },
    dispose() {
      cli(["stop"]);
      rmSync(base, { recursive: true, force: true });
      rmSync(runtime, { recursive: true, force: true });
    },
  };
}
