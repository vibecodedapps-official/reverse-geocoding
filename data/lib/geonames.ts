// Parsers for the GeoNames dump files. Formats: https://download.geonames.org/export/dump/readme.txt

import { COORD_SCALE } from "../../src/index/format.ts";
import { cleanName } from "../../src/resolver/fit.ts";

function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l.length > 0);
}

export interface CountryInfo {
  /** ISO 3166-1 alpha-2. */
  code: string;
  /** ISO 3166-1 alpha-3. */
  iso3: string;
  name: string;
}

/** countryInfo.txt: comment lines start with "#"; columns ISO, ISO3, ISO-Numeric, fips, Country, ... */
export function parseCountryInfo(text: string): CountryInfo[] {
  const out: CountryInfo[] = [];
  for (const line of lines(text)) {
    if (line.startsWith("#")) continue;
    const cols = line.split("\t");
    const code = cols[0] ?? "";
    const iso3 = cols[1] ?? "";
    const name = cleanName(cols[4] ?? "");
    if (!/^[A-Z]{2}$/.test(code) || !/^[A-Z]{3}$/.test(iso3) || name === "") throw new Error(`countryInfo.txt: malformed line: ${line.slice(0, 80)}`);
    out.push({ code, iso3, name });
  }
  return out;
}

/** admin1CodesASCII.txt: "CC.code", name, ascii name, geonameid. Keyed by "CC.code". Entries whose name cleans to empty are left out. */
export function parseAdmin1Codes(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of lines(text)) {
    const cols = line.split("\t");
    const key = cols[0] ?? "";
    if (!/^[A-Z]{2}\..+$/.test(key)) throw new Error(`admin1CodesASCII.txt: malformed line: ${line.slice(0, 80)}`);
    const name = cleanName(cols[1] ?? "");
    if (name !== "") out.set(key, name);
  }
  return out;
}

export interface City {
  name: string;
  /** 1e-5 degrees. */
  lat: number;
  lon: number;
  country: string;
  /** GeoNames admin1 code without the country prefix; may be empty. */
  admin1: string;
}

export interface CitiesResult {
  cities: City[];
  /** Rows dropped because the name cleaned to empty or the coordinates were unusable. */
  dropped: number;
}

/** cities500.txt: geonameid, name, asciiname, alternatenames, latitude, longitude, class, code, country code, cc2, admin1 code, ... */
export function parseCities(text: string): CitiesResult {
  const cities: City[] = [];
  let dropped = 0;
  for (const line of lines(text)) {
    const cols = line.split("\t");
    if (cols.length < 11) throw new Error(`cities500.txt: line has ${cols.length} columns: ${line.slice(0, 80)}`);
    const name = cleanName(cols[1]!);
    const lat = Number(cols[4]);
    const lon = Number(cols[5]);
    if (name === "" || cols[4] === "" || cols[5] === "" || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) {
      dropped++;
      continue;
    }
    cities.push({ name, lat: Math.round(lat * COORD_SCALE), lon: Math.round(lon * COORD_SCALE), country: cols[8]!, admin1: cols[10]! });
  }
  return { cities, dropped };
}
