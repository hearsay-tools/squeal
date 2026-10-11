const { createVitestAdapter } = await import(`${process.env.SQUEAL_SRC}/runners/vitest/index.ts`);
import { createHash } from "node:crypto";
const root = process.argv[2];
const adapter = await createVitestAdapter({ root: root as never, observe: () => process.env.PROBE_OBSERVE === "1" });
const envs = await adapter.environment();
const h = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const out: Record<string, unknown> = {};
for (const e of envs) {
  const { resolvedConfig, files, packages, ...rest } = e as never as Record<string, unknown>;
  out[e.project] = { ...rest, resolvedConfig: h(resolvedConfig as string), files, packages: h(JSON.stringify(packages)) };
  if (process.env.PROBE_DUMP) await import("node:fs").then((fs) => fs.writeFileSync(process.env.PROBE_DUMP + "." + e.project + ".json", JSON.stringify(JSON.parse(resolvedConfig as string), null, 1)));
}
console.log(JSON.stringify(out, null, 1));
await (adapter as never as { close(): Promise<void> }).close?.();
process.exit(0);
