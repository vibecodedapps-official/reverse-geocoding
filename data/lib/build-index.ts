// The data build as a pure function: source contents in, index files and manifest out.
// Nothing here reads the clock or the file system, and every iteration follows input order
// or an explicit sort, so equal inputs give byte-identical index files.

import { createHash } from "node:crypto";
import {
  COORD_SCALE,
  FORMAT_VERSION,
  GRID_COLS,
  NO_ADMIN1,
  cellCol,
  cellIndex,
  cellRow,
  encodeBoundaries,
  encodeSettlements,
  type Admin1,
  type Country,
  type IndexMeta,
  type PolygonLayer,
} from "../../src/index/format.ts";
import { parseFeatureLine } from "./cgaz.ts";
import { parseAdmin1Codes, parseCities, parseCountryInfo, type City } from "./geonames.ts";
import {
  INSIDE,
  SIMPLIFY_TOLERANCE_DEG,
  Topology,
  locatePoint,
  preparePolygon,
  splitAtAntimeridian,
  toFixedRing,
  type Polygon,
  type PreparedPolygon,
} from "./geometry.ts";
import { layoutPolygons, layoutSettlements, type PolygonRow, type SettlementRow } from "./layout.ts";
import { REGION_SHARE, cityGrid, mapRegions, parseOverrides, type RegionMapping, type RegionShape } from "./regions.ts";

export interface SourcePin {
  name: string;
  source: "geonames" | "geoboundaries";
  /** GeoNames: the retrieval date. geoBoundaries: the tag and commit. */
  version: string;
  /** YYYY-MM-DD. */
  retrieved: string;
  sha256: string;
}

export interface BuildInputs {
  /** Contents of cities500.txt. */
  cities: string;
  /** Contents of admin1CodesASCII.txt. */
  admin1Codes: string;
  /** Contents of countryInfo.txt. */
  countryInfo: string;
  /** Lines of the CGAZ ADM0 and ADM1 GeoJSON files, one feature per line. Each is iterated twice. */
  adm0: Iterable<string>;
  adm1: Iterable<string>;
  /** Contents of the admin1 overrides CSV. */
  overrides: string;
  /** Pins of the source files, for versions and dataDate. */
  pins: readonly SourcePin[];
  /** Goes into the manifest only, never into the index files. */
  builtAt: string;
}

interface NamedLength {
  length: number;
  name: string;
}

export interface BuildManifest {
  buildId: string;
  dataDate: string;
  builtAt: string;
  sources: SourcePin[];
  parameters: { simplifyToleranceDeg: number; regionShare: number; formatVersion: number };
  counts: {
    settlements: number;
    countries: number;
    admin1Regions: number;
    adm0Features: number;
    adm1Features: number;
    adm0Polygons: number;
    adm1Polygons: number;
  };
  bytes: { settlements: number; boundaries: number };
  longestComponentName: { utf16: NamedLength; codePoints: NamedLength };
  overlaps: number;
  unmappedRegions: number;
  unmatchedBoundaryGroups: number;
}

type Level = "ADM0" | "ADM1";

export interface BuildReport {
  /** Boundary features whose shapeGroup has no country in countryInfo.txt; left out of the index. */
  unmatchedGroups: Array<{ level: Level; group: string; name: string; id: string | null }>;
  /** Features with no polygon left after simplification. */
  vanishedFeatures: Array<{ level: Level; label: string }>;
  /** GeoNames regions no ADM1 polygon maps to. */
  unmappedRegions: Array<{ code: string; name: string }>;
  /** Pairs of features of one level where a vertex of one lies strictly inside the other. */
  overlaps: Array<{ level: Level; a: string; b: string }>;
  regionMapping: RegionMapping[];
  droppedSettlements: { unusable: number; unknownCountry: number };
  /** Settlements whose admin1 code is not in admin1CodesASCII.txt; they carry no region. */
  settlementsWithoutRegion: number;
}

export interface BuildResult {
  settlements: Uint8Array;
  boundaries: Uint8Array;
  manifest: BuildManifest;
  report: BuildReport;
}

interface Shape {
  level: Level;
  label: string;
  id: string | null;
  name: string;
  group: string;
  country: string;
  parts: Polygon[];
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Fixed point, split at the antimeridian. Rings below 3 vertices are dropped, and a polygon whose outer ring is. */
function fixedPieces(polygons: number[][][][]): Polygon[] {
  const pieces: Polygon[] = [];
  for (const coords of polygons) {
    const rings = coords.map(toFixedRing);
    if (rings.length === 0 || rings[0]!.length < 3) continue;
    pieces.push(...splitAtAntimeridian(rings.filter((r) => r.length >= 3)));
  }
  return pieces;
}

/** Every ring of both levels, so that a border simplifies alike wherever it appears, within a level or between them. */
function readTopology(files: ReadonlyArray<Iterable<string>>): Topology {
  const topology = new Topology();
  for (const lines of files) {
    for (const line of lines) {
      const f = parseFeatureLine(line);
      if (!f) continue;
      for (const piece of fixedPieces(f.polygons)) for (const ring of piece) topology.add(ring);
    }
  }
  return topology;
}

/** fixedPieces, simplified. Rings that fall below 3 vertices are dropped, and a polygon whose outer ring does. */
function simplifiedParts(polygons: number[][][][], topology: Topology): Polygon[] {
  const parts: Polygon[] = [];
  for (const piece of fixedPieces(polygons)) {
    const simplified = piece.map((r) => topology.simplifyRing(r));
    if (simplified[0]!.length < 3) continue;
    parts.push(simplified.filter((r) => r.length >= 3));
  }
  return parts;
}

function readShapes(lines: Iterable<string>, level: Level, iso3to2: ReadonlyMap<string, string>, topology: Topology, report: BuildReport): { shapes: Shape[]; features: number } {
  const shapes: Shape[] = [];
  let features = 0;
  for (const line of lines) {
    const f = parseFeatureLine(line);
    if (!f) continue;
    features++;
    const country = iso3to2.get(f.group);
    if (country === undefined) {
      report.unmatchedGroups.push({ level, group: f.group, name: f.name, id: f.id });
      continue;
    }
    if (level === "ADM1" && f.id === null) throw new Error(`ADM1 feature "${f.name}" [${f.group}] has no shapeID`);
    const label = level === "ADM1" ? `${f.id} "${f.name}" [${f.group}]` : `${f.group} "${f.name}"`;
    const parts = simplifiedParts(f.polygons, topology);
    if (parts.length === 0) {
      report.vanishedFeatures.push({ level, label });
      continue;
    }
    shapes.push({ level, label, id: f.id, name: f.name, group: f.group, country, parts });
  }
  if (features === 0) throw new Error(`${level} boundary file has no feature lines; expected GeoJSON with one feature per line`);
  return { shapes, features };
}

/**
 * Pairs of shapes where a vertex of one lies strictly inside a polygon of the other. Points on
 * a shared edge do not count, so neighbours that share a border exactly are not reported.
 */
function findOverlaps(shapes: readonly Shape[], owner: readonly number[], prepared: readonly PreparedPolygon[], layer: PolygonLayer): Array<[number, number]> {
  const pairs = new Set<string>();
  const found: Array<[number, number]> = [];
  let p = 0;
  for (const shape of shapes) {
    for (const part of shape.parts) {
      for (const [x, y] of part[0]!) {
        const col = x >= 180 * COORD_SCALE ? GRID_COLS - 1 : cellCol(x);
        const c = cellIndex(cellRow(y), col);
        for (let k = layer.cellStart[c]!; k < layer.cellStart[c + 1]!; k++) {
          const q = layer.cellPolys[k]!;
          const a = owner[p]!;
          const b = owner[q]!;
          if (a === b) continue;
          const key = a < b ? `${a},${b}` : `${b},${a}`;
          if (pairs.has(key) || locatePoint(prepared[q]!, x, y) !== INSIDE) continue;
          pairs.add(key);
          found.push(a < b ? [a, b] : [b, a]);
        }
      }
      p++;
    }
  }
  return found.sort((u, v) => u[0] - v[0] || u[1] - v[1]);
}

export function buildIndex(inputs: BuildInputs): BuildResult {
  const report: BuildReport = {
    unmatchedGroups: [],
    vanishedFeatures: [],
    unmappedRegions: [],
    overlaps: [],
    regionMapping: [],
    droppedSettlements: { unusable: 0, unknownCountry: 0 },
    settlementsWithoutRegion: 0,
  };

  const countryInfo = parseCountryInfo(inputs.countryInfo);
  const countryNames = new Map(countryInfo.map((c) => [c.code, c.name]));
  const iso3to2 = new Map(countryInfo.map((c) => [c.iso3, c.code]));
  const regionNames = parseAdmin1Codes(inputs.admin1Codes);

  const parsed = parseCities(inputs.cities);
  report.droppedSettlements.unusable = parsed.dropped;
  const cities: City[] = parsed.cities.filter((c) => countryNames.has(c.country));
  report.droppedSettlements.unknownCountry = parsed.cities.length - cities.length;

  const topology = readTopology([inputs.adm0, inputs.adm1]);
  const adm0 = readShapes(inputs.adm0, "ADM0", iso3to2, topology, report);
  const adm1 = readShapes(inputs.adm1, "ADM1", iso3to2, topology, report);

  // Region mapping runs on the simplified polygons, the ones the resolver will test against.
  const adm1Prepared = adm1.shapes.map((s) => s.parts.map(preparePolygon));
  const regionShapes: RegionShape[] = adm1.shapes.map((s, i) => ({ id: s.id!, name: s.name, group: s.group, country: s.country, parts: adm1Prepared[i]! }));
  const adm1Countries = new Map(regionShapes.map((s) => [s.id, s.country]));
  const overrides = parseOverrides(inputs.overrides, (id) => adm1Countries.get(id));
  const mapping = mapRegions(regionShapes, cities, cityGrid(cities), regionNames, overrides);
  report.regionMapping = mapping;

  // Tables hold only what the index refers to, sorted by code.
  const regionKeys = new Set<string>();
  for (const c of cities) {
    const key = `${c.country}.${c.admin1}`;
    if (regionNames.has(key)) regionKeys.add(key);
    else report.settlementsWithoutRegion++;
  }
  for (const m of mapping) if (m.admin1 !== null) regionKeys.add(m.admin1);
  const countryCodes = new Set<string>([...cities.map((c) => c.country), ...adm0.shapes.map((s) => s.country), ...adm1.shapes.map((s) => s.country)]);
  const countries: Country[] = [...countryCodes].sort(compare).map((code) => ({ code, name: countryNames.get(code)! }));
  if (countries.length > 256) throw new Error(`${countries.length} countries do not fit the one-byte country index`);
  const countryIndex = new Map(countries.map((c, i) => [c.code, i]));
  const sortedRegionKeys = [...regionKeys].sort(compare);
  if (sortedRegionKeys.length >= NO_ADMIN1) throw new Error(`${sortedRegionKeys.length} admin1 regions do not fit the two-byte region index`);
  const admin1: Admin1[] = sortedRegionKeys.map((key) => {
    const dot = key.indexOf(".");
    return { country: countryIndex.get(key.slice(0, dot))!, code: key.slice(dot + 1), name: regionNames.get(key)! };
  });
  const regionIndex = new Map(sortedRegionKeys.map((k, i) => [k, i]));
  const mappedKeys = new Set(mapping.map((m) => m.admin1));
  for (const [code, name] of regionNames) if (!mappedKeys.has(code)) report.unmappedRegions.push({ code, name });

  const settlementRows: SettlementRow[] = cities.map((c) => ({
    lat: c.lat,
    lon: c.lon,
    country: countryIndex.get(c.country)!,
    admin1: regionIndex.get(`${c.country}.${c.admin1}`) ?? NO_ADMIN1,
    name: c.name,
  }));
  const layers = { ADM0: adm0.shapes, ADM1: adm1.shapes };
  const rowsOf = (level: Level): { rows: PolygonRow[]; owner: number[] } => {
    const rows: PolygonRow[] = [];
    const owner: number[] = [];
    layers[level].forEach((s, i) => {
      const region = level === "ADM1" ? mapping[i]!.admin1 : null;
      for (const rings of s.parts) {
        rows.push({ rings, country: countryIndex.get(s.country)!, admin1: region === null ? NO_ADMIN1 : regionIndex.get(region)! });
        owner.push(i);
      }
    });
    return { rows, owner };
  };
  const adm0Rows = rowsOf("ADM0");
  const adm1Rows = rowsOf("ADM1");
  const settlements = layoutSettlements(settlementRows);
  const adm0Layer = layoutPolygons(adm0Rows.rows);
  const adm1Layer = layoutPolygons(adm1Rows.rows);

  const adm0Prepared = adm0.shapes.flatMap((s) => s.parts.map(preparePolygon));
  for (const [level, shapes, owner, prepared, layer] of [
    ["ADM0", adm0.shapes, adm0Rows.owner, adm0Prepared, adm0Layer],
    ["ADM1", adm1.shapes, adm1Rows.owner, adm1Prepared.flat(), adm1Layer],
  ] as const) {
    for (const [a, b] of findOverlaps(shapes, owner, prepared, layer)) report.overlaps.push({ level, a: shapes[a]!.label, b: shapes[b]!.label });
  }

  const names = [...cities.map((c) => c.name), ...admin1.map((r) => r.name), ...countries.map((c) => c.name)];
  const longest = { utf16: { length: 0, name: "" }, codePoints: { length: 0, name: "" } };
  for (const name of names) {
    const cp = [...name].length;
    if (name.length > longest.utf16.length) longest.utf16 = { length: name.length, name };
    if (cp > longest.codePoints.length) longest.codePoints = { length: cp, name };
  }

  const sources = inputs.pins.map((p) => ({ name: p.name, source: p.source, version: p.version, retrieved: p.retrieved, sha256: p.sha256 }));
  const geonamesDates = sources.filter((p) => p.source === "geonames").map((p) => p.retrieved).sort(compare);
  const dataDate = geonamesDates[geonamesDates.length - 1];
  if (dataDate === undefined) throw new Error("no GeoNames pin, so the index has no data date");
  const parameters = { simplifyToleranceDeg: SIMPLIFY_TOLERANCE_DEG, regionShare: REGION_SHARE.num / REGION_SHARE.den, formatVersion: FORMAT_VERSION };
  const meta: IndexMeta = {
    buildId: "",
    dataDate,
    sources: sources.map((p) => ({ name: p.name, version: p.version, sha256: p.sha256 })),
    counts: { settlements: settlementRows.length, adm0Polygons: adm0Rows.rows.length, adm1Polygons: adm1Rows.rows.length },
    longestComponentName: { utf16: longest.utf16.length, codePoints: longest.codePoints.length },
  };
  const encode = (id: string) => ({
    settlements: encodeSettlements({ meta: { ...meta, buildId: id }, tables: { countries, admin1 }, settlements }),
    boundaries: encodeBoundaries({ buildId: id, adm0: adm0Layer, adm1: adm1Layer }),
  });
  // The id is a hash of both files as written with an empty id, so it changes whenever their content does.
  const unnamed = encode("");
  const buildId = createHash("sha256").update(unnamed.settlements).update(unnamed.boundaries).digest("hex").slice(0, 16);
  const { settlements: settlementsBytes, boundaries: boundariesBytes } = encode(buildId);

  const manifest: BuildManifest = {
    buildId,
    dataDate,
    builtAt: inputs.builtAt,
    sources,
    parameters,
    counts: {
      settlements: settlementRows.length,
      countries: countries.length,
      admin1Regions: admin1.length,
      adm0Features: adm0.features,
      adm1Features: adm1.features,
      adm0Polygons: adm0Rows.rows.length,
      adm1Polygons: adm1Rows.rows.length,
    },
    bytes: { settlements: settlementsBytes.length, boundaries: boundariesBytes.length },
    longestComponentName: longest,
    overlaps: report.overlaps.length,
    unmappedRegions: report.unmappedRegions.length,
    unmatchedBoundaryGroups: report.unmatchedGroups.length,
  };
  return { settlements: settlementsBytes, boundaries: boundariesBytes, manifest, report };
}
