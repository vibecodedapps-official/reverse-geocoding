import { describe, expect, it } from "vitest";
import { parseQuery, truncateE5 } from "../../src/worker/parse.ts";

describe("truncateE5", () => {
  it.each([
    [0.29, 2, 29000],
    [-43.77319, 3, -4377300],
    [90, 3, 9000000],
    [-180, 0, -18000000],
    [43.99999, 0, 4300000],
    [-0.00015, 4, -10],
    [1e-7, 4, 0],
    [-5e-7, 4, 0],
  ])("truncates %s to %s decimals as %s", (n, precision, expected) => {
    expect(Object.is(truncateE5(n, precision), expected)).toBe(true);
  });
});

describe("parseQuery", () => {
  it("returns only the truncated query, with defaults", () => {
    expect(parseQuery('{"latitude": 43.77319, "longitude": -11.25609}')).toEqual({
      ok: true,
      query: { latE5: 4377300, lonE5: -1125600, precision: 3, maxLabelLength: 120 },
    });
  });

  it("applies the requested precision and label length", () => {
    expect(parseQuery('{"latitude": 0.29, "longitude": 1, "precision": 2, "max_label_length": 8}')).toEqual({
      ok: true,
      query: { latE5: 29000, lonE5: 100000, precision: 2, maxLabelLength: 8 },
    });
  });

  it("reports an unexpected field before any other problem", () => {
    expect(parseQuery('{"latitude": "x", "subject": "a@b.example"}')).toEqual({
      ok: false,
      error: {
        code: "unexpected_field",
        message: 'Unexpected field "subject". Allowed fields: latitude, longitude, precision, max_label_length.',
        field: "subject",
      },
    });
  });

  it("treats an own __proto__ key as an unexpected field", () => {
    expect(parseQuery('{"__proto__": {}, "latitude": 1, "longitude": 1}')).toMatchObject({
      ok: false,
      error: { code: "unexpected_field", field: "__proto__" },
    });
  });

  it("checks latitude before longitude", () => {
    expect(parseQuery('{"latitude": 91, "longitude": 181}')).toMatchObject({ ok: false, error: { field: "latitude" } });
  });
});
