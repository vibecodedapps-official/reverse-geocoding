import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FLORENCE, SMALL_KEY, lookup, type ErrorBody } from "./request.ts";

// key_small allows 3 requests per UTC day. Each test uses its own dates, so counts never carry
// over between tests. The dates are in the future, so a cleanup alarm fires only when a test runs it.

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function statuses(count: number, body: unknown = FLORENCE): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((await lookup(body, SMALL_KEY)).status);
  return out;
}

it("lets exactly the limit through when requests arrive concurrently", async () => {
  vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
  const results = await Promise.all(Array.from({ length: 6 }, () => lookup(FLORENCE, SMALL_KEY)));
  const counts = results.map((r) => r.status).sort();
  expect(counts).toEqual([200, 200, 200, 429, 429, 429]);
});

it("answers over the limit with 429 and the seconds until UTC midnight", async () => {
  vi.setSystemTime(new Date("2030-03-02T23:59:59Z"));
  expect(await statuses(3)).toEqual([200, 200, 200]);
  const res = await lookup(FLORENCE, SMALL_KEY);
  expect(res.status).toBe(429);
  expect(res.headers.get("Retry-After")).toBe("1");
  const body = (await res.json()) as ErrorBody;
  expect(body.error).toEqual({
    code: "rate_limited",
    message: "Daily request limit reached. The limit resets at 00:00 UTC.",
    retryable: true,
    retry_after_seconds: 1,
  });
});

it("counts a request at 00:00:00 UTC against the new day", async () => {
  vi.setSystemTime(new Date("2030-03-03T23:59:59Z"));
  expect(await statuses(4)).toEqual([200, 200, 200, 429]);
  vi.setSystemTime(new Date("2030-03-04T00:00:00Z"));
  expect(await statuses(1)).toEqual([200]);
});

it("counts a request whose body is rejected", async () => {
  vi.setSystemTime(new Date("2030-03-05T08:00:00Z"));
  expect(await statuses(3, "{not json")).toEqual([400, 400, 400]);
  expect(await statuses(1)).toEqual([429]);
});

it("keeps only the current and previous UTC day", async () => {
  for (const day of ["2030-03-10", "2030-03-11", "2030-03-12"]) {
    vi.setSystemTime(new Date(`${day}T10:00:00Z`));
    await statuses(1);
  }
  const stub = env.COUNTER.get(env.COUNTER.idFromName("key_small"));
  const days = await runInDurableObject(stub, (_, state) =>
    state.storage.sql.exec<{ day: number }>("SELECT day FROM counts ORDER BY day").toArray().map((r) => r.day),
  );
  // 2030-03-11 and 2030-03-12 as days since the epoch.
  expect(days).toEqual([21984, 21985]);
});

function tables(stub: DurableObjectStub): Promise<string[]> {
  return runInDurableObject(stub, (_, state) =>
    state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((r) => r.name),
  );
}

it("deletes each day once it is no longer the current or previous UTC day, then all storage", async () => {
  const stub = env.COUNTER.get(env.COUNTER.idFromName("cleanup_days"));
  await stub.hit(Date.parse("2030-01-10T10:00:00Z"), 3);
  await stub.hit(Date.parse("2030-01-11T10:00:00Z"), 3);
  const alarm = (): Promise<number | null> => runInDurableObject(stub, (_, state) => state.storage.getAlarm());
  // 2030-01-12T00:00:00Z.
  expect(await alarm()).toBe(1894406400000);

  vi.setSystemTime(new Date("2030-01-12T00:00:00Z"));
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  const days = await runInDurableObject(stub, (_, state) =>
    state.storage.sql.exec<{ day: number }>("SELECT day FROM counts ORDER BY day").toArray().map((r) => r.day),
  );
  // 2030-01-11 as days since the epoch.
  expect(days).toEqual([21925]);
  // 2030-01-13T00:00:00Z.
  expect(await alarm()).toBe(1894492800000);

  vi.setSystemTime(new Date("2030-01-13T00:00:00Z"));
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  expect(await tables(stub)).toEqual([]);
  expect(await alarm()).toBeNull();
});

it("counts from one again after its storage was deleted", async () => {
  const stub = env.COUNTER.get(env.COUNTER.idFromName("cleanup_restart"));
  await stub.hit(Date.parse("2030-01-20T10:00:00Z"), 1);
  vi.setSystemTime(new Date("2030-01-22T00:00:00Z"));
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  expect(await tables(stub)).toEqual([]);
  const now = Date.parse("2030-01-22T10:00:00Z");
  expect([await stub.hit(now, 1), await stub.hit(now, 1)]).toEqual([true, false]);
});
