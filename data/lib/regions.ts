// Maps geoBoundaries ADM1 polygons to GeoNames admin1 regions. The two share no key, so each
// polygon takes the admin1 code of the settlements inside it, with committed hand overrides.

import { CELL_COUNT, COORD_SCALE, GRID_COLS, cellCol, cellIndex, cellRow } from "../../src/index/format.ts";
import type { City } from "./geonames.ts";
import { INSIDE, locatePoint, type PreparedPolygon } from "./geometry.ts";

/** Share of a polygon's settlements the winning code must hold, as a fraction num / den. */
export const REGION_SHARE = { num: 4, den: 5 } as const;

/** shape id to "CC.code", or null for "maps to no region". */
export type Overrides = Map<string, string | null>;

/** data/admin1-overrides.csv: header "shape_id,admin1_code,reason"; an empty admin1_code maps to no region. */
export function parseOverrides(csv: string, countryOf: (shapeId: string) => string | undefined): Overrides {
  const out: Overrides = new Map();
  const rows = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = rows.shift();
  if (header?.trim() !== "shape_id,admin1_code,reason") throw new Error('admin1 overrides: first line must be "shape_id,admin1_code,reason"');
  for (const row of rows) {
    const [id = "", code = ""] = row.split(",").map((c) => c.trim());
    if (id === "") throw new Error(`admin1 overrides: row without a shape_id: ${row}`);
    if (out.has(id)) throw new Error(`admin1 overrides: shape_id ${id} is listed twice`);
    const country = countryOf(id);
    if (country === undefined) throw new Error(`admin1 overrides: shape_id ${id} matches no ADM1 feature in the build (unknown id, a group with no GeoNames country, or no polygon left after simplification)`);
    out.set(id, code === "" ? null : `${country}.${code}`);
  }
  return out;
}

export interface RegionShape {
  id: string;
  name: string;
  group: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  parts: PreparedPolygon[];
}

export interface Candidate {
  /** GeoNames admin1 code without the country prefix; empty for settlements with none. */
  code: string;
  count: number;
}

export interface RegionMapping {
  id: string;
  name: string;
  country: string;
  /** "CC.code", or null when the polygon maps to no region. */
  admin1: string | null;
  source: "derived" | "override";
  candidates: Candidate[];
}

export interface RegionFault {
  id: string;
  name: string;
  group: string;
  reason: string;
  candidates: Candidate[];
}

export class RegionMappingError extends Error {
  readonly faults: RegionFault[];
  constructor(faults: RegionFault[]) {
    const lines = faults.map((f) => {
      const total = f.candidates.reduce((s, c) => s + c.count, 0);
      const candidates = f.candidates.length === 0 ? "none" : f.candidates.map((c) => `${c.code || "(empty)"}: ${c.count} of ${total}`).join(", ");
      return `  ${f.id} "${f.name}" [${f.group}]: ${f.reason}; candidates ${candidates}`;
    });
    super(
      `region mapping failed for ${faults.length} ADM1 polygon(s); add rows to data/admin1-overrides.csv:\n${lines.join("\n")}`,
    );
    this.name = "RegionMappingError";
    this.faults = faults;
  }
}

/** Settlement indices bucketed by grid cell. */
export function cityGrid(cities: readonly City[]): number[][] {
  const grid: number[][] = Array.from({ length: CELL_COUNT }, () => []);
  cities.forEach((c, i) => grid[cellIndex(cellRow(c.lat), cellCol(c.lon))]!.push(i));
  return grid;
}

function candidatesIn(shape: RegionShape, cities: readonly City[], grid: number[][]): Candidate[] {
  const seen = new Set<number>();
  const counts = new Map<string, number>();
  for (const part of shape.parts) {
    const r0 = cellRow(part.minY);
    const r1 = cellRow(part.maxY);
    const c0 = cellCol(part.minX);
    const c1 = part.maxX >= 180 * COORD_SCALE ? GRID_COLS - 1 : cellCol(part.maxX);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        for (const i of grid[cellIndex(row, col)]!) {
          const city = cities[i]!;
          if (city.country !== shape.country || seen.has(i)) continue;
          if (locatePoint(part, city.lon, city.lat) !== INSIDE) continue;
          seen.add(i);
          counts.set(city.admin1, (counts.get(city.admin1) ?? 0) + 1);
        }
      }
    }
  }
  return [...counts].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/**
 * Maps each shape, in order. Throws RegionMappingError listing every polygon that has no
 * settlements, has no code reaching the share, or shares its code with another polygon of
 * its country, unless an override covers it.
 */
export function mapRegions(
  shapes: readonly RegionShape[],
  cities: readonly City[],
  grid: number[][],
  regionNames: ReadonlyMap<string, string>,
  overrides: Overrides,
): RegionMapping[] {
  const faults: Array<RegionFault | null> = [];
  const mappings: RegionMapping[] = shapes.map((shape) => {
    const candidates = candidatesIn(shape, cities, grid);
    const base = { id: shape.id, name: shape.name, country: shape.country, candidates };
    const fault = (reason: string) => ({ id: shape.id, name: shape.name, group: shape.group, reason, candidates });
    if (overrides.has(shape.id)) {
      const admin1 = overrides.get(shape.id)!;
      if (admin1 !== null && !regionNames.has(admin1)) throw new Error(`admin1 overrides: ${shape.id} maps to ${admin1}, which is not in admin1CodesASCII.txt`);
      faults.push(null);
      return { ...base, admin1, source: "override" };
    }
    const total = candidates.reduce((s, c) => s + c.count, 0);
    const top = candidates[0];
    if (!top) faults.push(fault("no settlements inside"));
    else if (top.count * REGION_SHARE.den < total * REGION_SHARE.num) faults.push(fault(`no code reaches ${(REGION_SHARE.num * 100) / REGION_SHARE.den} percent`));
    else if (!regionNames.has(`${shape.country}.${top.code}`)) faults.push(fault(`code "${top.code}" is not in admin1CodesASCII.txt`));
    else {
      faults.push(null);
      return { ...base, admin1: `${shape.country}.${top.code}`, source: "derived" };
    }
    return { ...base, admin1: null, source: "derived" };
  });
  const byCode = new Map<string, number[]>();
  mappings.forEach((m, i) => {
    if (m.admin1 === null || faults[i]) return;
    byCode.set(m.admin1, [...(byCode.get(m.admin1) ?? []), i]);
  });
  for (const [code, idx] of byCode) {
    if (idx.length < 2) continue;
    for (const i of idx) {
      if (mappings[i]!.source === "override") continue;
      const others = idx.filter((j) => j !== i).map((j) => shapes[j]!.id);
      const shape = shapes[i]!;
      faults[i] = { id: shape.id, name: shape.name, group: shape.group, reason: `code ${code} is also mapped by ${others.join(", ")}`, candidates: mappings[i]!.candidates };
    }
  }
  const found = faults.filter((f): f is RegionFault => f !== null);
  if (found.length > 0) throw new RegionMappingError(found);
  return mappings;
}
