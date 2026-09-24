import { describe, expect, it } from "vitest";
import { NO_ADMIN1, type GeoIndex, type Tables } from "../../src/index/format.ts";
import { resolve } from "../../src/resolver/resolve.ts";
import { box, buildIndex, e5 } from "./resolver-helpers.ts";

const tables: Tables = {
  countries: [
    { code: "CL", name: "Chile" },
    { code: "AR", name: "Argentina" },
    { code: "US", name: "United States" },
    { code: "FJ", name: "Fiji" },
    { code: "AQ", name: "Antarctica" },
    { code: "FR", name: "France" },
    { code: "GH", name: "Ghana" },
    { code: "SJ", name: "Svalbard and Jan Mayen" },
  ],
  admin1: [
    { country: 0, code: "12", name: "Region of Magallanes" },
    { country: 1, code: "19", name: "Santa Cruz" },
    { country: 2, code: "TX", name: "Texas" },
    { country: 2, code: "AR", name: "Arkansas" },
    { country: 3, code: "03", name: "Northern" },
    { country: 5, code: "B8", name: "Provence-Alpes-Côte d'Azur" },
    { country: 2, code: "W", name: "West" },
    { country: 2, code: "E", name: "East" },
    { country: 2, code: "N", name: "North" },
    { country: 2, code: "S", name: "South" },
  ],
};
const [CL, AR, US, FJ, AQ, FR, GH, SJ] = [0, 1, 2, 3, 4, 5, 6, 7];

function at(index: GeoIndex, lat: number, lon: number) {
  return resolve(index, e5(lat), e5(lon));
}

describe("point in polygon", () => {
  it("treats a hole as outside the polygon", () => {
    const index = buildIndex({ tables, adm0: [{ rings: [box(0, 0, 10, 10), box(4, 4, 6, 6)], country: US }] });
    expect(at(index, 5, 5)).toEqual({ status: "no_result", distanceMeters: null });
    expect(at(index, 2, 2)).toMatchObject({ status: "ok", level: "country", components: { country_code: "US" } });
  });

  it("puts a point on a shared edge in exactly one region, the same one every time", () => {
    // West and East share the edge (4,0)-(6,10), stored in opposite directions; West is built first.
    const diagonal = buildIndex({
      tables,
      adm0: [{ rings: [box(0, 0, 10, 10)], country: US }],
      adm1: [
        { rings: [[[e5(0), e5(0)], [e5(4), e5(0)], [e5(6), e5(10)], [e5(0), e5(10)]]], country: US, admin1: 6 },
        { rings: [[[e5(4), e5(0)], [e5(10), e5(0)], [e5(10), e5(10)], [e5(6), e5(10)]]], country: US, admin1: 7 },
      ],
    });
    expect(at(diagonal, 5, 5)).toMatchObject({ components: { admin1: "East" } });
    expect(at(diagonal, 1, 4.2)).toMatchObject({ components: { admin1: "East" } });
    expect(at(diagonal, 5, 5)).toEqual(at(diagonal, 5, 5));
    const horizontal = buildIndex({
      tables,
      adm0: [{ rings: [box(20, 0, 30, 10)], country: US }],
      adm1: [
        { rings: [box(20, 0, 30, 5)], country: US, admin1: 9 },
        { rings: [box(20, 5, 30, 10)], country: US, admin1: 8 },
      ],
    });
    expect(at(horizontal, 5, 22)).toMatchObject({ components: { admin1: "North" } });
  });

  it("gives an overlapped point to the polygon built first", () => {
    const index = buildIndex({
      tables,
      adm0: [
        { rings: [box(0, 0, 10, 10)], country: CL },
        { rings: [box(5, 5, 15, 15)], country: AR },
      ],
    });
    expect(at(index, 7, 7)).toMatchObject({ components: { country_code: "CL" } });
  });
});

describe("resolution", () => {
  it("keeps a Chilean point in Chile and its region when the nearest settlement is Argentine", () => {
    const index = buildIndex({
      tables,
      adm0: [
        { rings: [box(-76, -56, -72.9, -17)], country: CL },
        { rings: [box(-72.9, -56, -53, -22)], country: AR },
      ],
      adm1: [
        // An Argentine region overlapping Chile, built first, must not be considered for a Chilean point.
        { rings: [box(-74, -52.5, -65, -46)], country: AR, admin1: 1 },
        { rings: [box(-76, -56, -72.9, -48)], country: CL, admin1: 0 },
      ],
      settlements: [
        { lat: e5(-50.94), lon: e5(-72.85), country: AR, admin1: 1, name: "Rio Turbio" },
        { lat: e5(-51.2), lon: e5(-72.95), country: CL, admin1: 0, name: "Puerto Natales" },
      ],
    });
    expect(at(index, -50.94, -72.95)).toEqual({
      status: "ok",
      components: { locality: null, admin1: "Region of Magallanes", country: "Chile", country_code: "CL" },
      level: "region",
      distanceMeters: 28911,
      degradedFrom: "locality",
    });
  });

  it("keeps the region a point is in when the nearest settlement is in the neighboring region", () => {
    const index = buildIndex({
      tables,
      adm0: [{ rings: [box(-100, 30, -90, 37)], country: US }],
      adm1: [
        { rings: [box(-100, 30, -94.043, 37)], country: US, admin1: 2 },
        { rings: [box(-94.043, 30, -90, 37)], country: US, admin1: 3 },
      ],
      settlements: [
        { lat: e5(33.44179), lon: e5(-94.03769), country: US, admin1: 3, name: "Arkansas Side" },
        { lat: e5(33.42513), lon: e5(-94.04769), country: US, admin1: 2, name: "Texas Side" },
      ],
    });
    expect(at(index, 33.4415, -94.048)).toEqual({
      status: "ok",
      components: { locality: "Arkansas Side", admin1: "Texas", country: "United States", country_code: "US" },
      level: "locality",
      distanceMeters: 957,
      degradedFrom: null,
    });
  });

  it("names a settlement up to 20 km away and degrades to the region beyond it", () => {
    const index = buildIndex({
      tables,
      adm0: [{ rings: [box(0, 0, 10, 10)], country: US }],
      adm1: [{ rings: [box(0, 0, 10, 10)], country: US, admin1: 6 }],
      settlements: [{ lat: e5(5), lon: e5(5), country: US, admin1: 6, name: "Town" }],
    });
    expect(at(index, 5.179, 5)).toMatchObject({ level: "locality", components: { locality: "Town" }, distanceMeters: 19904, degradedFrom: null });
    expect(at(index, 5.18, 5)).toMatchObject({
      level: "region",
      components: { locality: null, admin1: "West" },
      distanceMeters: 20015,
      degradedFrom: "locality",
    });
  });

  it("degrades to the country when the containing region is mapped to no region", () => {
    const index = buildIndex({
      tables,
      adm0: [{ rings: [box(0, 0, 10, 10)], country: US }],
      adm1: [{ rings: [box(0, 0, 10, 10)], country: US, admin1: NO_ADMIN1 }],
      settlements: [{ lat: e5(5), lon: e5(5), country: US, admin1: NO_ADMIN1, name: "Town" }],
    });
    expect(at(index, 5.18, 5)).toEqual({
      status: "ok",
      components: { locality: null, admin1: null, country: "United States", country_code: "US" },
      level: "country",
      distanceMeters: 20015,
      degradedFrom: "locality",
    });
  });

  it("snaps a coastal point outside every country to a settlement within 20 km", () => {
    const index = buildIndex({
      tables,
      adm0: [{ rings: [box(5, 43.7, 8, 46)], country: FR }],
      settlements: [{ lat: e5(43.70313), lon: e5(7.26608), country: FR, admin1: 5, name: "Nice" }],
    });
    expect(at(index, 43.69, 7.26)).toEqual({
      status: "ok",
      components: { locality: "Nice", admin1: "Provence-Alpes-Côte d'Azur", country: "France", country_code: "FR" },
      level: "locality",
      distanceMeters: 1540,
      degradedFrom: null,
    });
  });

  const gulf = buildIndex({
    tables,
    settlements: [{ lat: e5(4.89816), lon: e5(-1.76029), country: GH, admin1: NO_ADMIN1, name: "Takoradi" }],
  });

  it("returns no_result with a null distance at latitude 0, longitude 0 when nothing is within 500 km", () => {
    expect(at(gulf, 0, 0)).toEqual({ status: "no_result", distanceMeters: null });
  });

  it("returns no_result with the distance when the nearest settlement outside every country is beyond 20 km", () => {
    expect(at(gulf, 4.5, -1.76)).toEqual({ status: "no_result", distanceMeters: 44273 });
  });
});

describe("antimeridian", () => {
  const index = buildIndex({
    tables,
    adm0: [
      { rings: [box(179, -17.5, 180, -16)], country: FJ },
      { rings: [box(-180, -17.5, -179.5, -16)], country: FJ },
    ],
    adm1: [
      { rings: [box(179, -17.5, 180, -16)], country: FJ, admin1: 4 },
      { rings: [box(-180, -17.5, -179.5, -16)], country: FJ, admin1: 4 },
    ],
    settlements: [
      { lat: e5(-16.78), lon: e5(179.95), country: FJ, admin1: 4, name: "West Town" },
      { lat: e5(-16.78), lon: e5(-179.8), country: FJ, admin1: 4, name: "East Town" },
    ],
  });

  it("resolves longitude 180 and -180 identically", () => {
    const east = at(index, -17.3, 180);
    expect(east).toEqual(at(index, -17.3, -180));
    expect(east).toMatchObject({ status: "ok", level: "region", components: { country_code: "FJ", admin1: "Northern" } });
  });

  it("finds the nearest settlement across the antimeridian", () => {
    expect(at(index, -16.78, -179.99)).toMatchObject({ level: "locality", components: { locality: "West Town" }, distanceMeters: 6388 });
  });
});

describe("poles", () => {
  const index = buildIndex({
    tables,
    adm0: [{ rings: [box(-180, -90, 180, -60)], country: AQ }],
    settlements: [
      { lat: e5(89.95), lon: e5(-170), country: SJ, admin1: NO_ADMIN1, name: "Over the pole" },
      { lat: e5(89.7), lon: e5(10), country: SJ, admin1: NO_ADMIN1, name: "Same meridian" },
    ],
  });

  it("resolves latitude 90", () => {
    expect(at(index, 90, 0)).toMatchObject({ status: "ok", level: "locality", components: { locality: "Over the pole" }, distanceMeters: 5560 });
  });

  it("resolves latitude -90 inside a polygon that reaches the pole", () => {
    expect(at(index, -90, 0)).toEqual({
      status: "ok",
      components: { locality: null, admin1: null, country: "Antarctica", country_code: "AQ" },
      level: "country",
      distanceMeters: null,
      degradedFrom: "locality",
    });
  });

  it("finds the nearest settlement over the pole at latitude 89.9", () => {
    expect(at(index, 89.9, 10)).toMatchObject({ components: { locality: "Over the pole" }, distanceMeters: 16679 });
  });
});
