// Re-pins the source files.
//
// Usage:
//   node data/pin.ts            Download the current upstream files into data/raw and write
//                               their checksums into data/manifest.json.
//   node data/pin.ts --upload   Upload each pinned file in data/raw to the archive release as an
//                               asset named by its SHA-256, using the gh CLI. An asset that
//                               already exists is never replaced.
//
// GeoNames overwrites its dump files daily and keeps no dated copies, so upload the same day
// as the download; the archive copy is the only way to rebuild from these pins later.

import { execFileSync } from "node:child_process";
import { copyFileSync, linkSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { download, readPinManifest, sha256File, type Pin } from "./lib/pins.ts";
import { SOURCE_FILES } from "./lib/sources.ts";

const dataDir = import.meta.dirname;
const rawDir = join(dataDir, "raw");
const manifestPath = join(dataDir, "manifest.json");

const GEONAMES = "https://download.geonames.org/export/dump/";
const GEOBOUNDARIES_TAG = "v6.0.0";
const GEOBOUNDARIES_COMMIT = "1289e40e366c7b320550be1ee0614a9472d572d4";
// The CGAZ files are stored with Git LFS, so they are served from the media host, not raw.
const CGAZ = `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${GEOBOUNDARIES_COMMIT}/releaseData/CGAZ/`;

const UPSTREAM: ReadonlyArray<{ name: string; source: Pin["source"]; url: string }> = [
  { name: SOURCE_FILES.cities, source: "geonames", url: `${GEONAMES}${SOURCE_FILES.cities}` },
  { name: SOURCE_FILES.admin1Codes, source: "geonames", url: `${GEONAMES}${SOURCE_FILES.admin1Codes}` },
  { name: SOURCE_FILES.countryInfo, source: "geonames", url: `${GEONAMES}${SOURCE_FILES.countryInfo}` },
  { name: SOURCE_FILES.adm0, source: "geoboundaries", url: `${CGAZ}${SOURCE_FILES.adm0}` },
  { name: SOURCE_FILES.adm1, source: "geoboundaries", url: `${CGAZ}${SOURCE_FILES.adm1}` },
];

async function pin(): Promise<void> {
  const manifest = readPinManifest(manifestPath);
  mkdirSync(rawDir, { recursive: true });
  const retrieved = new Date().toISOString().slice(0, 10);
  const files: Pin[] = [];
  for (const u of UPSTREAM) {
    console.log(`downloading ${u.url}`);
    const got = await download(u.url, join(rawDir, u.name));
    console.log(`  ${got.bytes} bytes, SHA-256 ${got.sha256}`);
    files.push({
      name: u.name,
      source: u.source,
      upstream_url: u.url,
      retrieved,
      version: u.source === "geonames" ? retrieved : `${GEOBOUNDARIES_TAG} (${GEOBOUNDARIES_COMMIT})`,
      sha256: got.sha256,
      archive_url: `${manifest.archive_base_url}${got.sha256}`,
    });
  }
  writeFileSync(manifestPath, `${JSON.stringify({ archive_base_url: manifest.archive_base_url, files }, null, 2)}\n`);
  console.log("wrote data/manifest.json; run node data/pin.ts --upload today to archive these files");
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

async function upload(): Promise<void> {
  const manifest = readPinManifest(manifestPath);
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/$/.exec(manifest.archive_base_url);
  if (!m) throw new Error(`archive_base_url ${manifest.archive_base_url} is not a GitHub release download URL ending in /`);
  const [, repo, tag] = m as unknown as [string, string, string];
  const release = JSON.parse(gh(["release", "view", tag, "--repo", repo, "--json", "assets"])) as { assets: Array<{ name: string }> };
  const existing = new Set(release.assets.map((a) => a.name));
  const staging = join(rawDir, ".upload");
  mkdirSync(staging, { recursive: true });
  try {
    for (const p of manifest.files) {
      const local = join(rawDir, p.name);
      const sha = await sha256File(local);
      if (sha !== p.sha256) throw new Error(`${p.name}: data/raw copy has SHA-256 ${sha}, pin expects ${p.sha256}`);
      if (existing.has(p.sha256)) {
        console.log(`${p.name}: asset ${p.sha256} already in ${repo} release ${tag}; refusing to replace it`);
        continue;
      }
      // gh names an asset after the file, so stage the file under its checksum.
      const staged = join(staging, p.sha256);
      rmSync(staged, { force: true });
      try {
        linkSync(local, staged);
      } catch {
        copyFileSync(local, staged);
      }
      console.log(`${p.name}: uploading as ${p.sha256}`);
      // No --clobber: gh fails rather than replace an asset that appeared since the listing.
      gh(["release", "upload", tag, staged, "--repo", repo]);
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

const run = process.argv.includes("--upload") ? upload : pin;
run().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
