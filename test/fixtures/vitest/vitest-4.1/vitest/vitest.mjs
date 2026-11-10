#!/usr/bin/env node
// The CLI calls its own chunk, as Vitest's `dist/cli.js` does, never `vitest/node`.
import { s as startVitest } from "./lib/chunks/cli-api.js";

const [, , command, ...filters] = process.argv;
await startVitest(command === "run" ? "test" : command, filters, {});
