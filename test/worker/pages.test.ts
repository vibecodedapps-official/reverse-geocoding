import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker from "../../src/worker/index.ts";
import { ORIGIN, fetchPath, type ErrorBody } from "./request.ts";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("reports the loaded data versions on /healthz without a key", async () => {
  const res = await fetchPath("/healthz");
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  const body = (await res.json()) as { request_id: string; data: { build_id: string } };
  expect(res.headers.get("X-Request-Id")).toBe(body.request_id);
  expect(body.data.build_id).toMatch(/^[0-9a-f]{16}$/);
  expect(body).toEqual({
    status: "ok",
    request_id: body.request_id,
    data: {
      build_id: body.data.build_id,
      data_date: "2026-09-24",
      sources: [
        { name: "cities500.zip", version: "2026-09-24", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { name: "admin1CodesASCII.txt", version: "2026-09-24", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { name: "countryInfo.txt", version: "2026-09-24", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { name: "geoBoundariesCGAZ_ADM0.geojson", version: "synthetic fixture", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { name: "geoBoundariesCGAZ_ADM1.geojson", version: "synthetic fixture", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      ],
    },
  });
});

it.each([
  ["missing", undefined],
  ["not JSON", "not json"],
  ["an entry without a valid hash", '[{"id": "key_private", "sha256": "00", "daily_limit": 1}]'],
])("answers /healthz with 500 internal when KEYS is %s", async (_, keys) => {
  const res = await worker.fetch(new Request(`${ORIGIN}/healthz`), { ...env, KEYS: keys as string });
  expect(res.status).toBe(500);
  expect(((await res.json()) as ErrorBody).error).toEqual({
    code: "internal",
    message: "The KEYS secret is missing or malformed.",
    retryable: true,
  });
});

it("serves the public page as HTML with the credit, the threshold, and the data versions", async () => {
  const res = await fetchPath("/");
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  expect(res.headers.get("X-Request-Id")).toMatch(/^req_[0-9A-HJKMNP-TV-Z]{13}$/);
  const page = await res.text();
  for (const text of [
    '<a href="https://www.geonames.org/">GeoNames</a>',
    '<a href="https://www.geoboundaries.org/">geoBoundaries</a>',
    '<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>',
    "within 20 km",
    "within 500 km",
    "<td>Current and previous UTC day only</td>",
    "<td>Query coordinates and returned names</td><td>Not stored</td>",
    "Data retrieved 2026-09-24",
    "geoBoundariesCGAZ_ADM1.geojson: synthetic fixture",
    "22 UTF-16 code units and 22 code points",
    'href="https://github.com/vibecodedapps-official/reverse-geocoding/blob/main/docs/API.md"',
  ]) {
    expect(page).toContain(text);
  }
});
