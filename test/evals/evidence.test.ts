import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearScratch, codexConfig, redact, secretsOf } from "../../evals/lib/index.mjs";

// Review 006-03 B1 and S3, with made-up tokens only: retained evidence holds no recognized
// secret after the cell, and an inline provider credential never reaches a scratch config.
const dirs: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "squeal-evals-evidence-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) {
    chmodSync(d, 0o755);
    for (const p of ["work/locked", "work/locked/leak.txt"])
      if (existsSync(join(d, p))) chmodSync(join(d, p), 0o755);
    rmSync(d, { recursive: true, force: true });
  }
});

const TOKEN = "made-up-token-0123456789abcdefghijklmn";
const HOST = "proxy.example.invalid";
const SECRETS = [TOKEN, TOKEN.slice(-20), HOST];
const write = (d: string, p: string, s: string | Buffer) => {
  mkdirSync(join(d, p, ".."), { recursive: true });
  writeFileSync(join(d, p), s);
};
const holds = (d: string, p: string) =>
  existsSync(join(d, p)) && SECRETS.some((s) => readFileSync(join(d, p), "latin1").includes(s));

describe("clearScratch on retained evidence (B1)", () => {
  it("sanitizes text evidence and removes binary evidence, never keeping a secret", () => {
    const cell = scratch();
    write(cell, "out/events.jsonl", `{"t":1,"text":"key ${TOKEN}"}\n`);
    write(cell, "out/runner.log", `codex failed: https://${HOST}/v1\n`);
    write(cell, "out/harness/s.jsonl", `{"tail":"${TOKEN.slice(-20)}"}\n`);
    write(cell, "out/diff.patch", `+const k = "${TOKEN}";\n`);
    write(
      cell,
      "out/store/store.sqlite",
      Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(TOKEN)]),
    );
    write(cell, "work/notes.txt", `see ${HOST}\n`);
    write(cell, "work/clean.txt", "nothing here\n");
    write(cell, "home/.claude.json", TOKEN);
    write(cell, "codex/config.toml", `base_url = "https://${HOST}/v1"\n`);
    const r = clearScratch(cell, SECRETS);
    expect(r.secretsBeforeRemoval.sort()).toEqual([
      "home/.claude.json",
      "out/diff.patch",
      "out/events.jsonl",
      "out/harness/s.jsonl",
      "out/runner.log",
      "out/store/store.sqlite",
      "work/notes.txt",
    ]);
    expect(r.sanitized.sort()).toEqual([
      "out/diff.patch",
      "out/events.jsonl",
      "out/harness/s.jsonl",
      "out/runner.log",
      "work/notes.txt",
    ]);
    expect(r.removed).toEqual(["out/store/store.sqlite"]);
    expect(r.secretsAfterRemoval).toEqual([]);
    for (const p of ["out/events.jsonl", "out/runner.log", "out/harness/s.jsonl", "work/notes.txt"])
      expect(holds(cell, p)).toBe(false);
    expect(readFileSync(join(cell, "out/events.jsonl"), "utf8")).toBe(
      '{"t":1,"text":"key [redacted]"}\n',
    );
    expect(readFileSync(join(cell, "work/clean.txt"), "utf8")).toBe("nothing here\n");
    expect(existsSync(join(cell, "home"))).toBe(false);
    expect(existsSync(join(cell, "codex"))).toBe(false);
  });

  it("removes the work tree's .git, whose compressed objects no scan can read", () => {
    const cell = scratch();
    write(cell, "work/.git/objects/ab/cdef", "x");
    write(cell, "work/src/a.ts", "export {};\n");
    clearScratch(cell, SECRETS);
    expect(existsSync(join(cell, "work/.git"))).toBe(false);
    expect(existsSync(join(cell, "work/src/a.ts"))).toBe(true);
  });

  it("reports a secret it could neither sanitize nor remove, by path only", () => {
    const cell = scratch();
    write(cell, "work/locked/leak.txt", TOKEN);
    chmodSync(join(cell, "work/locked/leak.txt"), 0o444);
    chmodSync(join(cell, "work/locked"), 0o555);
    const r = clearScratch(cell, SECRETS);
    expect(r.secretsAfterRemoval).toEqual(["work/locked/leak.txt"]);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe("redact", () => {
  it("replaces the longest secret first", () => {
    expect(redact(`a ${TOKEN} b ${TOKEN.slice(-20)} c ${HOST}`, SECRETS)).toBe(
      "a [redacted] b [redacted] c [redacted]",
    );
  });
});

describe("the Codex provider block (S3)", () => {
  const config = (extra: string[]) =>
    [
      'model_provider = "hostproxy"',
      "",
      "[model_providers.hostproxy]",
      'name = "Host proxy"',
      `base_url = "https://${HOST}/v1"`,
      'env_key = "HOSTPROXY_API_KEY"',
      'wire_api = "responses"',
      "requires_openai_auth = false",
      ...extra,
    ].join("\n");

  it("copies the allow-listed fields", () => {
    const c = codexConfig(config(["supports_websockets = false"]), "gpt-6-luna");
    expect(c).toContain('env_key = "HOSTPROXY_API_KEY"');
    expect(c).toContain("supports_websockets = false");
  });

  it("rejects an inline credential without naming its value", () => {
    for (const extra of [
      [`http_headers = { Authorization = "Bearer ${TOKEN}" }`],
      [`experimental_bearer_token = "${TOKEN}"`],
      [`query_params = { key = "${TOKEN}" }`],
      ["", "[model_providers.hostproxy.http_headers]", `Authorization = "Bearer ${TOKEN}"`],
    ]) {
      let message = "";
      try {
        codexConfig(config(extra), "gpt-6-luna");
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/not copied|not supported/);
      expect(message).not.toContain(TOKEN);
    }
  });

  it("collects inline provider credentials for redaction", () => {
    const secrets = secretsOf(
      {},
      config([`http_headers = { Authorization = "Bearer ${TOKEN}" }`, `x_token = "${TOKEN}x"`]),
    );
    expect(secrets).toEqual(expect.arrayContaining([`Bearer ${TOKEN}`, `${TOKEN}x`, HOST]));
    expect(secrets).not.toContain("HOSTPROXY_API_KEY");
    expect(secrets).not.toContain("Host proxy");
  });
});
