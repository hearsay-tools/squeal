// Shaped like #194's scripts/release.mjs: a script with publish() and its loop, which only the packaged suite loads.
import { pathToFileURL } from "node:url";

export function publish(names, dryRun) {
  const done = [];
  for (const name of names) {
    if (name.startsWith("@private/")) continue;
    done.push(dryRun ? `would publish ${name}` : `published ${name}`);
  }
  return done;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  console.log(JSON.stringify(publish(args.filter((a) => a !== "--dry-run"), dry)));
}
