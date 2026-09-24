// Reads geoBoundaries CGAZ GeoJSON. The files are written one feature per line, which is what
// lets a 400 MB file be read feature by feature without holding it as one string.

import { closeSync, openSync, readSync } from "node:fs";

export interface BoundaryFeature {
  /** ISO 3166-1 alpha-3 (shapeGroup). */
  group: string;
  name: string;
  /** Present on ADM1 features; CGAZ ADM0 features carry no shapeID. */
  id: string | null;
  /** Polygons in GeoJSON form: rings of [lon, lat] degrees, closed. */
  polygons: number[][][][];
}

/** Parses one line of a CGAZ file. Returns null for lines that are not a feature (the collection header and footer). */
export function parseFeatureLine(line: string): BoundaryFeature | null {
  let t = line.trim();
  if (t.endsWith(",")) t = t.slice(0, -1);
  if (!t.startsWith("{") || t.length < 2) return null;
  if (!t.endsWith("}")) throw new Error("boundary feature spans more than one line; expected one feature per line");
  const f = JSON.parse(t) as { type?: unknown; properties?: Record<string, unknown>; geometry?: { type?: unknown; coordinates?: unknown } | null };
  if (f.type !== "Feature") return null;
  const props = f.properties ?? {};
  const group = typeof props.shapeGroup === "string" ? props.shapeGroup : "";
  const name = typeof props.shapeName === "string" ? props.shapeName : "";
  const id = typeof props.shapeID === "string" ? props.shapeID : null;
  const geometry = f.geometry;
  let polygons: number[][][][];
  if (!geometry) polygons = [];
  else if (geometry.type === "Polygon") polygons = [geometry.coordinates as number[][][]];
  else if (geometry.type === "MultiPolygon") polygons = geometry.coordinates as number[][][][];
  else throw new Error(`boundary feature ${id ?? group} has unsupported geometry type ${String(geometry.type)}`);
  return { group, name, id, polygons };
}

/**
 * Lines of a file, read in chunks so the whole file is never one string. Trailing "\r" is
 * removed. Each iteration reads the file from the start.
 */
export function readLines(path: string, chunkSize = 1 << 20): Iterable<string> {
  return { [Symbol.iterator]: () => linesOf(path, chunkSize) };
}

function* linesOf(path: string, chunkSize: number): Generator<string> {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(chunkSize);
    let pending: Buffer[] = [];
    const emit = (parts: Buffer[]) => {
      const s = Buffer.concat(parts).toString("utf8");
      return s.endsWith("\r") ? s.slice(0, -1) : s;
    };
    for (;;) {
      const n = readSync(fd, buf, 0, chunkSize, null);
      if (n === 0) break;
      const chunk = buf.subarray(0, n);
      let start = 0;
      for (let nl = chunk.indexOf(10, start); nl !== -1; nl = chunk.indexOf(10, start)) {
        yield emit([...pending, chunk.subarray(start, nl)]);
        pending = [];
        start = nl + 1;
      }
      if (start < n) pending.push(Buffer.from(chunk.subarray(start)));
    }
    if (pending.length > 0) yield emit(pending);
  } finally {
    closeSync(fd);
  }
}
