import { exports } from "cloudflare:workers";
import { TEST_KEYS } from "../keys.ts";

export const ORIGIN = "https://reverse-geocoding.test";
export const MAIN_KEY = TEST_KEYS[0].key;
export const SMALL_KEY = TEST_KEYS[1].key;
export const FLORENCE = { latitude: 43.7731, longitude: 11.256, max_label_length: 50 };

export function fetchPath(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, init));
}

/** POSTs a lookup. A string body is sent as is; anything else is JSON-encoded. */
export function lookup(body: unknown, key: string | null = MAIN_KEY, headers: Record<string, string> = {}): Promise<Response> {
  return fetchPath("/v1/reverse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key === null ? {} : { Authorization: `Bearer ${key}` }),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export interface ErrorBody {
  status: string;
  request_id: string;
  error: { code: string; message: string; retryable: boolean; field?: string; retry_after_seconds?: number };
}
