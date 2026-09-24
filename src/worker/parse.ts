// Validates and truncates a lookup body. Nothing here puts a request value into a message or a
// thrown error, and the parsed body never leaves parseQuery.

import { COORD_SCALE } from "../index/format.ts";

export type ParseErrorCode = "invalid_request" | "invalid_coordinate" | "precision_too_high" | "unexpected_field";

export interface ParseError {
  code: ParseErrorCode;
  message: string;
  field?: string;
}

export interface Query {
  /** Truncated latitude in 1e-5 degrees. */
  latE5: number;
  /** Truncated longitude in 1e-5 degrees. */
  lonE5: number;
  precision: number;
  maxLabelLength: number;
}

export type ParseResult = { ok: true; query: Query } | { ok: false; error: ParseError };

const ALLOWED = ["latitude", "longitude", "precision", "max_label_length"];
const DEFAULT_PRECISION = 3;
const MAX_PRECISION = 4;
const DEFAULT_MAX_LABEL_LENGTH = 120;
const MIN_LABEL_LENGTH = 8;
const MAX_LABEL_LENGTH = 200;

function fail(code: ParseErrorCode, message: string, field?: string): ParseResult {
  return { ok: false, error: field === undefined ? { code, message } : { code, message, field } };
}

/**
 * n truncated toward zero to `precision` decimals, in 1e-5 degrees. Works on the shortest
 * decimal representation, so 0.29 at precision 2 is 29000 and not 28999 as float scaling gives.
 */
export function truncateE5(n: number, precision: number): number {
  const s = String(Math.abs(n));
  const [mantissa = "", exponent = "0"] = s.split("e");
  const dot = mantissa.indexOf(".");
  const digits = mantissa.replace(".", "");
  const point = (dot === -1 ? mantissa.length : dot) + Number(exponent);
  const whole = point > 0 ? digits.slice(0, point).padEnd(point, "0") : "0";
  const fraction = point >= 0 ? digits.slice(point) : "0".repeat(-point) + digits;
  const kept = fraction.slice(0, precision).padEnd(5, "0");
  const value = Number(whole) * COORD_SCALE + Number(kept);
  return n < 0 && value !== 0 ? -value : value;
}

function coordinate(body: Record<string, unknown>, field: "latitude" | "longitude", limit: number): ParseError | number {
  const v = body[field];
  if (v === undefined) return { code: "invalid_request", message: `Missing required field "${field}".`, field };
  if (typeof v !== "number") return { code: "invalid_request", message: `Field "${field}" must be a number.`, field };
  const range = `Field "${field}" must be a finite number from -${limit} to ${limit} inclusive.`;
  if (!Number.isFinite(v) || v < -limit || v > limit) return { code: "invalid_coordinate", message: range, field };
  return v;
}

function integer(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

export function parseQuery(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // The SyntaxError message quotes the input.
    return fail("invalid_request", "The body is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return fail("invalid_request", "The body must be a JSON object.");
  }
  const body = parsed as Record<string, unknown>;

  for (const name of Object.keys(body)) {
    if (!ALLOWED.includes(name)) {
      return fail("unexpected_field", `Unexpected field "${name}". Allowed fields: ${ALLOWED.join(", ")}.`, name);
    }
  }

  const lat = coordinate(body, "latitude", 90);
  if (typeof lat !== "number") return { ok: false, error: lat };
  const lon = coordinate(body, "longitude", 180);
  if (typeof lon !== "number") return { ok: false, error: lon };

  let precision = DEFAULT_PRECISION;
  if (Object.hasOwn(body, "precision")) {
    const p = body.precision;
    if (!integer(p) || p < 0) return fail("invalid_request", `Field "precision" must be an integer from 0 to ${MAX_PRECISION}.`, "precision");
    if (p > MAX_PRECISION) return fail("precision_too_high", `Field "precision" must be at most ${MAX_PRECISION}.`, "precision");
    precision = p;
  }

  let maxLabelLength = DEFAULT_MAX_LABEL_LENGTH;
  if (Object.hasOwn(body, "max_label_length")) {
    const m = body.max_label_length;
    if (!integer(m) || m < MIN_LABEL_LENGTH || m > MAX_LABEL_LENGTH) {
      return fail(
        "invalid_request",
        `Field "max_label_length" must be an integer from ${MIN_LABEL_LENGTH} to ${MAX_LABEL_LENGTH}.`,
        "max_label_length",
      );
    }
    maxLabelLength = m;
  }

  return {
    ok: true,
    query: {
      latE5: truncateE5(lat, precision),
      lonE5: truncateE5(lon, precision),
      precision,
      maxLabelLength,
    },
  };
}
