import type { Components, Level } from "./api.ts";

/** Strips control characters, normalizes to NFC, and trims. */
export function cleanName(s: string): string {
  // Stripping first means a removed character cannot leave an unnormalized sequence behind.
  return s.replace(/\p{Cc}/gu, "").normalize("NFC").trim();
}

type Key = keyof Components;

const CANDIDATES: Record<Level, ReadonlyArray<readonly Key[]>> = {
  locality: [["locality", "country"], ["locality"], ["admin1", "country"], ["admin1"], ["country"], ["country_code"]],
  region: [["admin1", "country"], ["admin1"], ["country"], ["country_code"]],
  country: [["country"], ["country_code"]],
};

function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/**
 * The first candidate for the level that is at most maxLength both in UTF-16 code units and in
 * code points. Candidates are whole cleaned components joined by ", "; a candidate with a missing
 * or empty component is skipped.
 */
export function fitLabel(components: Components, level: Level, maxLength: number): string {
  const cleaned: Record<Key, string> = {
    locality: cleanName(components.locality ?? ""),
    admin1: cleanName(components.admin1 ?? ""),
    country: cleanName(components.country ?? ""),
    country_code: cleanName(components.country_code ?? ""),
  };
  for (const keys of CANDIDATES[level]) {
    const parts = keys.map((k) => cleaned[k]);
    if (parts.includes("")) continue;
    const label = parts.join(", ");
    if (label.length <= maxLength && codePoints(label) <= maxLength) return label;
  }
  throw new Error(`no label candidate for level ${level} fits in ${maxLength}`);
}
