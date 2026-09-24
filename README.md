# reverse-geocoding

A reverse geocoding service that turns a coordinate into a short place name at
locality, region, or country level. It never stores the coordinate or the
returned name, fits the label to a caller-declared maximum length, and grants
permanent storage of the result. Version 1 serves one customer from one server
key.

## What it does

The service is a Cloudflare Worker that holds the whole place index in memory.
It finds the country and region polygon that contain the point, then the
nearest settlement in that country. Within 20 km the answer names the
settlement; farther out it names the region or the country. A point in the open
sea gets `no_result`. Before anything else, the coordinate is truncated to at
most 4 decimal places.

```http
POST /v1/reverse HTTP/1.1
Authorization: Bearer pn_live_REDACTED
Content-Type: application/json

{ "latitude": 43.7731, "longitude": 11.2560, "precision": 3, "max_label_length": 50 }
```

```json
{
  "status": "ok",
  "request_id": "req_01J9Z0K7Q2M4X",
  "labels": { "short": "Florence, Italy" },
  "components": { "locality": "Florence", "admin1": null, "country": "Italy", "country_code": "IT" },
  "place": { "level": "locality", "distance_from_query_meters": 1046, "degraded_from": null },
  "query": { "precision_requested": 3, "precision_applied": 3, "max_label_length": 50 },
  "rights": {
    "service": { "storage": "permanent" },
    "data": {
      "license": "CC-BY-4.0",
      "attribution_text": "Place data from GeoNames and geoBoundaries, CC BY 4.0",
      "attribution_url": "https://reverse-geocoding.example/"
    }
  }
}
```

The full contract, including errors, the rate limit, the resolution order, and
the retention table, is in [docs/API.md](docs/API.md).

## Development

Requires Node 22.18 or later. Scripts run TypeScript directly with Node's type
stripping; there is no compile step.

```sh
npm install
npm run check        # typecheck, then the unit and Worker tests
```

`npm run check` runs against a small synthetic data set built from
`test/fixtures/sources`, so it needs no downloads.

The real index is built from GeoNames and geoBoundaries files pinned by
SHA-256 in `data/manifest.json`:

```sh
npm run data:pin     # download the current upstream files to data/raw and write new pins
npm run data:build   # verify the pins and write data/build/*.bin
npm run test:data    # calibration and edge fixtures against the real index
```

`npm run data:build` takes each pinned file from `data/raw` when its checksum
matches, and otherwise from the data archive. The archive release is not
published yet, so on a fresh clone run `npm run data:pin` first. GeoNames
replaces its files daily, so a fresh pin changes the checksums in
`data/manifest.json`, and the build may report new ADM1 polygons it cannot map
to a GeoNames region; those go in `data/admin1-overrides.csv`. Each row maps a
polygon to the GeoNames region whose name it matches, to the region most of its
settlements share, or to no region when it spans several, and says which in
its `reason` column.

The Worker imports `data/build/*.bin`, so `npm run dev` and a deploy need a
completed `npm run data:build`. API keys are read from the `KEYS` secret: a
JSON list of `{ "id", "sha256", "daily_limit" }`, where `sha256` is the hex
SHA-256 of the full key, `pn_live_` followed by 32 characters from
`[A-Za-z0-9]`.

## License

Code is licensed under Apache 2.0 (see [LICENSE](LICENSE)). The place data
comes from GeoNames and geoBoundaries under CC BY 4.0 (see [NOTICE](NOTICE)).
