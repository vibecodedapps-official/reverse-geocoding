// Builds the index files from the pinned sources.
//
// Usage: node data/build.ts
//
// Reads data/manifest.json. Each pinned file is taken from data/raw when its SHA-256 matches,
// else fetched from the archive, never from upstream. Writes data/build/settlements.bin,
// data/build/boundaries.bin, data/build/manifest.json, and data/build/report.json.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildIndex } from "./lib/build-index.ts";
import { ensurePinned, readPinManifest } from "./lib/pins.ts";
import { SOURCE_FILES, readSources } from "./lib/sources.ts";

const dataDir = import.meta.dirname;
const rawDir = join(dataDir, "raw");
const outDir = join(dataDir, "build");

async function main(): Promise<void> {
  const pins = readPinManifest(join(dataDir, "manifest.json"));
  if (pins.files.length === 0) throw new Error("data/manifest.json has no pins; run npm run data:pin first");
  const pinned = new Set(pins.files.map((f) => f.name));
  const missing = Object.values(SOURCE_FILES).filter((name) => !pinned.has(name));
  if (missing.length > 0) throw new Error(`data/manifest.json has no pin for ${missing.join(", ")}`);

  mkdirSync(rawDir, { recursive: true });
  for (const pin of pins.files) await ensurePinned(pin, rawDir);

  const result = buildIndex({
    ...readSources(rawDir),
    overrides: readFileSync(join(dataDir, "admin1-overrides.csv"), "utf8"),
    pins: pins.files,
    builtAt: new Date().toISOString(),
  });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "settlements.bin"), result.settlements);
  writeFileSync(join(outDir, "boundaries.bin"), result.boundaries);
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(result.manifest, null, 2)}\n`);
  writeFileSync(join(outDir, "report.json"), `${JSON.stringify(result.report, null, 2)}\n`);

  const { manifest: m, report: r } = result;
  for (const g of r.unmatchedGroups) console.log(`no GeoNames country for ${g.level} group ${g.group} "${g.name}"; left out`);
  for (const f of r.vanishedFeatures) console.log(`${f.level} ${f.label} has no polygon left after simplification; left out`);
  for (const o of r.overlaps) console.log(`${o.level} overlap: ${o.a} and ${o.b}`);
  for (const u of r.unmappedRegions) console.log(`no ADM1 polygon maps to GeoNames region ${u.code} "${u.name}"`);
  console.log(`build ${m.buildId}, data date ${m.dataDate}`);
  console.log(`settlements.bin ${m.bytes.settlements} bytes, ${m.counts.settlements} settlements`);
  console.log(`boundaries.bin  ${m.bytes.boundaries} bytes, ${m.counts.adm0Polygons} ADM0 and ${m.counts.adm1Polygons} ADM1 polygons`);
  console.log(`longest component name: ${m.longestComponentName.utf16.length} UTF-16 units, ${m.longestComponentName.codePoints.length} code points`);
  console.log(`${m.overlaps} overlaps, ${m.unmappedRegions} GeoNames regions with no polygon (details in data/build/report.json)`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
