import { describe, expect, it } from "vitest";
import { INSIDE, OUTSIDE, Topology, locatePoint, preparePolygon, splitAtAntimeridian, type Point, type Polygon, type Ring } from "../../data/lib/geometry.ts";

/** Simplifies every ring of the polygons against one topology holding all of them. */
function simplifyAll(polygons: Polygon[]): Polygon[] {
  const topology = new Topology();
  for (const polygon of polygons) for (const ring of polygon) topology.add(ring);
  return polygons.map((polygon) => polygon.map((ring) => topology.simplifyRing(ring)));
}

/** Probes on a 0.0005 degree grid offset from every vertex: how many lie outside every polygon, and how many inside two. */
function probe(polygons: Polygon[], x0: number, x1: number, y0: number, y1: number): { inNone: number; inTwo: number } {
  const prepared = polygons.map(preparePolygon);
  let inNone = 0;
  let inTwo = 0;
  for (let x = x0 + 25; x < x1; x += 50) {
    for (let y = y0 + 25; y < y1; y += 50) {
      const where = prepared.map((p) => locatePoint(p, x, y));
      if (where.every((w) => w === OUTSIDE)) inNone++;
      if (where.filter((w) => w === INSIDE).length > 1) inTwo++;
    }
  }
  return { inNone, inTwo };
}

/** Offsets of up to 0.0015 degrees, near the tolerance, so simplification keeps some wiggles and drops others. */
function wiggle(k: number): number {
  return (((k * 37) % 7) - 3) * 50;
}

describe("Topology.simplifyRing", () => {
  it("drops a vertex on a straight edge and keeps the corners", () => {
    const square: Ring = [
      [0, 0],
      [1_00000, 0],
      [2_00000, 0],
      [2_00000, 2_00000],
      [0, 2_00000],
    ];
    const topology = new Topology();
    topology.add(square);

    expect(topology.simplifyRing(square, 0.01)).toEqual([
      [0, 0],
      [2_00000, 0],
      [2_00000, 2_00000],
      [0, 2_00000],
    ]);
  });

  it("simplifies a border two polygons share the same way in both, leaving no gap or overlap", () => {
    // A 1 degree square split by a wiggly north-south border; the east ring runs the border the other way and starts partway along it.
    const border: Point[] = Array.from({ length: 101 }, (_, k) => [50000 + (k === 0 || k === 100 ? 0 : wiggle(k)), k * 1000]);
    const west: Ring = [[0, 0], ...border, [0, 1_00000]];
    const eastFromSouth: Ring = [[1_00000, 0], [1_00000, 1_00000], ...[...border].reverse()];
    const east: Ring = [...eastFromSouth.slice(40), ...eastFromSouth.slice(0, 40)];

    expect(probe(simplifyAll([[west], [east]]), 0, 1_00000, 0, 1_00000)).toEqual({ inNone: 0, inTwo: 0 });
  });

  it("simplifies an enclave the same way as the hole it fills", () => {
    const hole: Ring = Array.from({ length: 90 }, (_, k) => {
      const r = 20000 + wiggle(k);
      return [Math.round(50000 + r * Math.cos((k * Math.PI) / 45)), Math.round(50000 + r * Math.sin((k * Math.PI) / 45))];
    });
    const outer: Ring = [[0, 0], [1_00000, 0], [1_00000, 1_00000], [0, 1_00000]];
    const enclave: Ring = [...hole.slice(30), ...hole.slice(0, 30)].reverse();

    expect(probe(simplifyAll([[outer, hole], [enclave]]), 0, 1_00000, 0, 1_00000)).toEqual({ inNone: 0, inTwo: 0 });
  });
});

describe("splitAtAntimeridian", () => {
  it("cuts a polygon crossing 180 into a west piece ending at 180 and an east piece starting at -180", () => {
    const pieces = splitAtAntimeridian([
      [
        [179_00000, -16_00000],
        [-179_00000, -16_00000],
        [-179_00000, -17_00000],
        [179_00000, -17_00000],
      ],
    ]);

    expect(pieces).toEqual([
      [
        [
          [179_00000, -16_00000],
          [180_00000, -16_00000],
          [180_00000, -17_00000],
          [179_00000, -17_00000],
        ],
      ],
      [
        [
          [-180_00000, -16_00000],
          [-179_00000, -16_00000],
          [-179_00000, -17_00000],
          [-180_00000, -17_00000],
        ],
      ],
    ]);
  });
});
