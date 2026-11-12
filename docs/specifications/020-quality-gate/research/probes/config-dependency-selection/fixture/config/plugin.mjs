export default function marker() {
  return {
    name: 'cds-marker',
    transform(code, id) {
      if (id.endsWith('/src/marked.ts')) return code.replace('__MARK__', '"one"')
    },
  }
}
