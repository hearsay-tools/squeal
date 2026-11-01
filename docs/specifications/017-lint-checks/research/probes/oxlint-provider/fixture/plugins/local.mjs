import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BANNED_IDENT } from "./helper.mjs";

// A JS plugin with two rules: one decided by the file and the plugin's own
// module closure, one that reads a project file the config never names.
export default {
  meta: { name: "local" },
  rules: {
    "no-ident": {
      create(context) {
        return {
          Identifier(node) {
            if (node.name === BANNED_IDENT) context.report({ node, message: `Identifier '${BANNED_IDENT}' is banned.` });
          },
        };
      },
    },
    "no-word": {
      create(context) {
        const words = readFileSync(join(context.cwd, "banned.txt"), "utf8").split("\n").map((w) => w.trim()).filter(Boolean);
        return {
          Literal(node) {
            if (typeof node.value === "string" && words.includes(node.value)) context.report({ node, message: `String '${node.value}' is banned.` });
          },
        };
      },
    },
  },
};
