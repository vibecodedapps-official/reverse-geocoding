// Builds the index from the synthetic fixture in test/fixtures/sources, through the same
// build code as the real data. Node only.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { buildIndex, type BuildInputs, type BuildResult, type SourcePin } from "../../data/lib/build-index.ts";
import { readLines } from "../../data/lib/cgaz.ts";
import { SOURCE_FILES, citiesFromZip } from "../../data/lib/sources.ts";
import { loadIndex, type GeoIndex } from "../../src/index/format.ts";

export const FIXTURE_DIR = join(import.meta.dirname, "..", "fixtures", "sources");
/** Retrieval date the fixture pins claim, and so the index's dataDate. */
export const SYNTHETIC_DATA_DATE = "2026-09-24";

/** A zip archive with one deflated entry and a fixed timestamp, so equal input gives equal bytes. */
export function writeZip(name: string, data: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const packed = deflateRawSync(data);
  const crc = crc32(data);
  const dosDate = (1 << 5) | 1; // 1980-01-01
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(4, 20, true);
  local.setUint16(8, 8, true);
  local.setUint16(12, dosDate, true);
  local.setUint32(14, crc, true);
  local.setUint32(18, packed.length, true);
  local.setUint32(22, data.length, true);
  local.setUint16(26, nameBytes.length, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(4, 20, true);
  central.setUint16(6, 20, true);
  central.setUint16(10, 8, true);
  central.setUint16(14, dosDate, true);
  central.setUint32(16, crc, true);
  central.setUint32(20, packed.length, true);
  central.setUint32(24, data.length, true);
  central.setUint16(28, nameBytes.length, true);
  const centralOffset = 30 + nameBytes.length + packed.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, 46 + nameBytes.length, true);
  end.setUint32(16, centralOffset, true);
  return Buffer.concat([
    new Uint8Array(local.buffer),
    nameBytes,
    packed,
    new Uint8Array(central.buffer),
    nameBytes,
    new Uint8Array(end.buffer),
  ]);
}

function fixture(name: string): Buffer {
  return readFileSync(join(FIXTURE_DIR, name));
}

/** The fixture as build inputs. */
export function syntheticInputs(): BuildInputs {
  const zip = writeZip("cities500.txt", fixture("cities500.txt"));
  const files: Array<[string, SourcePin["source"], Uint8Array]> = [
    [SOURCE_FILES.cities, "geonames", zip],
    [SOURCE_FILES.admin1Codes, "geonames", fixture(SOURCE_FILES.admin1Codes)],
    [SOURCE_FILES.countryInfo, "geonames", fixture(SOURCE_FILES.countryInfo)],
    [SOURCE_FILES.adm0, "geoboundaries", fixture(SOURCE_FILES.adm0)],
    [SOURCE_FILES.adm1, "geoboundaries", fixture(SOURCE_FILES.adm1)],
  ];
  const pins: SourcePin[] = files.map(([name, source, bytes]) => ({
    name,
    source,
    version: source === "geonames" ? SYNTHETIC_DATA_DATE : "synthetic fixture",
    retrieved: SYNTHETIC_DATA_DATE,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }));
  return {
    cities: citiesFromZip(zip),
    admin1Codes: fixture(SOURCE_FILES.admin1Codes).toString("utf8"),
    countryInfo: fixture(SOURCE_FILES.countryInfo).toString("utf8"),
    adm0: readLines(join(FIXTURE_DIR, SOURCE_FILES.adm0)),
    adm1: readLines(join(FIXTURE_DIR, SOURCE_FILES.adm1)),
    overrides: fixture("admin1-overrides.csv").toString("utf8"),
    pins,
    builtAt: `${SYNTHETIC_DATA_DATE}T00:00:00.000Z`,
  };
}

/** Builds the fixture and writes settlements.bin, boundaries.bin, and manifest.json into outDir. */
export function buildSynthetic(outDir: string): BuildResult {
  const result = buildIndex(syntheticInputs());
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "settlements.bin"), result.settlements);
  writeFileSync(join(outDir, "boundaries.bin"), result.boundaries);
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(result.manifest, null, 2)}\n`);
  return result;
}

let cached: GeoIndex | undefined;

/** The fixture index, built in process once. */
export function syntheticIndex(): GeoIndex {
  if (!cached) {
    const result = buildIndex(syntheticInputs());
    cached = loadIndex(result.settlements.slice().buffer, result.boundaries.slice().buffer);
  }
  return cached;
}
