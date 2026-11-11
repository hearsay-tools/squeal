/*
 * Spec 021 D14 (row 021-13): the bundle goes to the remote as one ustar
 * archive on `ssh`'s input, unpacked there by `tar -xf -`, which every
 * remote with a POSIX userland has. Regular files only; `tar` makes their
 * directories.
 */

const BLOCK = 512;

/** One file of an archive: its path with `/`, its bytes. */
export interface TarFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** A ustar archive of `files`, each mode 0644, ended by two empty blocks. */
export function tarOf(files: readonly TarFile[]): Buffer {
  const parts: Buffer[] = [];
  for (const file of files) {
    parts.push(header(file.path, file.bytes.byteLength));
    parts.push(Buffer.from(file.bytes));
    const pad = (BLOCK - (file.bytes.byteLength % BLOCK)) % BLOCK;
    if (pad > 0) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

function header(path: string, size: number): Buffer {
  const block = Buffer.alloc(BLOCK);
  const [prefix, name] = split(path);
  block.write(name, 0, 100, "utf8");
  octal(block, 100, 8, 0o644);
  octal(block, 108, 8, 0);
  octal(block, 116, 8, 0);
  octal(block, 124, 12, size);
  octal(block, 136, 12, 0);
  // The checksum is summed with its own field as spaces.
  block.fill(0x20, 148, 156);
  block.write("0", 156, 1, "ascii");
  block.write("ustar\u000000", 257, 8, "ascii");
  block.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\u0000 `, 148, 8, "ascii");
  return block;
}

/** ustar's `prefix` and `name` for `path`: a name of up to 100 bytes after a prefix of up to 155. */
function split(path: string): [string, string] {
  if (Buffer.byteLength(path) <= 100) return ["", path];
  for (let at = path.indexOf("/"); at > 0; at = path.indexOf("/", at + 1)) {
    const prefix = path.slice(0, at);
    const name = path.slice(at + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return [prefix, name];
  }
  throw new Error(`tar: the path ${path} is too long for ustar`);
}

function octal(block: Buffer, at: number, width: number, value: number): void {
  block.write(`${value.toString(8).padStart(width - 1, "0")}\u0000`, at, width, "ascii");
}
