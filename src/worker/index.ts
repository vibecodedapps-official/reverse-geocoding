import boundariesBin from "../../data/build/boundaries.bin";
import settlementsBin from "../../data/build/settlements.bin";
import { loadIndex, type GeoIndex } from "../index/format.ts";
import type { Level } from "../resolver/api.ts";
import { fitLabel } from "../resolver/fit.ts";
import { resolve } from "../resolver/resolve.ts";
import { authenticate, parseKeys, type KeyEntry } from "./auth.ts";
import { publicPage } from "./page.ts";
import { parseQuery } from "./parse.ts";
import { errorResponse, html, json, newRequestId, type ErrorCode, type ErrorDetail } from "./respond.ts";

export { DailyCounter } from "./counter.ts";

const MAX_BODY_BYTES = 1024;
const DAY_MS = 86_400_000;

type IndexState = { ok: true; index: GeoIndex } | { ok: false; reason: string };

// Decoded on first use rather than at startup, so a bad index fails requests instead of the deploy.
let indexState: IndexState | undefined;

function getIndex(): IndexState {
  if (indexState === undefined) {
    try {
      indexState = { ok: true, index: loadIndex(settlementsBin, boundariesBin) };
    } catch (e) {
      indexState = { ok: false, reason: e instanceof Error ? e.message : "unknown error" };
    }
  }
  return indexState;
}

let keysCache: { secret: string; keys: KeyEntry[] } | undefined;

/** The parsed KEYS secret, parsed again only when the secret changes. Throws like parseKeys. */
function getKeys(secret: string): KeyEntry[] {
  if (keysCache === undefined || keysCache.secret !== secret) keysCache = { secret, keys: parseKeys(secret) };
  return keysCache.keys;
}

/** What the request log line reports, filled in as the request moves through the handler. */
interface RequestState {
  id: string;
  keyId: string | null;
  status: string;
  level: Level | null;
}

function fail(r: RequestState, code: ErrorCode, message: string, detail?: ErrorDetail): Response {
  r.status = code;
  return errorResponse(r.id, code, message, detail);
}

function secondsToUtcMidnight(nowMs: number): number {
  return Math.ceil(((Math.floor(nowMs / DAY_MS) + 1) * DAY_MS - nowMs) / 1000);
}

/** The body, or null once it exceeds cap bytes. Holds at most cap bytes plus one chunk. */
async function readCapped(body: ReadableStream<Uint8Array> | null, cap: number): Promise<Uint8Array | null> {
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function isJsonType(header: string | null): boolean {
  return header !== null && header.split(";")[0]!.trim().toLowerCase() === "application/json";
}

async function reverse(request: Request, env: Cloudflare.Env, r: RequestState): Promise<Response> {
  const key = await authenticate(request.headers.get("Authorization"), getKeys(env.KEYS));
  if (key === null) {
    return fail(r, "invalid_key", "Missing, malformed, or unknown API key.", { headers: { "WWW-Authenticate": "Bearer" } });
  }
  r.keyId = key.id;

  const now = Date.now();
  const allowed = await env.COUNTER.get(env.COUNTER.idFromName(key.id)).hit(now, key.dailyLimit);
  if (!allowed) {
    const retryAfter = secondsToUtcMidnight(now);
    return fail(r, "rate_limited", "Daily request limit reached. The limit resets at 00:00 UTC.", {
      retryAfterSeconds: retryAfter,
      headers: { "Retry-After": String(retryAfter) },
    });
  }

  const state = getIndex();
  if (!state.ok) return fail(r, "internal", "The place index is unavailable.");

  const tooLarge = `The body must be at most ${MAX_BODY_BYTES} bytes.`;
  const length = request.headers.get("Content-Length");
  if (length !== null && Number(length) > MAX_BODY_BYTES) return fail(r, "request_too_large", tooLarge);
  const bytes = await readCapped(request.body, MAX_BODY_BYTES);
  if (bytes === null) return fail(r, "request_too_large", tooLarge);
  if (!isJsonType(request.headers.get("Content-Type"))) {
    return fail(r, "invalid_request", "Content-Type must be application/json.");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return fail(r, "invalid_request", "The body is not valid UTF-8.");
  }

  const parsed = parseQuery(text);
  if (!parsed.ok) {
    const { code, message, field } = parsed.error;
    return fail(r, code, message, field === undefined ? {} : { field });
  }
  const q = parsed.query;
  const result = resolve(state.index, q.latE5, q.lonE5);

  const query = { precision_requested: q.precision, precision_applied: q.precision, max_label_length: q.maxLabelLength };
  const rights = {
    service: { storage: "permanent" },
    data: {
      license: "CC-BY-4.0",
      attribution_text: "Place data from GeoNames and geoBoundaries, CC BY 4.0",
      attribution_url: `${new URL(request.url).origin}/`,
    },
  };
  if (result.status === "no_result") {
    r.status = "no_result";
    return json(r.id, {
      status: "no_result",
      request_id: r.id,
      labels: null,
      components: null,
      place: { level: null, distance_from_query_meters: result.distanceMeters, degraded_from: null },
      query,
      rights,
    });
  }
  const label = fitLabel(result.components, result.level, q.maxLabelLength);
  r.status = "ok";
  r.level = result.level;
  return json(r.id, {
    status: "ok",
    request_id: r.id,
    labels: { short: label },
    components: result.components,
    place: { level: result.level, distance_from_query_meters: result.distanceMeters, degraded_from: result.degradedFrom },
    query,
    rights,
  });
}

function healthz(env: Cloudflare.Env, r: RequestState): Response {
  const state = getIndex();
  if (!state.ok) return fail(r, "internal", `The place index failed to load: ${state.reason}`);
  try {
    getKeys(env.KEYS);
  } catch {
    // The parse error can quote the secret.
    return fail(r, "internal", "The KEYS secret is missing or malformed.");
  }
  const { meta } = state.index;
  r.status = "ok";
  return json(r.id, {
    status: "ok",
    request_id: r.id,
    data: {
      build_id: meta.buildId,
      data_date: meta.dataDate,
      sources: meta.sources.map((s) => ({ name: s.name, version: s.version, sha256: s.sha256 })),
    },
  });
}

function page(r: RequestState): Response {
  const state = getIndex();
  r.status = "ok";
  return html(r.id, publicPage(state.ok ? state.index.meta : null));
}

async function route(request: Request, env: Cloudflare.Env, r: RequestState): Promise<Response> {
  const { pathname, protocol } = new URL(request.url);
  // Refused rather than redirected: by now the key and the coordinate have already crossed in the clear.
  if (protocol !== "https:") return fail(r, "https_required", "Use HTTPS.");
  if (pathname === "/v1/reverse") {
    if (request.method !== "POST") return fail(r, "method_not_allowed", "Use POST.", { headers: { Allow: "POST" } });
    return reverse(request, env, r);
  }
  if (pathname === "/" || pathname === "/healthz") {
    if (request.method !== "GET") return fail(r, "method_not_allowed", "Use GET.", { headers: { Allow: "GET" } });
    return pathname === "/" ? page(r) : healthz(env, r);
  }
  return fail(r, "not_found", "No such path.");
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const started = Date.now();
    const r: RequestState = { id: newRequestId(), keyId: null, status: "internal", level: null };
    let response: Response;
    try {
      response = await route(request, env, r);
    } catch (e) {
      // Only the exception class: a message can quote data.
      console.error(JSON.stringify({ request_id: r.id, exception: e instanceof Error ? e.name : typeof e }));
      r.status = "internal";
      r.level = null;
      response = errorResponse(r.id, "internal", "Internal error.");
    }
    console.log(
      JSON.stringify({ request_id: r.id, key_id: r.keyId, status: r.status, level: r.level, latency_ms: Date.now() - started }),
    );
    return response;
  },
} satisfies ExportedHandler<Cloudflare.Env>;
