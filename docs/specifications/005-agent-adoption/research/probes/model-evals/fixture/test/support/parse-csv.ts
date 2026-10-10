/** A small RFC 4180 reader for the export tests: quoted fields, doubled quotes, no newlines in fields. */
export function parseCsv(text: string): string[][] {
  return text.split("\n").map((row) => {
    const fields: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (quoted) {
        if (c === '"' && row[i + 1] === '"') {
          current += '"';
          i++;
        } else if (c === '"') quoted = false;
        else current += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") {
        fields.push(current);
        current = "";
      } else current += c;
    }
    fields.push(current);
    return fields;
  });
}
