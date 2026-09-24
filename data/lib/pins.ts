// Pinned source files: data/manifest.json, checksums, and downloads streamed to disk.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { SourcePin } from "./build-index.ts";

export interface Pin extends SourcePin {
  upstream_url: string;
  archive_url: string;
}

export interface PinManifest {
  /** Release download URL of the write-once archive; an asset is named by its SHA-256. */
  archive_base_url: string;
  files: Pin[];
}

const PIN_FIELDS = ["name", "source", "upstream_url", "retrieved", "version", "sha256", "archive_url"] as const;

export function readPinManifest(path: string): PinManifest {
  const m = JSON.parse(readFileSync(path, "utf8")) as PinManifest;
  if (typeof m.archive_base_url !== "string" || !Array.isArray(m.files)) throw new Error(`${path}: expected { archive_base_url, files }`);
  for (const f of m.files) {
    for (const k of PIN_FIELDS) if (typeof f[k] !== "string" || f[k] === "") throw new Error(`${path}: pin ${f.name ?? "?"} has no ${k}`);
    if (f.source !== "geonames" && f.source !== "geoboundaries") throw new Error(`${path}: pin ${f.name} has unknown source ${f.source}`);
    if (!/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error(`${path}: pin ${f.name} has a malformed sha256`);
  }
  return m;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export type Fetch = (url: string) => Promise<Response>;

/** Streams url to dest through a temporary file and returns the SHA-256 of what arrived. */
export async function download(url: string, dest: string, fetchImpl: Fetch = fetch): Promise<{ sha256: string; bytes: number }> {
  const res = await fetchImpl(url);
  if (!res.ok || !res.body) throw new Error(`GET ${url}: HTTP ${res.status}`);
  const hash = createHash("sha256");
  let bytes = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      hash.update(chunk);
      bytes += chunk.length;
      done(null, chunk);
    },
  });
  const tmp = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), tap, createWriteStream(tmp));
    renameSync(tmp, dest);
  } finally {
    rmSync(tmp, { force: true });
  }
  return { sha256: hash.digest("hex"), bytes };
}

/**
 * Makes rawDir/<pin.name> hold the pinned bytes: keeps a local copy whose checksum matches,
 * else fetches the archive copy. Any mismatch throws and leaves no file behind.
 */
export async function ensurePinned(pin: Pin, rawDir: string, fetchImpl: Fetch = fetch): Promise<string> {
  const path = join(rawDir, pin.name);
  if (existsSync(path)) {
    const local = await sha256File(path);
    if (local === pin.sha256) return path;
    console.log(`${pin.name}: local copy has SHA-256 ${local}, pin expects ${pin.sha256}; fetching the archive copy`);
  }
  const got = await download(pin.archive_url, path, fetchImpl);
  if (got.sha256 !== pin.sha256) {
    rmSync(path, { force: true });
    throw new Error(`${pin.name}: archive copy ${pin.archive_url} has SHA-256 ${got.sha256}, pin expects ${pin.sha256}`);
  }
  return path;
}
