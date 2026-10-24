// A plugin with one rule that crashes on any identifier named "boom".
export default {
  meta: { name: 'eslint-plugin-x', version: '1.0.0', namespace: 'x' },
  rules: {
    boom: {
      meta: { type: 'problem', schema: [] },
      create(context) {
        return { Identifier(node) { if (node.name === 'boom') throw new Error('rule bug'); } };
      },
    },
  },
};
