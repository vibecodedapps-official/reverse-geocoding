import { cellCol, cellIndex, cellRow, type PolygonLayer } from "../index/format.ts";

/**
 * Even-odd ray casting over every ring of polygon p, holes included, with a ray pointing east.
 * An edge is crossed only when one end is strictly above the ray and the other on or below it,
 * and the side test is exact integer arithmetic, so a point on an edge shared by two polygons
 * lies in exactly one of them.
 */
export function polygonContains(layer: PolygonLayer, p: number, latE5: number, lonE5: number): boolean {
  const { coords, ringStart, polyRingStart } = layer;
  let inside = false;
  const ringEnd = polyRingStart[p + 1]!;
  for (let r = polyRingStart[p]!; r < ringEnd; r++) {
    const first = ringStart[r]!;
    const last = ringStart[r + 1]! - 1;
    for (let i = first, j = last; i <= last; j = i++) {
      const xi = coords[2 * i]!;
      const yi = coords[2 * i + 1]!;
      const xj = coords[2 * j]!;
      const yj = coords[2 * j + 1]!;
      if (yi > latE5 === yj > latE5) continue;
      // Products stay below 2^53, so this is exact.
      const cross = (xj - xi) * (latE5 - yi) - (lonE5 - xi) * (yj - yi);
      if (yj > yi ? cross > 0 : cross < 0) inside = !inside;
    }
  }
  return inside;
}

/** Lowest polygon id containing the point, among polygons of the given country if one is given; -1 if none. */
export function containingPolygon(layer: PolygonLayer, latE5: number, lonE5: number, country: number | null): number {
  const cell = cellIndex(cellRow(latE5), cellCol(lonE5));
  const end = layer.cellStart[cell + 1]!;
  for (let k = layer.cellStart[cell]!; k < end; k++) {
    const p = layer.cellPolys[k]!;
    if (country !== null && layer.country[p] !== country) continue;
    const b = 4 * p;
    if (lonE5 < layer.bbox[b]! || latE5 < layer.bbox[b + 1]! || lonE5 > layer.bbox[b + 2]! || latE5 > layer.bbox[b + 3]!) continue;
    if (polygonContains(layer, p, latE5, lonE5)) return p;
  }
  return -1;
}
