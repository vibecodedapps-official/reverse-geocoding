import { COORD_SCALE, NO_ADMIN1, settlementName, type GeoIndex, type Tables } from "../index/format.ts";
import { LOCALITY_THRESHOLD_KM, type Components, type Resolution } from "./api.ts";
import { nearestSettlement } from "./nearest.ts";
import { containingPolygon } from "./pip.ts";

const THRESHOLD_M = LOCALITY_THRESHOLD_KM * 1000;

function components(tables: Tables, country: number, admin1: number, locality: string | null): Components {
  const c = tables.countries[country];
  if (c === undefined) throw new Error(`index references missing country ${country}`);
  let region: string | null = null;
  if (admin1 !== NO_ADMIN1) {
    const a = tables.admin1[admin1];
    if (a === undefined) throw new Error(`index references missing admin1 ${admin1}`);
    region = a.name;
  }
  // Names are cleaned, and empty ones dropped, when the data is built.
  return { locality, admin1: region, country: c.name, country_code: c.code };
}

/**
 * Resolves an already validated and truncated point, in 1e-5 degrees, as described in docs/API.md:
 * the containing country is never overridden, the region comes from the containing region polygon
 * of that country, and the locality is the nearest settlement in that country within the locality
 * threshold. Outside every country, the nearest settlement within the threshold names the place.
 */
export function resolve(index: GeoIndex, latE5: number, lonE5: number): Resolution {
  if (lonE5 === 180 * COORD_SCALE) lonE5 = -180 * COORD_SCALE;
  const { tables, settlements } = index;

  const adm0 = containingPolygon(index.adm0, latE5, lonE5, null);
  if (adm0 >= 0) {
    const country = index.adm0.country[adm0]!;
    const adm1 = containingPolygon(index.adm1, latE5, lonE5, country);
    const admin1 = adm1 >= 0 ? index.adm1.admin1[adm1]! : NO_ADMIN1;
    const near = nearestSettlement(settlements, latE5, lonE5, country);
    let meters: number | null = null;
    if (near !== null) {
      meters = Math.round(near.meters);
      if (meters <= THRESHOLD_M) {
        const c = components(tables, country, admin1, settlementName(settlements, near.row));
        return { status: "ok", components: c, level: "locality", distanceMeters: meters, degradedFrom: null };
      }
    }
    const c = components(tables, country, admin1, null);
    return { status: "ok", components: c, level: c.admin1 !== null ? "region" : "country", distanceMeters: meters, degradedFrom: "locality" };
  }

  const near = nearestSettlement(settlements, latE5, lonE5, null);
  if (near === null) return { status: "no_result", distanceMeters: null };
  const meters = Math.round(near.meters);
  if (meters > THRESHOLD_M) return { status: "no_result", distanceMeters: meters };
  const c = components(tables, settlements.country[near.row]!, settlements.admin1[near.row]!, settlementName(settlements, near.row));
  return { status: "ok", components: c, level: "locality", distanceMeters: meters, degradedFrom: null };
}
