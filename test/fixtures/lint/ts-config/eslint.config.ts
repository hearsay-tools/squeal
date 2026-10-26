// Review 0.1.348 B2: a TypeScript config, which ESLint loads through jiti,
// with a local rule in its own module and one inline.
import probe from "./rule.ts";

export default [
  { ignores: ["eslint.config.ts", "rule.ts"] },
  {
    plugins: {
      local: {
        rules: {
          probe,
          inline: {
            meta: { schema: [] },
            create(context: { report(report: object): void }) {
              return {
                Program(node: object) {
                  context.report({ node, message: "inline before" });
                },
              };
            },
          },
        },
      },
    },
    rules: { "local/probe": "error", "local/inline": "error" },
  },
];
