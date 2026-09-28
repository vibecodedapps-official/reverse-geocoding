import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { archiveUrlFor, ensurePinned, type Pin } from "../../data/lib/pins.ts";

const CONTENT = "IT.16\tTuscany\tTuscany\t3165361\n";
const CONTENT_SHA256 = "2204a8380746d39c32ae25f7486a5e0032461c2589c6eaf15e992f41aa9d05de";
const OTHER_SHA256 = "1111111111111111111111111111111111111111111111111111111111111111";

function pin(sha256: string): Pin {
  return {
    name: "admin1CodesASCII.txt",
    source: "geonames",
    upstream_url: "https://download.geonames.org/export/dump/admin1CodesASCII.txt",
    retrieved: "2026-09-24",
    version: "2026-09-24",
    sha256,
    archive_url: `https://archive.example/${sha256}`,
  };
}

// Stand-ins for the network: an archive that serves CONTENT for any URL, and no network at all.
const archive = async () => new Response(CONTENT);
const offline = async (): Promise<Response> => {
  throw new Error("offline");
};

describe("ensurePinned", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reverse-geocoding-pins-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("uses the local copy when its checksum matches the pin", async () => {
    writeFileSync(join(dir, "admin1CodesASCII.txt"), CONTENT);

    await expect(ensurePinned(pin(CONTENT_SHA256), dir, offline)).resolves.toBe(join(dir, "admin1CodesASCII.txt"));
  });

  it("fetches the archive copy when there is no local copy", async () => {
    await expect(ensurePinned(pin(CONTENT_SHA256), dir, archive)).resolves.toBe(join(dir, "admin1CodesASCII.txt"));
  });

  it("fails, naming the file and both checksums, when the archive copy does not match the pin", async () => {
    writeFileSync(join(dir, "admin1CodesASCII.txt"), CONTENT);

    await expect(ensurePinned(pin(OTHER_SHA256), dir, archive)).rejects.toThrow(
      `admin1CodesASCII.txt: archive copy https://archive.example/${OTHER_SHA256} has SHA-256 ${CONTENT_SHA256}, pin expects ${OTHER_SHA256}`,
    );
    expect(existsSync(join(dir, "admin1CodesASCII.txt"))).toBe(false);
  });
});

describe("archiveUrlFor", () => {
  it("names a GeoNames pin by its checksum in the archive release", () => {
    expect(
      archiveUrlFor(
        "geonames",
        "https://download.geonames.org/export/dump/cities500.zip",
        "a99f1423b13c52d51e281d27fa924c2b11f05a57a96467ff7b8ea437e0b21b38",
        "https://github.com/o/r/releases/download/data-archive/",
      ),
    ).toBe("https://github.com/o/r/releases/download/data-archive/a99f1423b13c52d51e281d27fa924c2b11f05a57a96467ff7b8ea437e0b21b38");
  });

  it("keeps a geoBoundaries pin at its fixed-commit upstream URL", () => {
    expect(
      archiveUrlFor(
        "geoboundaries",
        "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/1289e40e366c7b320550be1ee0614a9472d572d4/releaseData/CGAZ/geoBoundariesCGAZ_ADM0.geojson",
        "5e97632703209f192d87724c3c02c3ed70eccec32ebddb605af9647002b65d67",
        "https://github.com/o/r/releases/download/data-archive/",
      ),
    ).toBe("https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/1289e40e366c7b320550be1ee0614a9472d572d4/releaseData/CGAZ/geoBoundariesCGAZ_ADM0.geojson");
  });
});
