import { GRID_COLS, GRID_ROWS, cellCol, cellIndex, cellRow, type SettlementArrays } from "../index/format.ts";
import { SEARCH_RADIUS_KM } from "./api.ts";
import { cellLowerBoundMeters, distanceMeters, e5ToRad, rowLowerBoundMeters } from "./geo.ts";

const RADIUS_M = SEARCH_RADIUS_KM * 1000;

export interface Nearest {
  /** Settlement row. */
  row: number;
  /** Unrounded great-circle distance. */
  meters: number;
}

function wrapCol(col: number): number {
  return ((col % GRID_COLS) + GRID_COLS) % GRID_COLS;
}

/**
 * Nearest settlement within the search radius, optionally only settlements of one country
 * (an index into the countries table). Equal distances go to the lower row. Null when none.
 *
 * Visits rings of cells around the query cell: ring r holds the cells whose larger of row offset and
 * wrapped column offset is r. A cell is scanned only if its lower bound is within the best distance so
 * far, and the search stops after a ring with no such cell, since every path to a farther cell
 * crosses that ring or passes through a pole, which cells of that ring also touch.
 */
export function nearestSettlement(s: SettlementArrays, latE5: number, lonE5: number, country: number | null): Nearest | null {
  const lat = e5ToRad(latE5);
  const lon = e5ToRad(lonE5);
  const row0 = cellRow(latE5);
  const col0 = cellCol(lonE5);
  let bestRow = -1;
  let best = Infinity;

  const visit = (row: number, col: number): boolean => {
    if (cellLowerBoundMeters(lat, lon, col0, row, col) > Math.min(best, RADIUS_M)) return false;
    const cell = cellIndex(row, col);
    const end = s.cellStart[cell + 1]!;
    for (let i = s.cellStart[cell]!; i < end; i++) {
      if (country !== null && s.country[i] !== country) continue;
      const d = distanceMeters(latE5, lonE5, s.lat[i]!, s.lon[i]!);
      if (d <= RADIUS_M && (d < best || (d === best && i < bestRow))) {
        best = d;
        bestRow = i;
      }
    }
    return true;
  };

  // Rows whose latitude gap alone exceeds the limit are skipped whole, which keeps queries near a pole cheap.
  const rowInReach = (row: number): boolean => row >= 0 && row < GRID_ROWS && rowLowerBoundMeters(lat, row) <= Math.min(best, RADIUS_M);

  const half = GRID_COLS / 2;
  for (let r = 0; r <= half; r++) {
    let reached = false;
    if (r < half) {
      const rows = r === 0 ? [row0] : [row0 - r, row0 + r];
      for (const row of rows) {
        if (!rowInReach(row)) continue;
        for (let dc = -r; dc <= r; dc++) reached = visit(row, wrapCol(col0 + dc)) || reached;
      }
      for (let row = row0 - r + 1; row <= row0 + r - 1; row++) {
        if (!rowInReach(row)) continue;
        reached = visit(row, wrapCol(col0 - r)) || reached;
        reached = visit(row, wrapCol(col0 + r)) || reached;
      }
    } else {
      // The antipodal column is the only one left, in every row.
      for (let row = 0; row < GRID_ROWS; row++) if (rowInReach(row)) reached = visit(row, wrapCol(col0 + half)) || reached;
    }
    if (!reached) break;
  }
  return bestRow < 0 ? null : { row: bestRow, meters: best };
}
