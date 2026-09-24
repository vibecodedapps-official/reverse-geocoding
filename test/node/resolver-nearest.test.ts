import { describe, expect, it } from "vitest";
import { layoutSettlements, type SettlementRow } from "../../data/lib/layout.ts";
import { NO_ADMIN1 } from "../../src/index/format.ts";
import { nearestSettlement } from "../../src/resolver/nearest.ts";
import { bruteForceNearest } from "./resolver-helpers.ts";

// mulberry32, so every run checks the same points.
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A point anywhere, near a pole, or near the antimeridian, in 1e-5 degrees. */
function point(random: () => number): [number, number] {
  const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  const kind = random();
  if (kind < 0.4) return [int(-90_00000, 90_00000), int(-180_00000, 180_00000)];
  if (kind < 0.7) return [random() < 0.5 ? int(85_00000, 90_00000) : int(-90_00000, -85_00000), int(-180_00000, 180_00000)];
  return [int(-90_00000, 90_00000), random() < 0.5 ? int(178_00000, 180_00000) : int(-180_00000, -178_00000)];
}

describe("nearest settlement", () => {
  it("matches a brute-force scan of every settlement", () => {
    const random = seeded(20260924);
    const rows: SettlementRow[] = [];
    for (let i = 0; i < 4000; i++) {
      const [lat, lon] = point(random);
      rows.push({ lat, lon, country: Math.floor(random() * 3), admin1: NO_ADMIN1, name: `s${i}` });
    }
    const s = layoutSettlements(rows);
    let found = 0;
    for (let q = 0; q < 2000; q++) {
      const [lat, lon] = point(random);
      const country = random() < 0.5 ? null : Math.floor(random() * 3);
      const got = nearestSettlement(s, lat, lon, country);
      const want = bruteForceNearest(s, lat, lon, country);
      expect(got?.row, `query ${lat},${lon} country ${country}`).toBe(want?.row);
      if (got !== null && want !== null) {
        expect(got.meters).toBeCloseTo(want.meters, 3);
        found++;
      }
    }
    // Guards against a change to the generator that leaves nothing within the search radius.
    expect(found).toBeGreaterThan(1000);
  });
});
