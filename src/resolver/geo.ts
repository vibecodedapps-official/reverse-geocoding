// Great-circle distances on the fixed-point coordinates, and the lower bound the nearest
// search uses to skip grid cells.

import { COORD_SCALE } from "../index/format.ts";

/** Mean Earth radius in meters. */
export const EARTH_RADIUS_M = 6_371_008.8;
const RAD_PER_E5 = Math.PI / 180 / COORD_SCALE;
const RAD_PER_DEG = Math.PI / 180;
// Absorbs floating-point error so a bound never exceeds the haversine distance it bounds.
const BOUND_SLACK_M = 0.01;

export function e5ToRad(v: number): number {
  return v * RAD_PER_E5;
}

/** Central angle between two points given in radians, by the haversine formula. */
function centralAngle(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = Math.sin((lat2 - lat1) / 2);
  const dLon = Math.sin((lon2 - lon1) / 2);
  const h = dLat * dLat + Math.cos(lat1) * Math.cos(lat2) * dLon * dLon;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Great-circle distance in meters between two points in 1e-5 degrees. */
export function distanceMeters(lat1E5: number, lon1E5: number, lat2E5: number, lon2E5: number): number {
  return EARTH_RADIUS_M * centralAngle(e5ToRad(lat1E5), e5ToRad(lon1E5), e5ToRad(lat2E5), e5ToRad(lon2E5));
}

/** Central angle from a point to the meridian segment at longitude lon between latitudes lo and hi (radians). */
function angleToMeridian(lat: number, lon: number, meridian: number, lo: number, hi: number): number {
  let best = Math.min(centralAngle(lat, lon, lo, meridian), centralAngle(lat, lon, hi, meridian));
  const dLon = lon - meridian;
  const cosDLon = Math.cos(dLon);
  // The closest point of the meridian's great circle; with cosDLon <= 0 it lies past a pole, on the other half.
  if (cosDLon > 0) {
    const foot = Math.atan2(Math.sin(lat), Math.cos(lat) * cosDLon);
    if (foot > lo && foot < hi) best = Math.min(best, Math.asin(Math.min(1, Math.cos(lat) * Math.abs(Math.sin(dLon)))));
  }
  return best;
}

/**
 * Smallest great-circle distance in meters from the query point (radians) to grid cell (row, col),
 * never more than the distance to any point in the cell. queryCol is the query point's column.
 */
export function cellLowerBoundMeters(lat: number, lon: number, queryCol: number, row: number, col: number): number {
  if (col === queryCol) return rowLowerBoundMeters(lat, row);
  const lo = (row - 90) * RAD_PER_DEG;
  const hi = (row - 89) * RAD_PER_DEG;
  const west = (col - 180) * RAD_PER_DEG;
  const angle = Math.min(angleToMeridian(lat, lon, west, lo, hi), angleToMeridian(lat, lon, west + RAD_PER_DEG, lo, hi));
  return EARTH_RADIUS_M * angle - BOUND_SLACK_M;
}

/** Smallest great-circle distance in meters from a latitude (radians) to any cell of a grid row: the latitude gap. */
export function rowLowerBoundMeters(lat: number, row: number): number {
  const lo = (row - 90) * RAD_PER_DEG;
  const hi = (row - 89) * RAD_PER_DEG;
  const angle = lat < lo ? lo - lat : lat > hi ? lat - hi : 0;
  return EARTH_RADIUS_M * angle - BOUND_SLACK_M;
}
