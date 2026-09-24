// The source files the build reads, by the names they have upstream and in data/raw.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BuildInputs } from "./build-index.ts";
import { readLines } from "./cgaz.ts";
import { readZipEntry } from "./zip.ts";

export const SOURCE_FILES = {
  cities: "cities500.zip",
  admin1Codes: "admin1CodesASCII.txt",
  countryInfo: "countryInfo.txt",
  adm0: "geoBoundariesCGAZ_ADM0.geojson",
  adm1: "geoBoundariesCGAZ_ADM1.geojson",
} as const;

export type SourceContents = Pick<BuildInputs, "cities" | "admin1Codes" | "countryInfo" | "adm0" | "adm1">;

/** cities500.txt out of cities500.zip. */
export function citiesFromZip(zip: Uint8Array): string {
  return new TextDecoder().decode(readZipEntry(zip, "cities500.txt"));
}

/** Reads the sources in dir. The boundary files are read line by line as the build consumes them. */
export function readSources(dir: string): SourceContents {
  return {
    cities: citiesFromZip(readFileSync(join(dir, SOURCE_FILES.cities))),
    admin1Codes: readFileSync(join(dir, SOURCE_FILES.admin1Codes), "utf8"),
    countryInfo: readFileSync(join(dir, SOURCE_FILES.countryInfo), "utf8"),
    adm0: readLines(join(dir, SOURCE_FILES.adm0)),
    adm1: readLines(join(dir, SOURCE_FILES.adm1)),
  };
}
