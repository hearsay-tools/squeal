import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function resolve(spec, ctx, next) {
  if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL) {
    const u = new URL(spec.replace(/\.js$/, ".ts"), ctx.parentURL);
    if (existsSync(fileURLToPath(u))) return next(u.href, ctx);
  }
  return next(spec, ctx);
}
