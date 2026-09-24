import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFeatureLine, readLines } from "../../data/lib/cgaz.ts";

describe("readLines", () => {
  it("returns whole lines when lines and multi-byte characters straddle chunk boundaries", () => {
    const dir = mkdtempSync(join(tmpdir(), "georeverse-lines-"));
    try {
      const path = join(dir, "features.geojson");
      writeFileSync(path, '{\n"features": [\n{ "shapeName": "Aysén" },\r\n{ "shapeName": "Río Turbio" }\n]\n}');

      expect([...readLines(path, 5)]).toEqual(['{', '"features": [', '{ "shapeName": "Aysén" },', '{ "shapeName": "Río Turbio" }', "]", "}"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads the file again each time it is iterated, since the build reads the boundary files twice", () => {
    const dir = mkdtempSync(join(tmpdir(), "georeverse-lines-"));
    try {
      const path = join(dir, "features.geojson");
      writeFileSync(path, "a\nb\n");
      const lines = readLines(path);

      expect([...lines, ...lines]).toEqual(["a", "b", "a", "b"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseFeatureLine", () => {
  it("rejects a feature written across several lines instead of skipping it", () => {
    expect(() => parseFeatureLine('{ "type": "Feature", "properties": {')).toThrow("boundary feature spans more than one line");
  });
});
