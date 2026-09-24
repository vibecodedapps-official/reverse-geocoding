import { describe, expect, it } from "vitest";
import { NO_ADMIN1, type PolygonLayer } from "../../src/index/format.ts";
import type { Level } from "../../src/resolver/api.ts";
import { nearestSettlement } from "../../src/resolver/nearest.ts";
import { containingPolygon, polygonContains } from "../../src/resolver/pip.ts";
import { resolve } from "../../src/resolver/resolve.ts";
import { bruteForceNearest, e5 } from "../node/resolver-helpers.ts";
import { loadBuiltIndex, readFixture } from "./built-index.ts";

interface Point {
  name: string;
  latitude: number;
  longitude: number;
}

interface Edges {
  antimeridian_pairs: Array<{ name: string; latitude: number }>;
  nearest: Array<Point & { nearest_west_of_180?: boolean }>;
  internal_border: Array<Point & { nearest_settlement_admin1: string; expected: { country_code: string; admin1: string; level: Level } }>;
  shared_edge: Array<Point & { admin1_one_of: string[] }>;
}

const index = loadBuiltIndex();
const edges = readFixture<Edges>("edges.json");

/** Midpoints of edges that two polygons of the same country share, where the midpoint is exact in 1e-5 degrees. */
function sharedEdgeMidpoints(layer: PolygonLayer, limit: number): Array<{ a: number; b: number; lat: number; lon: number }> {
  const owner = new Map<string, number>();
  const found: Array<{ a: number; b: number; lat: number; lon: number }> = [];
  const polygons = layer.polyRingStart.length - 1;
  for (let p = 0; p < polygons && found.length < limit; p++) {
    for (let r = layer.polyRingStart[p]!; r < layer.polyRingStart[p + 1]! && found.length < limit; r++) {
      const first = layer.ringStart[r]!;
      const last = layer.ringStart[r + 1]! - 1;
      for (let i = first, j = last; i <= last && found.length < limit; j = i++) {
        const x1 = layer.coords[2 * j]!;
        const y1 = layer.coords[2 * j + 1]!;
        const x2 = layer.coords[2 * i]!;
        const y2 = layer.coords[2 * i + 1]!;
        if ((x1 + x2) % 2 !== 0 || (y1 + y2) % 2 !== 0 || (x1 === x2 && y1 === y2)) continue;
        const key = x1 < x2 || (x1 === x2 && y1 < y2) ? `${x1},${y1},${x2},${y2}` : `${x2},${y2},${x1},${y1}`;
        const other = owner.get(key);
        if (other === undefined) owner.set(key, p);
        else if (other !== p && layer.country[other] === layer.country[p]) found.push({ a: other, b: p, lat: (y1 + y2) / 2, lon: (x1 + x2) / 2 });
      }
    }
  }
  return found;
}

describe("antimeridian", () => {
  it.each(edges.antimeridian_pairs.map((p) => [p.name, p] as const))("%s resolves the same at 180 and -180", (_, p) => {
    expect(resolve(index, e5(p.latitude), e5(180))).toEqual(resolve(index, e5(p.latitude), e5(-180)));
  });
});

describe("nearest settlement", () => {
  it.each(edges.nearest.map((p) => [p.name, p] as const))("%s matches a brute-force scan", (_, p) => {
    const lat = e5(p.latitude);
    const lon = e5(p.longitude);
    const adm0 = containingPolygon(index.adm0, lat, lon, null);
    const filters = adm0 >= 0 ? [null, index.adm0.country[adm0]!] : [null];
    for (const country of filters) {
      expect(nearestSettlement(index.settlements, lat, lon, country)?.row).toBe(bruteForceNearest(index.settlements, lat, lon, country)?.row);
    }
    if (p.nearest_west_of_180) {
      const near = nearestSettlement(index.settlements, lat, lon, null);
      expect(near).not.toBeNull();
      expect(index.settlements.lon[near!.row]!).toBeGreaterThan(e5(179));
    }
  });
});

describe("internal border", () => {
  it.each(edges.internal_border.map((p) => [p.name, p] as const))("%s keeps its own region", (_, p) => {
    const lat = e5(p.latitude);
    const lon = e5(p.longitude);
    const r = resolve(index, lat, lon);
    expect(r).toMatchObject({ status: "ok", level: p.expected.level, components: { country_code: p.expected.country_code, admin1: p.expected.admin1 } });
    const adm0 = containingPolygon(index.adm0, lat, lon, null);
    const near = nearestSettlement(index.settlements, lat, lon, index.adm0.country[adm0]!);
    const admin1 = index.settlements.admin1[near!.row]!;
    expect(admin1 === NO_ADMIN1 ? null : index.tables.admin1[admin1]!.name).toBe(p.nearest_settlement_admin1);
  });
});

describe("shared edges", () => {
  it.each(edges.shared_edge.map((p) => [p.name, p] as const))("%s resolves to one region, the same every time", (_, p) => {
    const first = resolve(index, e5(p.latitude), e5(p.longitude));
    expect(resolve(index, e5(p.latitude), e5(p.longitude))).toEqual(first);
    expect(first.status).toBe("ok");
    if (first.status === "ok") expect(p.admin1_one_of).toContain(first.components.admin1);
  });

  it("puts the midpoint of every sampled shared region edge in exactly one of the two regions", () => {
    const samples = sharedEdgeMidpoints(index.adm1, 50);
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) {
      const inA = polygonContains(index.adm1, s.a, s.lat, s.lon);
      const inB = polygonContains(index.adm1, s.b, s.lat, s.lon);
      expect(inA !== inB, `edge midpoint ${s.lat},${s.lon} of regions ${s.a} and ${s.b}`).toBe(true);
      expect(resolve(index, s.lat, s.lon)).toEqual(resolve(index, s.lat, s.lon));
    }
  });
});
