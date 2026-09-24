// Polygon handling for the data build: fixed point conversion, antimeridian splitting,
// topology-preserving simplification, and point-in-polygon. Coordinates are integers in 1e-5 degrees.

import { COORD_SCALE } from "../../src/index/format.ts";

/** [lon, lat] in 1e-5 degrees. */
export type Point = [number, number];
/** Not closed: the last vertex is not a copy of the first. */
export type Ring = Point[];
/** Outer ring first, then holes. */
export type Polygon = Ring[];

/** Douglas-Peucker tolerance for every boundary ring, in degrees. */
export const SIMPLIFY_TOLERANCE_DEG = 0.002;

const HALF_TURN = 180 * COORD_SCALE;
const FULL_TURN = 360 * COORD_SCALE;
const QUARTER_TURN = 90 * COORD_SCALE;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Drops consecutive duplicates and a closing vertex equal to the first. */
function dedupe(ring: Ring): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  while (out.length > 1 && out[0]![0] === out[out.length - 1]![0] && out[0]![1] === out[out.length - 1]![1]) out.pop();
  return out;
}

/** A GeoJSON ring in degrees to an unclosed fixed point ring. */
export function toFixedRing(coords: ReadonlyArray<ReadonlyArray<number>>): Ring {
  const ring: Ring = [];
  for (const c of coords) {
    const lon = c[0];
    const lat = c[1];
    if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error("boundary coordinate is not a pair of finite numbers");
    }
    ring.push([clamp(Math.round(lon * COORD_SCALE), -HALF_TURN, HALF_TURN), clamp(Math.round(lat * COORD_SCALE), -QUARTER_TURN, QUARTER_TURN)]);
  }
  return dedupe(ring);
}

// An edge whose ends both sit on +-180 runs along the antimeridian (as at a pole), so it is not a crossing.
function isCrossing(a: Point, b: Point): boolean {
  return Math.abs(b[0] - a[0]) > HALF_TURN && !(Math.abs(a[0]) === HALF_TURN && Math.abs(b[0]) === HALF_TURN);
}

function crossesAntimeridian(ring: Ring): boolean {
  return ring.some((p, i) => isCrossing(p, ring[(i + 1) % ring.length]!));
}

/** Makes longitudes continuous across crossing edges, so the ring may extend past +-180. */
function unwrap(ring: Ring): Ring {
  const out: Ring = [];
  let shift = 0;
  ring.forEach((p, i) => {
    if (i > 0 && isCrossing(ring[i - 1]!, p)) shift += p[0] < ring[i - 1]![0] ? FULL_TURN : -FULL_TURN;
    out.push([p[0] + shift, p[1]]);
  });
  // A ring around a pole does not close after unwrapping; close it along the pole instead.
  const first = out[0]!;
  const last = out[out.length - 1]!;
  if (Math.abs(last[0] - first[0]) > HALF_TURN) {
    const meanLat = out.reduce((s, p) => s + p[1], 0) / out.length;
    const pole = meanLat < 0 ? -QUARTER_TURN : QUARTER_TURN;
    out.push([last[0], pole], [first[0], pole]);
  }
  return out;
}

function shiftRing(ring: Ring, dx: number): Ring {
  return dx === 0 ? ring : ring.map(([x, y]) => [x + dx, y] as Point);
}

/** Sutherland-Hodgman against the vertical line x = HALF_TURN, keeping the west (x <= line) or east side. */
function clipAtAntimeridian(ring: Ring, keepWest: boolean): Ring {
  const inside = (p: Point) => (keepWest ? p[0] <= HALF_TURN : p[0] >= HALF_TURN);
  const out: Ring = [];
  ring.forEach((cur, i) => {
    const prev = ring[(i + ring.length - 1) % ring.length]!;
    const curIn = inside(cur);
    if (curIn !== inside(prev) && prev[0] !== HALF_TURN && cur[0] !== HALF_TURN) {
      const t = (HALF_TURN - prev[0]) / (cur[0] - prev[0]);
      out.push([HALF_TURN, Math.round(prev[1] + t * (cur[1] - prev[1]))]);
    }
    if (curIn) out.push(cur);
  });
  return dedupe(out);
}

/**
 * Splits a polygon whose rings cross the antimeridian into pieces that each lie within
 * -180..180, so no ring or bounding box wraps. A polygon that does not cross is returned as is.
 */
export function splitAtAntimeridian(polygon: Polygon): Polygon[] {
  if (!polygon.some(crossesAntimeridian)) return [polygon];
  let rings = polygon.map((r) => (crossesAntimeridian(r) ? unwrap(r) : r));
  const outer = rings[0]!;
  // A loop, not Math.min(...), which overflows the argument limit on large rings.
  let outerMin = Infinity;
  let outerMax = -Infinity;
  for (const [x] of outer) {
    if (x < outerMin) outerMin = x;
    if (x > outerMax) outerMax = x;
  }
  const outerShift = outerMin < -HALF_TURN ? FULL_TURN : 0;
  const center = (outerMin + outerMax) / 2 + outerShift;
  // Each hole moves by the whole turn that brings it nearest the outer ring.
  rings = rings.map((r, i) => {
    if (i === 0) return shiftRing(r, outerShift);
    const k = Math.round((center - r[0]![0]) / FULL_TURN);
    return shiftRing(r, k * FULL_TURN);
  });
  const pieces: Polygon[] = [];
  for (const keepWest of [true, false]) {
    const clipped = rings.map((r) => clipAtAntimeridian(r, keepWest));
    if (clipped[0]!.length < 3) continue;
    const kept = clipped.filter((r) => r.length >= 3).map((r) => (keepWest ? r : shiftRing(r, -FULL_TURN)));
    pieces.push(kept);
  }
  return pieces;
}

function segmentDistanceSq(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  let t = len === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len;
  t = clamp(t, 0, 1);
  const ex = a[0] + t * dx - p[0];
  const ey = a[1] + t * dy - p[1];
  return ex * ex + ey * ey;
}

/** One integer per point, below 2^53, ordered by longitude and then latitude. */
function pointKey(p: Point): number {
  return (p[0] + HALF_TURN) * (2 * QUARTER_TURN + 1) + (p[1] + QUARTER_TURN);
}

const EMPTY = 0xffffffff;
const NO_X = 0x7fffffff;

/**
 * Where rings that share a path part ways, found over every ring of the build. A point is a
 * junction when two of its occurrences, in one ring or two, have different pairs of neighbours.
 * Between two junctions every ring through a point follows the same path, so simplifying each
 * path between junctions the same way in every ring leaves neighbours with identical borders.
 *
 * Points live in an open addressing hash table over typed arrays: a build has over ten million
 * distinct points, near the 2^24 entry limit of a Map. Neighbours are stored as slots of that table.
 */
export class Topology {
  private xs = new Int32Array(1 << 16).fill(NO_X);
  private ys = new Int32Array(1 << 16);
  /** The neighbour pair of the first occurrence, smaller slot first. */
  private lo = new Uint32Array(1 << 16).fill(EMPTY);
  private hi = new Uint32Array(1 << 16).fill(EMPTY);
  private junction = new Uint8Array(1 << 16);
  private size = 0;

  private slot(x: number, y: number): number {
    const mask = this.xs.length - 1;
    let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77);
    h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35);
    for (let i = (h ^ (h >>> 13)) & mask; ; i = (i + 1) & mask) {
      if (this.xs[i] === NO_X || (this.xs[i] === x && this.ys[i] === y)) return i;
    }
  }

  private insert(p: Point): void {
    const s = this.slot(p[0], p[1]);
    if (this.xs[s] !== NO_X) return;
    this.xs[s] = p[0];
    this.ys[s] = p[1];
    if (++this.size * 4 > this.xs.length * 3) this.grow();
  }

  private grow(): void {
    const { xs, ys, lo, hi, junction } = this;
    const cap = xs.length * 2;
    this.xs = new Int32Array(cap).fill(NO_X);
    this.ys = new Int32Array(cap);
    this.lo = new Uint32Array(cap).fill(EMPTY);
    this.hi = new Uint32Array(cap).fill(EMPTY);
    this.junction = new Uint8Array(cap);
    const moved = new Uint32Array(xs.length);
    for (let i = 0; i < xs.length; i++) {
      if (xs[i] === NO_X) continue;
      const s = this.slot(xs[i]!, ys[i]!);
      this.xs[s] = xs[i]!;
      this.ys[s] = ys[i]!;
      this.junction[s] = junction[i]!;
      moved[i] = s;
    }
    for (let i = 0; i < xs.length; i++) {
      if (xs[i] === NO_X || lo[i] === EMPTY) continue;
      const a = moved[lo[i]!]!;
      const b = moved[hi[i]!]!;
      this.lo[moved[i]!] = Math.min(a, b);
      this.hi[moved[i]!] = Math.max(a, b);
    }
  }

  /** Records a ring. Add every ring of the build before simplifying any. */
  add(ring: Ring): void {
    const n = ring.length;
    for (const p of ring) this.insert(p);
    const slots = ring.map((p) => this.slot(p[0], p[1]));
    for (let i = 0; i < n; i++) {
      const s = slots[i]!;
      const a = slots[(i + n - 1) % n]!;
      const b = slots[(i + 1) % n]!;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (this.lo[s] === EMPTY) {
        this.lo[s] = lo;
        this.hi[s] = hi;
      } else if (this.lo[s] !== lo || this.hi[s] !== hi) {
        this.junction[s] = 1;
      }
    }
  }

  private isJunction(p: Point): boolean {
    const s = this.slot(p[0], p[1]);
    return this.xs[s] !== NO_X && this.junction[s] === 1;
  }

  /**
   * Douglas-Peucker on each path between junctions of the ring, with the junctions kept, so
   * every ring through a path simplifies it the same way. A ring with no junction is cut at its
   * lowest point by pointKey and the point farthest from it. The result can have fewer than 3
   * vertices; the caller drops such rings.
   */
  simplifyRing(ring: Ring, toleranceDeg = SIMPLIFY_TOLERANCE_DEG): Ring {
    const n = ring.length;
    if (n < 3) return ring;
    const cuts: number[] = [];
    for (let i = 0; i < n; i++) if (this.isJunction(ring[i]!)) cuts.push(i);
    if (cuts.length === 0) {
      let low = 0;
      for (let i = 1; i < n; i++) if (pointKey(ring[i]!) < pointKey(ring[low]!)) low = i;
      let far = -1;
      let farDist = -1;
      for (let i = 0; i < n; i++) {
        const d = (ring[i]![0] - ring[low]![0]) ** 2 + (ring[i]![1] - ring[low]![1]) ** 2;
        if (d > farDist || (d === farDist && pointKey(ring[i]!) < pointKey(ring[far]!))) {
          farDist = d;
          far = i;
        }
      }
      cuts.push(Math.min(low, far), Math.max(low, far));
    }
    const keep = new Uint8Array(n);
    const tolSq = (toleranceDeg * COORD_SCALE) ** 2;
    cuts.forEach((from, c) => {
      const to = c + 1 < cuts.length ? cuts[c + 1]! : cuts[0]! + n;
      const path: Point[] = [];
      const at: number[] = [];
      for (let i = from; i <= to; i++) {
        path.push(ring[i % n]!);
        at.push(i % n);
      }
      if (!runsForward(path)) {
        path.reverse();
        at.reverse();
      }
      douglasPeucker(path, tolSq).forEach((kept, i) => {
        if (kept) keep[at[i]!] = 1;
      });
    });
    return ring.filter((_, i) => keep[i] === 1);
  }
}

/** Whether a path is in its canonical direction: the one whose sequence of pointKeys is smaller. */
function runsForward(path: readonly Point[]): boolean {
  for (let i = 0, j = path.length - 1; i < j; i++, j--) {
    const a = pointKey(path[i]!);
    const b = pointKey(path[j]!);
    if (a !== b) return a < b;
  }
  return true;
}

/** Douglas-Peucker on an open path with both ends kept. Among equally distant points the first wins. */
function douglasPeucker(path: readonly Point[], tolSq: number): Uint8Array {
  const last = path.length - 1;
  const keep = new Uint8Array(path.length);
  keep[0] = 1;
  keep[last] = 1;
  const stack: Array<[number, number]> = [[0, last]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    let best = -1;
    let bestDist = tolSq;
    for (let i = s + 1; i < e; i++) {
      const d = segmentDistanceSq(path[i]!, path[s]!, path[e]!);
      if (d > bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best !== -1) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  return keep;
}

/** A polygon with its edges bucketed by latitude band, for repeated point tests. */
export interface PreparedPolygon {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** x1, y1, x2, y2 per edge. */
  edges: Int32Array;
  bandHeight: number;
  /** Edges of band b are bandEdges[bandStart[b] .. bandStart[b + 1] - 1]. */
  bandStart: Uint32Array;
  bandEdges: Uint32Array;
}

export function preparePolygon(polygon: Polygon): PreparedPolygon {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const edgeCount = polygon.reduce((s, r) => s + r.length, 0);
  const edges = new Int32Array(edgeCount * 4);
  let e = 0;
  for (const ring of polygon) {
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length]!;
      edges.set([a[0], a[1], b[0], b[1]], e * 4);
      e++;
      if (a[0] < minX) minX = a[0];
      if (a[0] > maxX) maxX = a[0];
      if (a[1] < minY) minY = a[1];
      if (a[1] > maxY) maxY = a[1];
    });
  }
  const bands = Math.max(1, Math.min(4096, Math.ceil(edgeCount / 8)));
  const bandHeight = Math.max(1, Math.ceil((maxY - minY + 1) / bands));
  const band = (y: number) => Math.min(bands - 1, Math.floor((y - minY) / bandHeight));
  const bandStart = new Uint32Array(bands + 1);
  for (let i = 0; i < edgeCount; i++) {
    const y1 = edges[i * 4 + 1]!;
    const y2 = edges[i * 4 + 3]!;
    for (let b = band(Math.min(y1, y2)); b <= band(Math.max(y1, y2)); b++) bandStart[b + 1]!++;
  }
  for (let b = 0; b < bands; b++) bandStart[b + 1]! += bandStart[b]!;
  const fill = bandStart.slice(0, bands);
  const bandEdges = new Uint32Array(bandStart[bands]!);
  for (let i = 0; i < edgeCount; i++) {
    const y1 = edges[i * 4 + 1]!;
    const y2 = edges[i * 4 + 3]!;
    for (let b = band(Math.min(y1, y2)); b <= band(Math.max(y1, y2)); b++) bandEdges[fill[b]!++] = i;
  }
  return { minX, minY, maxX, maxY, edges, bandHeight, bandStart, bandEdges };
}

export const OUTSIDE = -1;
export const ON_BOUNDARY = 0;
export const INSIDE = 1;

/**
 * Ray casting eastward with the half-open rule: an edge is crossed when one end is strictly
 * above the ray and the other is on or below it. Holes count like any other ring.
 */
export function locatePoint(p: PreparedPolygon, x: number, y: number): -1 | 0 | 1 {
  if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) return OUTSIDE;
  const bands = p.bandStart.length - 1;
  const b = Math.min(bands - 1, Math.floor((y - p.minY) / p.bandHeight));
  const e = p.edges;
  let inside = false;
  for (let k = p.bandStart[b]!; k < p.bandStart[b + 1]!; k++) {
    const i = p.bandEdges[k]! * 4;
    const x1 = e[i]!;
    const y1 = e[i + 1]!;
    const x2 = e[i + 2]!;
    const y2 = e[i + 3]!;
    // Twice the signed area of (edge start, edge end, point); exact in doubles at these magnitudes.
    const cross = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
    if (
      cross === 0 &&
      x >= Math.min(x1, x2) &&
      x <= Math.max(x1, x2) &&
      y >= Math.min(y1, y2) &&
      y <= Math.max(y1, y2)
    ) {
      return ON_BOUNDARY;
    }
    if (y1 > y !== y2 > y && (y2 > y1 ? cross > 0 : cross < 0)) inside = !inside;
  }
  return inside ? INSIDE : OUTSIDE;
}
