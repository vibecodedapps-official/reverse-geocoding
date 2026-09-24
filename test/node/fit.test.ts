import { describe, expect, it } from "vitest";
import type { Components } from "../../src/resolver/api.ts";
import { cleanName, fitLabel } from "../../src/resolver/fit.ts";

const florence: Components = { locality: "Florence", admin1: "Tuscany", country: "Italy", country_code: "IT" };

describe("cleanName", () => {
  it("strips control characters, normalizes to NFC, and trims", () => {
    expect(cleanName(" \tSa\u0303o\u0000 Tome\u0301\u0007\n")).toBe("S\u00e3o Tom\u00e9");
  });
});

describe("fitLabel", () => {
  it("returns locality and country when they fit", () => {
    expect(fitLabel(florence, "locality", 50)).toBe("Florence, Italy");
  });

  it("drops a component rather than cutting inside one", () => {
    expect(fitLabel(florence, "locality", 14)).toBe("Florence");
  });

  it("starts from admin1 and country for a region", () => {
    expect(fitLabel(florence, "region", 50)).toBe("Tuscany, Italy");
  });

  it("skips candidates whose component is missing or blank", () => {
    const blank: Components = { locality: " \u0007 ", admin1: null, country: "Chile", country_code: "CL" };
    expect(fitLabel(blank, "locality", 50)).toBe("Chile");
  });

  it("measures UTF-16 code units, not only code points", () => {
    // Five astral-plane characters: five code points, ten UTF-16 units.
    const astral: Components = { locality: "\u{1D49C}\u{1D49C}\u{1D49C}\u{1D49C}\u{1D49C}", admin1: null, country: "Chad", country_code: "TD" };
    expect(fitLabel(astral, "locality", 9)).toBe("Chad");
    expect(fitLabel(astral, "locality", 10)).toBe("\u{1D49C}\u{1D49C}\u{1D49C}\u{1D49C}\u{1D49C}");
  });

  it("normalizes to NFC before measuring", () => {
    // Ten UTF-16 units decomposed, eight composed.
    const decomposed: Components = { locality: null, admin1: null, country: "Sa\u0303o Tome\u0301", country_code: "ST" };
    expect(fitLabel(decomposed, "country", 8)).toBe("S\u00e3o Tom\u00e9");
  });

  it("strips control characters from the label", () => {
    const control: Components = { locality: "Flo\u0000rence\u009f", admin1: null, country: "Italy", country_code: "IT" };
    expect(fitLabel(control, "locality", 50)).toBe("Florence, Italy");
  });

  it("falls through to the country code at length 8 and leaves the long country name whole", () => {
    const long: Components = { locality: null, admin1: null, country: "Central African Republic", country_code: "CF" };
    expect(fitLabel(long, "country", 8)).toBe("CF");
    expect(long.country).toBe("Central African Republic");
  });
});
