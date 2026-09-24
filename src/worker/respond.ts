export type ErrorCode =
  | "invalid_coordinate"
  | "precision_too_high"
  | "unexpected_field"
  | "invalid_request"
  | "invalid_key"
  | "not_found"
  | "method_not_allowed"
  | "request_too_large"
  | "rate_limited"
  | "internal";

const ERRORS: Record<ErrorCode, { http: number; retryable: boolean }> = {
  invalid_coordinate: { http: 400, retryable: false },
  precision_too_high: { http: 400, retryable: false },
  unexpected_field: { http: 400, retryable: false },
  invalid_request: { http: 400, retryable: false },
  invalid_key: { http: 401, retryable: false },
  not_found: { http: 404, retryable: false },
  method_not_allowed: { http: 405, retryable: false },
  request_too_large: { http: 413, retryable: false },
  rate_limited: { http: 429, retryable: true },
  internal: { http: 500, retryable: true },
};

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** "req_" and 13 random Crockford base32 characters. */
export function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(13));
  let id = "req_";
  for (const b of bytes) id += CROCKFORD[b & 31];
  return id;
}

export function json(requestId: string, body: object, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}

export function html(requestId: string, body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Request-Id": requestId },
  });
}

export interface ErrorDetail {
  field?: string;
  retryAfterSeconds?: number;
  headers?: Record<string, string>;
}

export function errorResponse(requestId: string, code: ErrorCode, message: string, detail: ErrorDetail = {}): Response {
  const { http, retryable } = ERRORS[code];
  const error: Record<string, unknown> = { code, message, retryable };
  if (detail.field !== undefined) error.field = detail.field;
  if (detail.retryAfterSeconds !== undefined) error.retry_after_seconds = detail.retryAfterSeconds;
  return json(requestId, { status: "error", request_id: requestId, error }, http, detail.headers);
}
