const { readFileSync } = require("node:fs");
const { join } = require("node:path");

process.stdout.write(readFileSync(join(__dirname, "../data/descendant.txt"), "utf8").trim());
