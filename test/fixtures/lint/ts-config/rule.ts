export default {
  meta: { schema: [] },
  create(context: { report(report: object): void }) {
    return {
      Program(node: object) {
        context.report({ node, message: "before" });
      },
    };
  },
};
