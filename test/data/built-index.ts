import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadIndex, type GeoIndex } from "../../src/index/format.ts";

function read(url: URL): ArrayBuffer {
  const bytes = readFileSync(url);
  // readFileSync can return a view into a shared pool, so copy into a buffer of its own.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** The index from the real data build. Throws if the build has not been run. */
export function loadBuiltIndex(): GeoIndex {
  const files = ["settlements.bin", "boundaries.bin"].map((f) => new URL(`../../data/build/${f}`, import.meta.url));
  const missing = files.filter((f) => !existsSync(f)).map((f) => fileURLToPath(f));
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(" and ")}. Run npm run data:pin and then npm run data:build before npm run test:data.`);
  }
  return loadIndex(read(files[0]!), read(files[1]!));
}

export function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as T;
}
