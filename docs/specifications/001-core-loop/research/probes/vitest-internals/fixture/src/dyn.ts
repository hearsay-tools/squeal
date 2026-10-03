export async function loadByName(name: string) {
  return (await import(`./plugins/${name}.ts`)).default
}
