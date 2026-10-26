import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

// The version comes from package.json, as a published plugin's does.
const { version } = createRequire(import.meta.url)("./package.json");

// Reports a named import the imported file does not export, reading it from disk.
const named = {
  meta: { type: "problem", schema: [] },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (!node.source.value.startsWith(".")) return;
        const target = resolve(dirname(context.filename), node.source.value);
        let text;
        try {
          text = readFileSync(target, "utf8");
        } catch {
          return;
        }
        for (const spec of node.specifiers) {
          if (spec.type !== "ImportSpecifier") continue;
          const name = spec.imported.name;
          if (!new RegExp(`export (const|let|function) ${name}\\b`).test(text)) {
            context.report({ node: spec, message: `${name} not found in '${node.source.value}'` });
          }
        }
      },
    };
  },
};

export default { meta: { name: "eslint-plugin-probe", version }, rules: { named } };
