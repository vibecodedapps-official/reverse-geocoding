export interface KeyEntry {
  id: string;
  sha256: Uint8Array;
  dailyLimit: number;
}

const BEARER = /^Bearer (pn_live_[A-Za-z0-9]{32})$/;
const HEX64 = /^[0-9a-f]{64}$/i;

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** Parses the KEYS secret. Throws if it is not a list of well-formed entries. */
export function parseKeys(secret: string): KeyEntry[] {
  const list: unknown = JSON.parse(secret);
  if (!Array.isArray(list)) throw new Error("KEYS is not a JSON list");
  return list.map((e: unknown) => {
    const { id, sha256, daily_limit } = (e ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || id === "") throw new Error("KEYS entry has no id");
    if (typeof sha256 !== "string" || !HEX64.test(sha256)) throw new Error(`KEYS entry ${id} has no 64-digit hex sha256`);
    if (typeof daily_limit !== "number" || !Number.isInteger(daily_limit) || daily_limit < 0) {
      throw new Error(`KEYS entry ${id} has no non-negative integer daily_limit`);
    }
    return { id, sha256: hexBytes(sha256), dailyLimit: daily_limit };
  });
}

/**
 * The key entry matching the Authorization header, or null for a missing, malformed, or unknown
 * key. Every entry is compared, in constant time, so the timing does not reveal which one matched.
 */
export async function authenticate(header: string | null, keys: readonly KeyEntry[]): Promise<KeyEntry | null> {
  const key = header === null ? undefined : BEARER.exec(header)?.[1];
  if (key === undefined) return null;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  let found: KeyEntry | null = null;
  for (const entry of keys) {
    if (crypto.subtle.timingSafeEqual(digest, entry.sha256) && found === null) found = entry;
  }
  return found;
}
