import { describe, expect, it } from "vitest";
import type { Level } from "../../src/resolver/api.ts";
import { fitLabel } from "../../src/resolver/fit.ts";
import { resolve } from "../../src/resolver/resolve.ts";
import { e5 } from "../node/resolver-helpers.ts";
import { loadBuiltIndex, readFixture } from "./built-index.ts";

interface Fixture {
  name: string;
  latitude: number;
  longitude: number;
  expected:
    | { status: "no_result" }
    | {
        status: "ok";
        level: Level;
        country_code: string;
        admin1: string | null;
        /** Absent when the settlement name is not asserted. */
        locality?: string | null;
        label?: { max_label_length: number; short: string };
      };
}

const index = loadBuiltIndex();
const { fixtures } = readFixture<{ fixtures: Fixture[] }>("calibration.json");

describe("calibration landmarks", () => {
  it.each(fixtures.map((f) => [f.name, f] as const))("%s", (_, f) => {
    const r = resolve(index, e5(f.latitude), e5(f.longitude));
    const want = f.expected;
    expect(r.status).toBe(want.status);
    if (r.status !== "ok" || want.status !== "ok") return;
    expect({ level: r.level, country_code: r.components.country_code, admin1: r.components.admin1 }).toEqual({
      level: want.level,
      country_code: want.country_code,
      admin1: want.admin1,
    });
    if (want.locality !== undefined) expect(r.components.locality).toBe(want.locality);
    if (want.label !== undefined) expect(fitLabel(r.components, r.level, want.label.max_label_length)).toBe(want.label.short);
  });
});
