import { readFileSync } from "node:fs";

process.stdout.write(readFileSync(new URL("../data/grand.txt", import.meta.url), "utf8").trim());
