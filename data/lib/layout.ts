// Turns already-cleaned, already-split rows into the grid-indexed arrays of src/index/format.ts.
// Used by the data build and by tests that need a small hand-made index.

import {
  CELL_COUNT,
  COORD_SCALE,
  GRID_COLS,
  NO_ADMIN1,
  cellCol,
  cellIndex,
  cellRow,
  type PolygonLayer,
  type SettlementArrays,
} from "../../src/index/format.ts";

export interface SettlementRow {
  /** 1e-5 degrees. */
  lat: number;
  lon: number;
  /** Index into the countries table. */
  country: number;
  /** Index into the admin1 table, or NO_ADMIN1. */
  admin1: number;
  name: string;
}

/** Rows are sorted by cell, then by input order, so equal input gives equal output. */
export function layoutSettlements(rows: readonly SettlementRow[]): SettlementArrays {
  const cells = rows.map((r) => cellIndex(cellRow(r.lat), cellCol(r.lon)));
  const order = rows.map((_, i) => i).sort((a, b) => cells[a]! - cells[b]! || a - b);
  const n = rows.length;
  const lat = new Int32Array(n);
  const lon = new Int32Array(n);
  const country = new Uint8Array(n);
  const admin1 = new Uint16Array(n);
  const nameOffsets = new Uint32Array(n + 1);
  const encoder = new TextEncoder();
  const names = order.map((i) => encoder.encode(rows[i]!.name));
  const nameBytes = new Uint8Array(names.reduce((sum, b) => sum + b.length, 0));
  const cellStart = new Uint32Array(CELL_COUNT + 1);
  let offset = 0;
  order.forEach((src, dst) => {
    const r = rows[src]!;
    lat[dst] = r.lat;
    lon[dst] = r.lon;
    country[dst] = r.country;
    admin1[dst] = r.admin1;
    nameOffsets[dst] = offset;
    nameBytes.set(names[dst]!, offset);
    offset += names[dst]!.length;
    cellStart[cells[src]! + 1]!++;
  });
  nameOffsets[n] = offset;
  for (let c = 0; c < CELL_COUNT; c++) cellStart[c + 1]! += cellStart[c]!;
  return { lat, lon, country, admin1, nameOffsets, nameBytes, cellStart };
}

export interface PolygonRow {
  /** Outer ring first, then holes. Each ring is [lon, lat] pairs in 1e-5 degrees, not closed. No ring crosses the antimeridian. */
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  country: number;
  /** NO_ADMIN1 for ADM0 polygons and for regions mapped to nothing. */
  admin1?: number;
}

/** Polygon ids follow input order. Each polygon is listed in every cell its bounding box touches. */
export function layoutPolygons(polys: readonly PolygonRow[]): PolygonLayer {
  const p = polys.length;
  const ringCount = polys.reduce((sum, poly) => sum + poly.rings.length, 0);
  const vertexCount = polys.reduce((sum, poly) => sum + poly.rings.reduce((s, r) => s + r.length, 0), 0);
  const polyRingStart = new Uint32Array(p + 1);
  const ringStart = new Uint32Array(ringCount + 1);
  const coords = new Int32Array(vertexCount * 2);
  const bbox = new Int32Array(p * 4);
  const country = new Uint8Array(p);
  const admin1 = new Uint16Array(p);
  const perCell: number[][] = Array.from({ length: CELL_COUNT }, () => []);
  let ring = 0;
  let vertex = 0;
  polys.forEach((poly, id) => {
    polyRingStart[id] = ring;
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const r of poly.rings) {
      ringStart[ring++] = vertex;
      for (const [x, y] of r) {
        coords[vertex * 2] = x;
        coords[vertex * 2 + 1] = y;
        vertex++;
        if (x < minLon) minLon = x;
        if (x > maxLon) maxLon = x;
        if (y < minLat) minLat = y;
        if (y > maxLat) maxLat = y;
      }
    }
    bbox.set([minLon, minLat, maxLon, maxLat], id * 4);
    country[id] = poly.country;
    admin1[id] = poly.admin1 ?? NO_ADMIN1;
    // A box edge on a cell boundary also touches the next cell, so a point on that edge finds it.
    const r0 = cellRow(minLat);
    const r1 = cellRow(maxLat);
    const c0 = cellCol(minLon);
    // Longitude 180 maps to column 0 by the wrap rule, so a box ending at 180 is capped at the last column.
    const c1 = maxLon >= 180 * COORD_SCALE ? GRID_COLS - 1 : cellCol(maxLon);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) perCell[cellIndex(row, col)]!.push(id);
    }
  });
  polyRingStart[p] = ring;
  ringStart[ringCount] = vertex;
  const cellStart = new Uint32Array(CELL_COUNT + 1);
  for (let c = 0; c < CELL_COUNT; c++) cellStart[c + 1] = cellStart[c]! + perCell[c]!.length;
  const cellPolys = new Uint32Array(cellStart[CELL_COUNT]!);
  for (let c = 0; c < CELL_COUNT; c++) cellPolys.set(perCell[c]!, cellStart[c]!);
  return { polyRingStart, ringStart, coords, bbox, country, admin1, cellStart, cellPolys };
}
