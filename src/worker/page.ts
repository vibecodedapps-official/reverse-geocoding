import type { IndexMeta } from "../index/format.ts";
import { LOCALITY_THRESHOLD_KM, SEARCH_RADIUS_KM } from "../resolver/api.ts";

const CONTRACT_URL = "https://github.com/vibecodedapps-official/georeverse-svc/blob/main/docs/API.md";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

function dataSection(meta: IndexMeta | null): string {
  if (meta === null) return "<p>The data versions are unavailable: the place index failed to load.</p>";
  const sources = meta.sources.map((s) => `<li>${esc(s.name)}: ${esc(s.version)} (SHA-256 <code>${esc(s.sha256)}</code>)</li>`).join("\n");
  return `<p>Data retrieved ${esc(meta.dataDate)}, build <code>${esc(meta.buildId)}</code>.</p>
<ul>
${sources}
</ul>
<p>The longest place name in this data is ${esc(meta.longestComponentName.utf16)} UTF-16 code units and ${esc(meta.longestComponentName.codePoints)} code points. Component names in a response are no longer than that; the label is also bounded by <code>max_label_length</code>.</p>`;
}

/** The public page. meta is null when the index failed to load. */
export function publicPage(meta: IndexMeta | null): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>georeverse-svc</title>
</head>
<body>
<h1>georeverse-svc</h1>
<p>A reverse geocoding service. It turns a latitude and longitude into a short place name at locality, region, or country level. The coordinate is truncated to at most 4 decimal places before it is resolved, and neither the coordinate nor the returned name is stored.</p>
<p>A place is named at locality level when the nearest settlement in the same country is within ${esc(LOCALITY_THRESHOLD_KM)} km; otherwise the name is the region or the country. Settlements are searched within ${esc(SEARCH_RADIUS_KM)} km.</p>

<h2>Retention</h2>
<table>
<thead><tr><th>Data</th><th>Retention</th></tr></thead>
<tbody>
<tr><td>Request log lines: request id, key id, status or error code, place level, latency</td><td>The platform log retention: 3 days on Workers Free, 7 days on Workers Paid</td></tr>
<tr><td>Per-key daily counters</td><td>Current and previous UTC day only</td></tr>
<tr><td>Key id, key hash, daily limit</td><td>Until the key is revoked</td></tr>
<tr><td>Query coordinates and returned names</td><td>Not stored</td></tr>
</tbody>
</table>

<h2>Data</h2>
<p>Place data from <a href="https://www.geonames.org/">GeoNames</a> and <a href="https://www.geoboundaries.org/">geoBoundaries</a>, licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</p>
${dataSection(meta)}

<h2>API</h2>
<p>The request and response contract: <a href="${esc(CONTRACT_URL)}">docs/API.md</a>.</p>
</body>
</html>
`;
}
