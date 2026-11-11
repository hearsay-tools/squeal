export function label(name, rebrand) {
  if (rebrand && name !== "hsq") return `${name} (deprecated)`;
  return name;
}
