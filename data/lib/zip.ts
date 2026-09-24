// Reads one entry out of a zip archive, enough for the GeoNames dumps.

import { inflateRawSync } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

export function readZipEntry(zip: Uint8Array, name: string): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // The end record is 22 bytes plus a comment of at most 65535 bytes.
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error("not a zip archive: no end of central directory record");
  const entries = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let n = 0; n < entries; n++) {
    if (view.getUint32(p, true) !== CENTRAL_DIRECTORY_ENTRY) throw new Error("zip central directory is corrupt");
    const method = view.getUint16(p + 10, true);
    // Sizes come from the central directory; local headers may defer them to a data descriptor.
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const entryName = decoder.decode(zip.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extraLength + commentLength;
    if (entryName !== name) continue;
    if (view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) throw new Error(`zip entry ${name} has no local header`);
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const raw = zip.subarray(start, start + compressedSize);
    let data: Uint8Array;
    if (method === 0) data = raw;
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`zip entry ${name} uses unsupported compression method ${method}`);
    if (data.length !== size) throw new Error(`zip entry ${name} is ${data.length} bytes, expected ${size}`);
    return data;
  }
  throw new Error(`zip archive has no entry ${name}`);
}
