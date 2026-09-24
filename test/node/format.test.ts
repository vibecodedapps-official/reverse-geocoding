import { describe, expect, it } from "vitest";
import { layoutPolygons, layoutSettlements } from "../../data/lib/layout.ts";
import {
  NO_ADMIN1,
  cellCol,
  cellRow,
  encodeBoundaries,
  encodeSettlements,
  loadIndex,
  settlementName,
  type IndexMeta,
} from "../../src/index/format.ts";

const meta: IndexMeta = {
  buildId: "b1",
  dataDate: "2026-09-24",
  sources: [],
  counts: { settlements: 2, adm0Polygons: 1, adm1Polygons: 0 },
  longestComponentName: { utf16: 8, codePoints: 8 },
};

function copy(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

describe("grid cells", () => {
  it("puts latitude 90 in the top row and -90 in the bottom row", () => {
    expect(cellRow(90_00000)).toBe(179);
    expect(cellRow(-90_00000)).toBe(0);
  });

  it("puts longitude 180 and -180 in the same column", () => {
    expect(cellCol(180_00000)).toBe(0);
    expect(cellCol(-180_00000)).toBe(0);
    expect(cellCol(179_99999)).toBe(359);
  });
});

describe("index files", () => {
  it("round-trip through encode and decode", () => {
    const settlements = layoutSettlements([
      { lat: 43_77143, lon: 11_24797, country: 0, admin1: 0, name: "Florence" },
      { lat: -33_45694, lon: -70_64827, country: 1, admin1: NO_ADMIN1, name: "Santiago" },
    ]);
    const polygons = layoutPolygons([
      {
        rings: [
          [
            [10_00000, 43_00000],
            [12_00000, 43_00000],
            [12_00000, 44_00000],
          ],
        ],
        country: 0,
      },
    ]);
    const index = loadIndex(
      copy(encodeSettlements({ meta, tables: { countries: [], admin1: [] }, settlements })),
      copy(encodeBoundaries({ buildId: "b1", adm0: polygons, adm1: layoutPolygons([]) })),
    );

    expect(index.meta.buildId).toBe("b1");
    const names = [0, 1].map((i) => settlementName(index.settlements, i));
    expect(names.sort()).toEqual(["Florence", "Santiago"]);
    expect(Array.from(index.adm0.bbox)).toEqual([10_00000, 43_00000, 12_00000, 44_00000]);
    expect(Array.from(index.adm0.coords)).toEqual([10_00000, 43_00000, 12_00000, 43_00000, 12_00000, 44_00000]);
    expect(index.adm0.admin1[0]).toBe(NO_ADMIN1);
  });

  it("reject files from different builds", () => {
    const empty = layoutPolygons([]);
    expect(() =>
      loadIndex(
        copy(encodeSettlements({ meta, tables: { countries: [], admin1: [] }, settlements: layoutSettlements([]) })),
        copy(encodeBoundaries({ buildId: "other", adm0: empty, adm1: empty })),
      ),
    ).toThrow("different builds");
  });
});
