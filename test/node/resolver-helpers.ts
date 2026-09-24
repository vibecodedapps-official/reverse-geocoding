import { layoutPolygons, layoutSettlements, type PolygonRow, type SettlementRow } from "../../data/lib/layout.ts";
import { encodeBoundaries, encodeSettlements, loadIndex, type GeoIndex, type SettlementArrays, type Tables } from "../../src/index/format.ts";

/** Degrees to 1e-5 degree units. */
export function e5(deg: number): number {
  return Math.round(deg * 100_000);
}

/** Rectangle ring from degrees. */
export function box(west: number, south: number, east: number, north: number): Array<[number, number]> {
  return [
    [e5(west), e5(south)],
    [e5(east), e5(south)],
    [e5(east), e5(north)],
    [e5(west), e5(north)],
  ];
}

export interface IndexInput {
  tables: Tables;
  settlements?: SettlementRow[];
  adm0?: PolygonRow[];
  adm1?: PolygonRow[];
}

/** Builds a small index through the same encode and load path the Worker uses. */
export function buildIndex(input: IndexInput): GeoIndex {
  const settlements = layoutSettlements(input.settlements ?? []);
  const meta = {
    buildId: "test",
    dataDate: "2026-09-24",
    sources: [],
    counts: { settlements: input.settlements?.length ?? 0, adm0Polygons: input.adm0?.length ?? 0, adm1Polygons: input.adm1?.length ?? 0 },
    longestComponentName: { utf16: 0, codePoints: 0 },
  };
  return loadIndex(
    encodeSettlements({ meta, tables: input.tables, settlements }).slice().buffer,
    encodeBoundaries({ buildId: "test", adm0: layoutPolygons(input.adm0 ?? []), adm1: layoutPolygons(input.adm1 ?? []) }).slice().buffer,
  );
}

const R = 6_371_008.8;
const RAD = Math.PI / 180 / 100_000;

function unit(latE5: number, lonE5: number): [number, number, number] {
  const a = latE5 * RAD;
  const b = lonE5 * RAD;
  return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)];
}

/** Distance by the vector cross and dot products, independent of the resolver's haversine. */
export function referenceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const [ax, ay, az] = unit(lat1, lon1);
  const [bx, by, bz] = unit(lat2, lon2);
  const cross = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
  return R * Math.atan2(cross, ax * bx + ay * by + az * bz);
}

/** Nearest settlement within 500 km by checking every row. */
export function bruteForceNearest(s: SettlementArrays, latE5: number, lonE5: number, country: number | null): { row: number; meters: number } | null {
  let best: { row: number; meters: number } | null = null;
  for (let i = 0; i < s.lat.length; i++) {
    if (country !== null && s.country[i] !== country) continue;
    const d = referenceMeters(latE5, lonE5, s.lat[i]!, s.lon[i]!);
    if (d <= 500_000 && (best === null || d < best.meters)) best = { row: i, meters: d };
  }
  return best;
}
