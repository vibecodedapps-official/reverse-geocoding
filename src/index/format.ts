// Binary layout shared by the data build (writer) and the Worker (reader).
//
// A file is: magic "GRIX", u32 format version, u32 header byte length, the header as UTF-8
// JSON, zero padding to an 8-byte boundary, then the sections. Each section starts on an
// 8-byte boundary so typed-array views can be taken over the buffer without copying.
// All integers are little-endian.

export const FORMAT_VERSION = 1;
const MAGIC = 0x58495247; // "GRIX" read as a little-endian u32

/** Coordinates are stored as integers in units of 1e-5 degrees. */
export const COORD_SCALE = 100_000;
export const GRID_ROWS = 180;
export const GRID_COLS = 360;
export const CELL_COUNT = GRID_ROWS * GRID_COLS;
/** Admin1 table index meaning "no region". */
export const NO_ADMIN1 = 0xffff;

/** Grid row of a latitude in 1e-5 degrees: floor(lat + 90), clamped to 0..179. */
export function cellRow(latE5: number): number {
  const row = Math.floor((latE5 + 90 * COORD_SCALE) / COORD_SCALE);
  return row < 0 ? 0 : row >= GRID_ROWS ? GRID_ROWS - 1 : row;
}

/** Grid column of a longitude in 1e-5 degrees: floor(lon + 180) mod 360. */
export function cellCol(lonE5: number): number {
  const col = Math.floor((lonE5 + 180 * COORD_SCALE) / COORD_SCALE) % GRID_COLS;
  return col < 0 ? col + GRID_COLS : col;
}

export function cellIndex(row: number, col: number): number {
  return row * GRID_COLS + col;
}

export interface Country {
  /** ISO 3166-1 alpha-2 code. */
  code: string;
  /** Cleaned `countryInfo.txt` name. */
  name: string;
}

export interface Admin1 {
  /** Index into `Tables.countries`. */
  country: number;
  /** GeoNames admin1 code, without the country prefix. */
  code: string;
  /** Cleaned `admin1CodesASCII.txt` name. */
  name: string;
}

export interface Tables {
  countries: Country[];
  admin1: Admin1[];
}

/** Longest cleaned component name in the build, by both length measures. */
export interface LongestName {
  utf16: number;
  codePoints: number;
}

export interface SourceVersion {
  name: string;
  /** Upstream version: a GeoNames download date, or a geoBoundaries tag and commit. */
  version: string;
  sha256: string;
}

export interface IndexMeta {
  /** Identifies one build; both files of a build carry the same id. */
  buildId: string;
  /** Retrieval date of the pinned GeoNames files. No wall-clock time goes into the index, so rebuilds are byte-identical. */
  dataDate: string;
  sources: SourceVersion[];
  counts: { settlements: number; adm0Polygons: number; adm1Polygons: number };
  longestComponentName: LongestName;
}

/**
 * Settlements as parallel arrays sorted by grid cell. Row i of every array describes the
 * same settlement. Rows of cell c are cellStart[c] .. cellStart[c + 1] - 1.
 */
export interface SettlementArrays {
  lat: Int32Array;
  lon: Int32Array;
  /** Index into `Tables.countries`. */
  country: Uint8Array;
  /** Index into `Tables.admin1`, or NO_ADMIN1. */
  admin1: Uint16Array;
  /** Name of row i is nameBytes[nameOffsets[i] .. nameOffsets[i + 1]], UTF-8. */
  nameOffsets: Uint32Array;
  nameBytes: Uint8Array;
  /** Length CELL_COUNT + 1. */
  cellStart: Uint32Array;
}

/**
 * Polygons of one boundary level. No ring or bounding box crosses the antimeridian; the build
 * splits such polygons at longitude 180. A polygon's first ring is its outer ring, the rest are
 * holes. Polygon ids are build order; on overlap the lower id wins.
 */
export interface PolygonLayer {
  /** Rings of polygon p are polyRingStart[p] .. polyRingStart[p + 1] - 1. Length P + 1. */
  polyRingStart: Uint32Array;
  /** Vertices of ring r are ringStart[r] .. ringStart[r + 1] - 1. Length R + 1. Rings are not closed (no repeated first vertex). */
  ringStart: Uint32Array;
  /** Vertex v is (coords[2v] = lon, coords[2v + 1] = lat), 1e-5 degrees. */
  coords: Int32Array;
  /** Polygon p's box is minLon, minLat, maxLon, maxLat at bbox[4p .. 4p + 3]. */
  bbox: Int32Array;
  /** Index into `Tables.countries`, per polygon. */
  country: Uint8Array;
  /** Index into `Tables.admin1` per polygon, or NO_ADMIN1. Always NO_ADMIN1 for ADM0. */
  admin1: Uint16Array;
  /** Candidate polygons of cell c are cellPolys[cellStart[c] .. cellStart[c + 1] - 1], ascending. Length CELL_COUNT + 1. */
  cellStart: Uint32Array;
  cellPolys: Uint32Array;
}

export interface SettlementsFile {
  meta: IndexMeta;
  tables: Tables;
  settlements: SettlementArrays;
}

export interface BoundariesFile {
  buildId: string;
  adm0: PolygonLayer;
  adm1: PolygonLayer;
}

/** The full in-memory index the resolver reads. */
export interface GeoIndex {
  meta: IndexMeta;
  tables: Tables;
  settlements: SettlementArrays;
  adm0: PolygonLayer;
  adm1: PolygonLayer;
}

type TypedArray = Int32Array | Uint32Array | Uint16Array | Uint8Array;
type SectionType = "i32" | "u32" | "u16" | "u8";

interface SectionEntry {
  name: string;
  type: SectionType;
  offset: number;
  length: number;
}

interface Header {
  kind: "settlements" | "boundaries";
  data: unknown;
  sections: SectionEntry[];
}

function typeOf(a: TypedArray): SectionType {
  if (a instanceof Int32Array) return "i32";
  if (a instanceof Uint32Array) return "u32";
  if (a instanceof Uint16Array) return "u16";
  return "u8";
}

function align8(n: number): number {
  return (n + 7) & ~7;
}

function encode(kind: Header["kind"], data: unknown, arrays: Record<string, TypedArray>): Uint8Array {
  const names = Object.keys(arrays);
  const sections: SectionEntry[] = [];
  // Offsets are relative to the start of the section area, so the header can be sized first.
  let offset = 0;
  for (const name of names) {
    const a = arrays[name]!;
    sections.push({ name, type: typeOf(a), offset, length: a.length });
    offset = align8(offset + a.byteLength);
  }
  const header: Header = { kind, data, sections };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const base = align8(12 + headerBytes.length);
  const out = new Uint8Array(base + offset);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, FORMAT_VERSION, true);
  view.setUint32(8, headerBytes.length, true);
  out.set(headerBytes, 12);
  names.forEach((name, i) => {
    const a = arrays[name]!;
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), base + sections[i]!.offset);
  });
  return out;
}

function decode(buffer: ArrayBuffer, kind: Header["kind"]): { data: unknown; arrays: Map<string, TypedArray> } {
  if (buffer.byteLength < 12) throw new Error(`${kind} index is truncated`);
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw new Error(`${kind} index has a bad magic number`);
  const version = view.getUint32(4, true);
  if (version !== FORMAT_VERSION) throw new Error(`${kind} index has format version ${version}, expected ${FORMAT_VERSION}`);
  const headerLength = view.getUint32(8, true);
  if (12 + headerLength > buffer.byteLength) throw new Error(`${kind} index header is truncated`);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, headerLength))) as Header;
  if (header.kind !== kind) throw new Error(`expected a ${kind} index, got ${header.kind}`);
  const base = align8(12 + headerLength);
  const arrays = new Map<string, TypedArray>();
  for (const s of header.sections) {
    const start = base + s.offset;
    const Ctor = s.type === "i32" ? Int32Array : s.type === "u32" ? Uint32Array : s.type === "u16" ? Uint16Array : Uint8Array;
    if (start + s.length * Ctor.BYTES_PER_ELEMENT > buffer.byteLength) throw new Error(`${kind} index section ${s.name} is truncated`);
    arrays.set(s.name, new Ctor(buffer, start, s.length));
  }
  return { data: header.data, arrays };
}

function take<T extends TypedArray>(arrays: Map<string, TypedArray>, name: string, ctor: new (...args: never[]) => T): T {
  const a = arrays.get(name);
  if (!(a instanceof ctor)) throw new Error(`index section ${name} is missing or has the wrong type`);
  return a;
}

const LAYER_FIELDS = ["polyRingStart", "ringStart", "coords", "bbox", "country", "admin1", "cellStart", "cellPolys"] as const;

function layerArrays(prefix: string, layer: PolygonLayer): Record<string, TypedArray> {
  const out: Record<string, TypedArray> = {};
  for (const f of LAYER_FIELDS) out[`${prefix}.${f}`] = layer[f];
  return out;
}

function readLayer(arrays: Map<string, TypedArray>, prefix: string): PolygonLayer {
  return {
    polyRingStart: take(arrays, `${prefix}.polyRingStart`, Uint32Array),
    ringStart: take(arrays, `${prefix}.ringStart`, Uint32Array),
    coords: take(arrays, `${prefix}.coords`, Int32Array),
    bbox: take(arrays, `${prefix}.bbox`, Int32Array),
    country: take(arrays, `${prefix}.country`, Uint8Array),
    admin1: take(arrays, `${prefix}.admin1`, Uint16Array),
    cellStart: take(arrays, `${prefix}.cellStart`, Uint32Array),
    cellPolys: take(arrays, `${prefix}.cellPolys`, Uint32Array),
  };
}

export function encodeSettlements(file: SettlementsFile): Uint8Array {
  const s = file.settlements;
  return encode(
    "settlements",
    { meta: file.meta, tables: file.tables },
    {
      lat: s.lat,
      lon: s.lon,
      country: s.country,
      admin1: s.admin1,
      nameOffsets: s.nameOffsets,
      nameBytes: s.nameBytes,
      cellStart: s.cellStart,
    },
  );
}

export function decodeSettlements(buffer: ArrayBuffer): SettlementsFile {
  const { data, arrays } = decode(buffer, "settlements");
  const { meta, tables } = data as { meta: IndexMeta; tables: Tables };
  return {
    meta,
    tables,
    settlements: {
      lat: take(arrays, "lat", Int32Array),
      lon: take(arrays, "lon", Int32Array),
      country: take(arrays, "country", Uint8Array),
      admin1: take(arrays, "admin1", Uint16Array),
      nameOffsets: take(arrays, "nameOffsets", Uint32Array),
      nameBytes: take(arrays, "nameBytes", Uint8Array),
      cellStart: take(arrays, "cellStart", Uint32Array),
    },
  };
}

export function encodeBoundaries(file: BoundariesFile): Uint8Array {
  return encode("boundaries", { buildId: file.buildId }, { ...layerArrays("adm0", file.adm0), ...layerArrays("adm1", file.adm1) });
}

export function decodeBoundaries(buffer: ArrayBuffer): BoundariesFile {
  const { data, arrays } = decode(buffer, "boundaries");
  return { buildId: (data as { buildId: string }).buildId, adm0: readLayer(arrays, "adm0"), adm1: readLayer(arrays, "adm1") };
}

/** Decode both files of one build into the resolver's index. Throws if they come from different builds. */
export function loadIndex(settlements: ArrayBuffer, boundaries: ArrayBuffer): GeoIndex {
  const s = decodeSettlements(settlements);
  const b = decodeBoundaries(boundaries);
  if (s.meta.buildId !== b.buildId) throw new Error("settlements and boundaries index files come from different builds");
  return { meta: s.meta, tables: s.tables, settlements: s.settlements, adm0: b.adm0, adm1: b.adm1 };
}

const utf8 = new TextDecoder();

/** Name of settlement row i. */
export function settlementName(s: SettlementArrays, i: number): string {
  return utf8.decode(s.nameBytes.subarray(s.nameOffsets[i]!, s.nameOffsets[i + 1]!));
}
