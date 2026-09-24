import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import worker from "../../src/worker/index.ts";
import { REVOKED_KEY } from "../keys.ts";
import { FLORENCE, MAIN_KEY, ORIGIN, fetchPath, lookup, type ErrorBody } from "./request.ts";

const REQUEST_ID = /^req_[0-9A-HJKMNP-TV-Z]{13}$/;

let log: MockInstance<typeof console.log>;
let errorLog: MockInstance<typeof console.error>;

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function expectError(res: Response, http: number, code: string, field?: string): Promise<ErrorBody> {
  expect(res.status).toBe(http);
  expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  const body = (await res.json()) as ErrorBody;
  expect(body.status).toBe("error");
  expect(body.request_id).toMatch(REQUEST_ID);
  expect(res.headers.get("X-Request-Id")).toBe(body.request_id);
  expect(body.error.code).toBe(code);
  expect(body.error.retryable).toBe(code === "internal" || code === "rate_limited");
  expect(body.error.field).toBe(field);
  return body;
}

const RIGHTS = {
  service: { storage: "permanent" },
  data: {
    license: "CC-BY-4.0",
    attribution_text: "Place data from GeoNames and geoBoundaries, CC BY 4.0",
    attribution_url: `${ORIGIN}/`,
  },
};

describe("POST /v1/reverse", () => {
  it("names Florence, then refuses the same request with a revoked key", async () => {
    const res = await lookup(FLORENCE);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { request_id: string };
    expect(body.request_id).toMatch(REQUEST_ID);
    expect(res.headers.get("X-Request-Id")).toBe(body.request_id);
    expect(body).toEqual({
      status: "ok",
      request_id: body.request_id,
      labels: { short: "Florence, Italy" },
      components: { locality: "Florence", admin1: "Tuscany", country: "Italy", country_code: "IT" },
      place: { level: "locality", distance_from_query_meters: 1046, degraded_from: null },
      query: { precision_requested: 3, precision_applied: 3, max_label_length: 50 },
      rights: RIGHTS,
    });

    const revoked = await lookup(FLORENCE, REVOKED_KEY);
    await expectError(revoked, 401, "invalid_key");
    expect(revoked.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("returns no_result at latitude 0, longitude 0", async () => {
    const res = await lookup({ latitude: 0, longitude: 0, precision: 1 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { request_id: string };
    expect(body).toEqual({
      status: "no_result",
      request_id: body.request_id,
      labels: null,
      components: null,
      place: { level: null, distance_from_query_meters: null, degraded_from: null },
      query: { precision_requested: 1, precision_applied: 1, max_label_length: 120 },
      rights: RIGHTS,
    });
  });

  it("fits the label to max_label_length", async () => {
    const res = await lookup({ ...FLORENCE, max_label_length: 8 });
    expect(((await res.json()) as { labels: { short: string } }).labels.short).toBe("Florence");
  });

  it.each([
    ["latitude", 90.00009, "-90 to 90"],
    ["latitude", -90.00009, "-90 to 90"],
    ["longitude", 180.00001, "-180 to 180"],
    ["longitude", -180.00001, "-180 to 180"],
  ])("rejects %s %s before truncating it", async (field, value, range) => {
    const res = await lookup({ latitude: 0, longitude: 0, precision: 3, [field]: value });
    const body = await expectError(res, 400, "invalid_coordinate", field);
    expect(body.error.message).toContain(range);
  });

  it.each([
    [90, 0],
    [-90, 0],
    [0, 180],
    [0, -180],
  ])("accepts latitude %s, longitude %s", async (latitude, longitude) => {
    expect((await lookup({ latitude, longitude, precision: 3 })).status).toBe(200);
  });

  it("rejects a coordinate too large to represent as not finite", async () => {
    await expectError(await lookup('{"latitude": 1e400, "longitude": 0}'), 400, "invalid_coordinate", "latitude");
  });

  it("rejects precision 5 and states the maximum", async () => {
    const body = await expectError(await lookup({ ...FLORENCE, precision: 5 }), 400, "precision_too_high", "precision");
    expect(body.error.message).toBe('Field "precision" must be at most 4.');
  });

  it("names an unexpected field and the allowed fields", async () => {
    const body = await expectError(await lookup({ ...FLORENCE, subject: "user-42" }), 400, "unexpected_field", "subject");
    expect(body.error.message).toBe('Unexpected field "subject". Allowed fields: latitude, longitude, precision, max_label_length.');
  });

  it.each([
    ["malformed JSON", '{"latitude": ', undefined],
    ["a JSON array", "[43.7, 11.2]", undefined],
    ["an empty body", "", undefined],
    ["a missing latitude", { longitude: 11.2 }, "latitude"],
    ["a string longitude", { latitude: 43.7, longitude: "11.2" }, "longitude"],
    ["a negative precision", { ...FLORENCE, precision: -1 }, "precision"],
    ["a fractional precision", { ...FLORENCE, precision: 2.5 }, "precision"],
    ["max_label_length 7", { ...FLORENCE, max_label_length: 7 }, "max_label_length"],
    ["max_label_length 201", { ...FLORENCE, max_label_length: 201 }, "max_label_length"],
  ])("rejects %s as invalid_request", async (_, body, field) => {
    await expectError(await lookup(body), 400, "invalid_request", field);
  });

  it.each([
    ["text/plain", { "Content-Type": "text/plain" }],
    ["an empty Content-Type", { "Content-Type": "" }],
  ])("rejects %s as invalid_request", async (_, headers) => {
    await expectError(await lookup(FLORENCE, MAIN_KEY, headers), 400, "invalid_request");
  });

  it("accepts a charset parameter on the Content-Type", async () => {
    expect((await lookup(FLORENCE, MAIN_KEY, { "Content-Type": "application/json; charset=utf-8" })).status).toBe(200);
  });

  it("rejects a body by its Content-Length without reading it", async () => {
    // Never closes, so the request only completes if the body is not read.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
      },
    });
    const res = await fetchPath("/v1/reverse", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "2000", Authorization: `Bearer ${MAIN_KEY}` },
      body: stream,
    });
    await expectError(res, 413, "request_too_large");
  });

  it("rejects a streamed body over 1024 bytes that has no Content-Length", async () => {
    const chunk = new TextEncoder().encode(" ".repeat(600));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const res = await fetchPath("/v1/reverse", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${MAIN_KEY}` },
      body: stream,
    });
    await expectError(res, 413, "request_too_large");
  });

  it.each([
    ["a missing key", null],
    ["a malformed key", "pn_live_short"],
    ["a revoked key", REVOKED_KEY],
  ])("rejects %s with WWW-Authenticate", async (_, key) => {
    const res = await lookup(FLORENCE, key);
    await expectError(res, 401, "invalid_key");
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("answers 500 internal and logs only the exception class when the key list cannot be read", async () => {
    const request = new Request(`${ORIGIN}/v1/reverse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${MAIN_KEY}` },
      body: JSON.stringify(FLORENCE),
    });
    const res = await worker.fetch(request, { ...env, KEYS: "not json" });
    const body = await expectError(res, 500, "internal");
    expect(errorLog.mock.calls).toEqual([[JSON.stringify({ request_id: body.request_id, exception: "SyntaxError" })]]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({ request_id: body.request_id, status: "internal" });
  });
});

describe("routing", () => {
  it("answers an unknown path with 404 not_found", async () => {
    await expectError(await fetchPath("/v2/reverse"), 404, "not_found");
  });

  it("answers another method on /v1/reverse with 405 and Allow: POST", async () => {
    const res = await fetchPath("/v1/reverse");
    await expectError(res, 405, "method_not_allowed");
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it.each(["/", "/healthz"])("answers POST %s with 405 and Allow: GET", async (path) => {
    const res = await fetchPath(path, { method: "POST" });
    await expectError(res, 405, "method_not_allowed");
    expect(res.headers.get("Allow")).toBe("GET");
  });
});

describe("logging", () => {
  it("writes one line with exactly the five fields", async () => {
    const res = await lookup(FLORENCE);
    const { request_id } = (await res.json()) as { request_id: string };
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(log.mock.calls[0]![0])) as Record<string, unknown>;
    expect(Object.keys(line).sort()).toEqual(["key_id", "latency_ms", "level", "request_id", "status"]);
    expect(line).toMatchObject({ request_id, key_id: "key_main", status: "ok", level: "locality" });
    expect(typeof line.latency_ms).toBe("number");
  });

  it("logs a null key id and the error code for an unauthenticated request", async () => {
    await lookup(FLORENCE, null);
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({ key_id: null, status: "invalid_key", level: null });
  });
});

describe("request values", () => {
  // Short, because a JSON syntax error quotes only a few characters around the fault.
  const MARKER = "zqmark";
  const authorized = { "Content-Type": "application/json", Authorization: `Bearer ${MAIN_KEY}` };

  it.each([
    ["an unexpected field's value", () => lookup({ ...FLORENCE, note: MARKER })],
    ["a malformed body", () => lookup(`{"latitude": ${MARKER}`)],
    ["an unterminated string", () => lookup(`{"latitude": "${MARKER}`)],
    ["a coordinate string", () => lookup({ latitude: MARKER, longitude: 11.2 })],
    ["a lookup's query string", () => fetchPath(`/v1/reverse?q=${MARKER}`, { method: "POST", headers: authorized, body: JSON.stringify(FLORENCE) })],
    ["an unknown path", () => fetchPath(`/${MARKER}?q=${MARKER}`)],
    ["the key header", () => lookup(FLORENCE, MARKER)],
  ])("never appear in a response or a log line: %s", async (_, send) => {
    const res = await send();
    expect(await res.text()).not.toContain(MARKER);
    for (const [, value] of res.headers) expect(value).not.toContain(MARKER);
    const calls = [...log.mock.calls, ...errorLog.mock.calls];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) for (const arg of call) expect(String(arg)).not.toContain(MARKER);
  });
});
