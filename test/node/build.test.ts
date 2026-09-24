import { beforeAll, describe, expect, it } from "vitest";
import { buildIndex, type BuildInputs } from "../../data/lib/build-index.ts";
import { INSIDE, locatePoint, preparePolygon, type Polygon } from "../../data/lib/geometry.ts";
import { NO_ADMIN1, settlementName, type GeoIndex, type PolygonLayer } from "../../src/index/format.ts";
import { syntheticIndex, syntheticInputs } from "../helpers/synthetic.ts";

function withOverrides(csv: string): BuildInputs {
  return { ...syntheticInputs(), overrides: csv };
}

/** Fixture lines plus extra feature lines inserted before the closing "]". */
function withFeatures(lines: Iterable<string>, extra: string[]): string[] {
  const all = [...lines];
  const close = all.lastIndexOf("]");
  return [...all.slice(0, close - 1), `${all[close - 1]},`, ...extra.map((f, i) => (i < extra.length - 1 ? `${f},` : f)), ...all.slice(close)];
}

function adm0Feature(group: string, name: string, ring: Array<[number, number]>): string {
  return JSON.stringify({ type: "Feature", properties: { shapeGroup: group, shapeType: "ADM0", shapeName: name }, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } });
}

function polygons(layer: PolygonLayer): Polygon[] {
  const out: Polygon[] = [];
  for (let p = 0; p + 1 < layer.polyRingStart.length; p++) {
    const rings: Polygon = [];
    for (let r = layer.polyRingStart[p]!; r < layer.polyRingStart[p + 1]!; r++) {
      const ring: Array<[number, number]> = [];
      for (let v = layer.ringStart[r]!; v < layer.ringStart[r + 1]!; v++) ring.push([layer.coords[2 * v]!, layer.coords[2 * v + 1]!]);
      rings.push(ring);
    }
    out.push(rings);
  }
  return out;
}

function countriesAt(index: GeoIndex, lat: number, lon: number): string[] {
  return polygons(index.adm0)
    .map((p, i) => [i, locatePoint(preparePolygon(p), Math.round(lon * 100_000), Math.round(lat * 100_000))] as const)
    .filter(([, where]) => where === INSIDE)
    .map(([i]) => index.tables.countries[index.adm0.country[i]!]!.code);
}

describe("synthetic build", () => {
  it("maps each ADM1 polygon to the region its settlements share, or to the override", () => {
    const { report } = buildIndex(syntheticInputs());

    expect(report.regionMapping.map((m) => [m.id, m.admin1, m.source])).toEqual([
      ["ARG-ADM1-SANTACRUZ", "AR.20", "derived"],
      ["CHL-ADM1-AYSEN", "CL.02", "override"],
      ["CHL-ADM1-MAGALLANES", "CL.12", "derived"],
      ["FJI-ADM1-NORTHERN", "FJ.03", "derived"],
      ["FJI-ADM1-ROTUMA", null, "override"],
      ["ITA-ADM1-EMILIAROMAGNA", "IT.05", "derived"],
      ["ITA-ADM1-TOSCANA", "IT.16", "derived"],
    ]);
  });

  it("writes the mapping into the ADM1 polygons of the index", () => {
    const index = syntheticIndex();
    const regions = Array.from(index.adm1.admin1, (a) => (a === NO_ADMIN1 ? null : index.tables.admin1[a]!.name));

    // Northern crosses the antimeridian, so it is stored as two polygons.
    expect(regions).toEqual(["Santa Cruz", "Aysén", "Magallanes", "Northern", "Northern", null, "Emilia-Romagna", "Tuscany"]);
  });

  it("lets an override replace a derived region", () => {
    const { report } = buildIndex(withOverrides("shape_id,admin1_code,reason\nCHL-ADM1-AYSEN,02,x\nFJI-ADM1-ROTUMA,,x\nITA-ADM1-TOSCANA,07,test\n"));

    expect(report.regionMapping.find((m) => m.id === "ITA-ADM1-TOSCANA")).toMatchObject({ admin1: "IT.07", source: "override" });
  });

  it("fails on a polygon no code reaches 80 percent of, naming it and its candidates", () => {
    expect(() => buildIndex(withOverrides("shape_id,admin1_code,reason\nFJI-ADM1-ROTUMA,,x\n"))).toThrow(
      'CHL-ADM1-AYSEN "Aysén del General Carlos Ibáñez del Campo" [CHL]: no code reaches 80 percent; candidates 02: 3 of 4, 12: 1 of 4',
    );
  });

  it("fails on a polygon with no settlements", () => {
    expect(() => buildIndex(withOverrides("shape_id,admin1_code,reason\nCHL-ADM1-AYSEN,02,x\n"))).toThrow('FJI-ADM1-ROTUMA "Rotuma" [FJI]: no settlements inside; candidates none');
  });

  it("fails when two polygons of one country map to the same region", () => {
    const inputs = syntheticInputs();
    const lines = [...inputs.adm1];
    const tuscany = lines.find((l) => l.includes('"ITA-ADM1-TOSCANA"'))!.replace(/,$/, "");
    const adm1 = withFeatures(lines, [tuscany.replace('"ITA-ADM1-TOSCANA"', '"ITA-ADM1-TOSCANA-2"')]);

    expect(() => buildIndex({ ...inputs, adm1 })).toThrow("ITA-ADM1-TOSCANA-2 \"Toscana\" [ITA]: code IT.16 is also mapped by ITA-ADM1-TOSCANA;");
  });

  it("reports an overlap between two polygons of one level", () => {
    const inputs = syntheticInputs();
    const adm0 = withFeatures(inputs.adm0, [adm0Feature("SMR", "Enclave", [[12.6, 43.6], [12.7, 43.6], [12.7, 43.7], [12.6, 43.7]])]);

    expect(buildIndex({ ...inputs, adm0 }).report.overlaps).toEqual([{ level: "ADM0", a: 'ITA "Italy"', b: 'SMR "Enclave"' }]);
  });

  it("reports and leaves out a boundary group with no GeoNames country", () => {
    const inputs = syntheticInputs();
    const adm0 = withFeatures(inputs.adm0, [adm0Feature("ZZZ", "Disputed area", [[30, 10], [31, 10], [31, 11]])]);
    const result = buildIndex({ ...inputs, adm0 });

    expect(result.report.unmatchedGroups).toEqual([{ level: "ADM0", group: "ZZZ", name: "Disputed area", id: null }]);
    expect(result.manifest.counts.adm0Polygons).toBe(7);
  });

  it("drops a polygon that simplification reduces below 3 vertices", () => {
    const inputs = syntheticInputs();
    const adm0 = withFeatures(inputs.adm0, [adm0Feature("ITA", "Islet", [[9.0, 43.0], [9.0005, 43.0], [9.0, 43.0005]])]);

    expect(buildIndex({ ...inputs, adm0 }).report.vanishedFeatures).toEqual([{ level: "ADM0", label: 'ITA "Islet"' }]);
  });

  it("reports GeoNames regions no polygon maps to", () => {
    const { report } = buildIndex(syntheticInputs());

    expect(report.unmappedRegions.map((r) => r.code)).toEqual(["FJ.01", "FJ.02", "FJ.04", "FJ.05", "GH.07", "IT.07", "IT.09", "SM.06", "SM.07", "SM.09"]);
  });

  it("stores names normalized to NFC with control characters and outer whitespace removed", () => {
    const index = syntheticIndex();
    const names = Array.from({ length: index.settlements.lat.length }, (_, i) => settlementName(index.settlements, i));

    // The fixture spells it decomposed, followed by a BEL character and a space.
    expect(names).toContain("Río Gallegos");
  });

  it("gives byte-identical index files for the same inputs, whatever the build time", () => {
    const a = buildIndex(syntheticInputs());
    const b = buildIndex({ ...syntheticInputs(), builtAt: "2030-01-01T12:00:00.000Z" });

    expect(Buffer.from(b.settlements).equals(Buffer.from(a.settlements))).toBe(true);
    expect(Buffer.from(b.boundaries).equals(Buffer.from(a.boundaries))).toBe(true);
    expect(b.manifest.buildId).toBe(a.manifest.buildId);
  });

  it("gives a different buildId when the index files differ, even with the same pins and overrides", () => {
    const inputs = syntheticInputs();
    const adm0 = withFeatures(inputs.adm0, [adm0Feature("ITA", "Islet", [[9.0, 43.0], [9.1, 43.0], [9.0, 43.1]])]);

    expect(buildIndex({ ...inputs, adm0 }).manifest.buildId).not.toBe(buildIndex(syntheticInputs()).manifest.buildId);
  });

  it("records the GeoNames retrieval date and the build parameters in the index", () => {
    const index = syntheticIndex();

    expect(index.meta.dataDate).toBe("2026-09-24");
    expect(index.meta.counts).toEqual({ settlements: 46, adm0Polygons: 7, adm1Polygons: 8 });
    expect(index.meta.longestComponentName).toEqual({ utf16: 22, codePoints: 22 });
  });
});

describe("antimeridian", () => {
  let index: GeoIndex;
  let layers: PolygonLayer[];
  beforeAll(() => {
    index = syntheticIndex();
    layers = [index.adm0, index.adm1];
  });

  it("leaves no stored ring edge or bounding box wrapping around longitude 180", () => {
    for (const layer of layers) {
      for (const polygon of polygons(layer)) {
        for (const ring of polygon) {
          ring.forEach(([x], i) => expect(Math.abs(ring[(i + 1) % ring.length]![0] - x)).toBeLessThanOrEqual(180_00000));
        }
      }
      for (let p = 0; p < layer.bbox.length; p += 4) {
        expect(layer.bbox[p]!).toBeGreaterThanOrEqual(-180_00000);
        expect(layer.bbox[p]!).toBeLessThanOrEqual(layer.bbox[p + 2]!);
        expect(layer.bbox[p + 2]!).toBeLessThanOrEqual(180_00000);
        // An unsplit Fiji box would span -178.5 to 177, nearly the whole globe.
        expect(layer.bbox[p + 2]! - layer.bbox[p]!).toBeLessThan(180_00000);
      }
    }
  });

  it("keeps points on both sides of 180 in Fiji inside a Fiji polygon", () => {
    expect(countriesAt(index, -16.8, 179.99)).toEqual(["FJ"]);
    expect(countriesAt(index, -16.8, -179.99)).toEqual(["FJ"]);
  });
});
