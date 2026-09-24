import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FLORENCE, fetchPath, lookup, type ErrorBody } from "./request.ts";

// A build whose index file is not an index at all.
vi.mock("../../data/build/settlements.bin", () => ({ default: new ArrayBuffer(16) }));

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("answers every lookup with 500 internal", async () => {
  const res = await lookup(FLORENCE);
  expect(res.status).toBe(500);
  expect(((await res.json()) as ErrorBody).error).toEqual({
    code: "internal",
    message: "The place index is unavailable.",
    retryable: true,
  });
});

it("reports the failure on /healthz", async () => {
  const res = await fetchPath("/healthz");
  expect(res.status).toBe(500);
  expect(((await res.json()) as ErrorBody).error).toEqual({
    code: "internal",
    message: "The place index failed to load: settlements index has a bad magic number",
    retryable: true,
  });
});

it("still serves the public page, with the versions unavailable", async () => {
  const res = await fetchPath("/");
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("The data versions are unavailable");
});
