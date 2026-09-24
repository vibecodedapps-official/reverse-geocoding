# georeverse-svc API, version 1

This is the wire contract for version 1. Anything not in this document is not in version 1.

## What it does

One endpoint turns a WGS84 coordinate into a place name at locality, region, or country level.
The service validates and truncates the coordinate before doing anything else, never writes the
coordinate or the returned name anywhere durable, fits the label to a caller-declared maximum
length, and grants the caller permanent storage of the result.

Version 1 serves one customer from one server-side key. There is no signup, no billing, no
browser key, no batch endpoint, and no language selection.

## Endpoints

| Method and path | Purpose |
|---|---|
| `POST /v1/reverse` | One coordinate to one place name |
| `GET /healthz` | Liveness and the loaded data versions. No auth |
| `GET /` | The public page: data credit, retention table, and a link to this contract. No auth |

Every other path returns `404 not_found`. Any other method on `/v1/reverse` returns
`405 method_not_allowed` with `Allow: POST`; any other method on `/` or `/healthz` returns
`405 method_not_allowed` with `Allow: GET`. The lookup is `POST` only, so a coordinate never
lands in a URL, an access log, a `Referer` header, or a browser history.

Plaintext HTTP is not served. TLS 1.2 is the minimum.

## Authentication

```http
Authorization: Bearer pn_live_<random>
```

- A key is `pn_live_` followed by 32 characters from `[A-Za-z0-9]`. The prefix exists so secret
  scanners can match a leaked key.
- The header must be exactly `Bearer`, one space, and the key. The scheme is case-sensitive.
- Keys are created by hand. The server stores a key id, the SHA-256 of the key, and the key's
  daily limit. It never stores the key itself.
- A missing, malformed, or unknown key returns `401 invalid_key` with `WWW-Authenticate: Bearer`.
- Rotation: add the new key's hash beside the old one, deploy, switch the caller, remove the old
  hash, deploy. Two keys can be live at once.

## Request

```http
POST /v1/reverse HTTP/1.1
Authorization: Bearer pn_live_REDACTED
Content-Type: application/json

{ "latitude": 43.7731, "longitude": 11.2560, "precision": 3, "max_label_length": 50 }
```

| Field | Type | Default | Rule |
|---|---|---|---|
| `latitude` | number | required | -90 to 90 inclusive, checked on the submitted value before truncation. Out of range or not finite: `400 invalid_coordinate` |
| `longitude` | number | required | -180 to 180 inclusive, checked the same way. Same error. -180 and 180 name the same meridian and resolve identically |
| `precision` | integer | 3 | 0 to 4. Decimal places kept, truncated toward zero, never rounded. 5 or more: `400 precision_too_high`. Negative or not an integer: `400 invalid_request` |
| `max_label_length` | integer | 120 | 8 to 200. Outside the range or not an integer: `400 invalid_request` |

Any other property returns `400 unexpected_field`. The schema is closed: the server rejects
every property not in the table above. The error names the offending field and never echoes its
value, because an unexpected field is exactly where an email address or a user id would arrive.
When a body has several unexpected fields, the error names one of them.

The body must be a JSON object of at most 1024 bytes, encoded as UTF-8, with
`Content-Type: application/json`. A larger body is `413 request_too_large`, whether its
`Content-Length` says so or the body turns out larger while it is read. A missing or different
`Content-Type`, a body that is not valid UTF-8, a body that does not parse as a JSON object, a
missing required field, or a field of the wrong type is `400 invalid_request`.

The parser checks each coordinate's type, finiteness, and range on the submitted value first, so
90.00009 is rejected even though it would truncate to 90.000. Only then does it truncate. The
parser returns only the truncated values, so nothing downstream of it, including resolution and
logging, ever sees the full-precision value. JSON numbers too large to represent, such as `1e400`,
parse as infinite and are rejected as not finite.

Authentication and the daily counter read only the `Authorization` header and run before the body
is read, so a malformed body still counts as an attempt.

## Response

Every response from `/v1/reverse`, `/healthz`, and the `404` and `405` errors is
`application/json; charset=utf-8` with `Cache-Control: no-store` and an `X-Request-Id` header
equal to `request_id` in the body. `GET /` is the one exception: it returns
`text/html; charset=utf-8` with an `X-Request-Id` header and no JSON envelope.

A request id is `req_` followed by 13 characters from the Crockford base32 alphabet.

### `ok`

`HTTP 200`.

```json
{
  "status": "ok",
  "request_id": "req_01J9Z0K7Q2M4X",
  "labels": { "short": "Florence, Italy" },
  "components": {
    "locality": "Florence",
    "admin1": null,
    "country": "Italy",
    "country_code": "IT"
  },
  "place": {
    "level": "locality",
    "distance_from_query_meters": 1046,
    "degraded_from": null
  },
  "query": { "precision_requested": 3, "precision_applied": 3, "max_label_length": 50 },
  "rights": {
    "service": { "storage": "permanent" },
    "data": {
      "license": "CC-BY-4.0",
      "attribution_text": "Place data from GeoNames and geoBoundaries, CC BY 4.0",
      "attribution_url": "https://georeverse.example/"
    }
  }
}
```

`admin1` is `null` in this example because the boundary data divides Italy into five statistical
macro-regions, none of which is a single GeoNames region. See `components` below.

**`labels.short` is a guarantee.** After NFC normalization and trimming, it is at most
`max_label_length` counted as UTF-16 code units and at most `max_label_length` counted as Unicode
code points. It is never empty and never whitespace only. It is built from whole components
joined by `", "` and is never cut inside a component. Control characters are stripped. It is a
plain string, never HTML or markdown, and callers should treat it as third-party data.

**Composition.** The first candidate that fits wins. A candidate that includes a component the
response does not have (`null`) is skipped.

| `place.level` | Candidates, in order |
|---|---|
| `locality` | `locality, country` then `locality` then `admin1, country` then `admin1` then `country` then `country_code` |
| `region` | `admin1, country` then `admin1` then `country` then `country_code` |
| `country` | `country` then `country_code` |

`country_code` is two ASCII letters, so a label always exists at the minimum length of 8. Falling
through to a shorter candidate does not change `place.level`; the level describes what was
resolved, not what fit.

**`components`** always has all four keys. A key is `null` when that component is not resolved.
Names are the GeoNames `name` column for settlements, `admin1CodesASCII` for regions, and
`countryInfo` for countries. A region comes from the geoBoundaries ADM1 polygon that contains the
point. Its name is the GeoNames region that polygon is mapped to when the data is built: the
region code shared by at least 80 percent of the settlements inside the polygon, or a reviewed
override. A polygon that corresponds to no single GeoNames region, such as a statistical
macro-region that spans several, is mapped to none, and `admin1` is then `null`.

Component names get the same cleaning as the label: NFC normalization, control characters
stripped, trimmed. They are **not** bounded by `max_label_length`; a component can be longer than
the label that was fitted from it. Their length is bounded by the longest name in the loaded
data, which the public page states.

Version 1 returns whatever GeoNames calls the place, which for most well-known places is the
English name. A later version that adds a `language` field will define this version 1 behavior
as the default, so the default will not change under an existing caller.

**`place.level`** is one of `locality`, `region`, `country`. `distance_from_query_meters` is the
great-circle distance in whole meters from the truncated query point to the named settlement when
the level is `locality`, and to the nearest settlement inside the resolved country otherwise. The
search radius is 500 km; when no settlement lies within it the value is `null`. `degraded_from` is
`"locality"` when the label was lowered because the nearest in-country settlement was beyond the
locality threshold, else `null`.

**`query`** echoes the precision and label length used. `precision_applied` is always equal to
`precision_requested` in version 1.

**`rights`** is constant apart from `attribution_url`, which is the origin the request was sent
to followed by `/`, the public page. It has two parts. `rights.service` holds the service's own
terms: the caller may store results permanently. `rights.data` states the upstream license. It
does not restrict what the caller does with the data, because CC BY 4.0 forbids adding
restrictions on the licensed rights, and it does not waive attribution, because the service
cannot waive an obligation it does not own. This contract makes no statement on whether a caller
who republishes results must credit GeoNames and geoBoundaries; the public page carries the
credit.

### `no_result`

`HTTP 200`. Ocean and unmapped coordinates legitimately resolve to nothing, and this is not an
error. Latitude 0, longitude 0 is documented to return `no_result` forever and is the fixed test
query.

```json
{
  "status": "no_result",
  "request_id": "req_01J9Z0MC4T8QF",
  "labels": null,
  "components": null,
  "place": { "level": null, "distance_from_query_meters": null, "degraded_from": null },
  "query": { "precision_requested": 3, "precision_applied": 3, "max_label_length": 50 },
  "rights": { "...": "same block as in ok" }
}
```

`distance_from_query_meters` is the distance to the nearest settlement in any country when one
lies within the 500 km search radius, else `null`.

### Errors

```json
{
  "status": "error",
  "request_id": "req_01J9Z0P1Y6VBN",
  "error": {
    "code": "unexpected_field",
    "message": "Unexpected field \"subject\". Allowed fields: latitude, longitude, precision, max_label_length.",
    "retryable": false,
    "field": "subject"
  }
}
```

| HTTP | `error.code` | `retryable` | Notes |
|---|---|---|---|
| 400 | `invalid_coordinate` | false | `field` names `latitude` or `longitude` and the message states the accepted range |
| 400 | `precision_too_high` | false | Message states the maximum of 4 |
| 400 | `unexpected_field` | false | `field` names the property. The value is never included |
| 400 | `invalid_request` | false | Wrong or missing `Content-Type`, invalid UTF-8, malformed JSON, wrong type, missing required field, `precision` negative or not an integer, `max_label_length` out of range. `field` is set when one field is at fault |
| 401 | `invalid_key` | false | `WWW-Authenticate: Bearer` |
| 404 | `not_found` | false | |
| 405 | `method_not_allowed` | false | `Allow: POST` on `/v1/reverse`, `Allow: GET` on `/` and `/healthz` |
| 413 | `request_too_large` | false | |
| 429 | `rate_limited` | true | `Retry-After` in seconds until the next UTC midnight; the same number in `error.retry_after_seconds` |
| 500 | `internal` | true | Also returned while the place index cannot be loaded, and when the counter cannot be reached |

No error message ever contains a value from the request body. Error paths, including uncaught
exceptions, log the request id and the code or exception class, never the body.

### `GET /healthz`

`HTTP 200` with the versions of the loaded data:

```json
{
  "status": "ok",
  "request_id": "req_01J9Z0R3D5K8W",
  "data": {
    "build_id": "454cd8dc1b93b47d",
    "data_date": "2026-09-24",
    "sources": [
      { "name": "cities500.zip", "version": "2026-09-24", "sha256": "6ec75fdc8a46372f5f81b3d1431ece9afdccc98153b26ed58d01b59a24a6c259" },
      { "name": "geoBoundariesCGAZ_ADM1.geojson", "version": "v6.0.0 (1289e40e366c7b320550be1ee0614a9472d572d4)", "sha256": "f77bb14b78ccbebb48f9eeeffaba1a0b0c395d9d1cf503d1243b5ac4ccecee3f" }
    ]
  }
}
```

`sources` has one entry per pinned source file; the example shows two of the five. When the place
index cannot be loaded, `/healthz` returns `500 internal` with the reason in `error.message`. When
the key list cannot be read, it returns `500 internal` with the message `The KEYS secret is
missing or malformed.`, which never includes the secret.

## Rate limit

One counter per key, per UTC day. Every request that passes authentication counts, including
`no_result`, `400`, and `413`, because the counter runs before the body is read and the cost
being protected is the caller's own bug loop, not the answer. When the count exceeds the key's
daily limit the request returns `429 rate_limited` and is not resolved. The limit is a per-key
configuration value set when the key is created.

Version 1 has no per-second limit and no per-end-user dimension. The customer limits its own
users before calling.

## Resolution

The order matters. Taking the nearest settlement before the country is known names a town across
a border: in Torres del Paine, Chile, the nearest settlement is in Argentina.

1. **Truncate** the validated latitude and longitude to `precision` decimals, toward zero.
2. **Country.** Point-in-polygon against the geoBoundaries ADM0 polygons. If a polygon contains
   the point, that is the country, and it is never overridden by anything found later.
3. **Region.** Point-in-polygon against the ADM1 polygons of that country. The containing
   polygon's name comes from the region mapping described under `components`. If no polygon
   contains the point, or the containing polygon is mapped to no GeoNames region, `admin1` is
   `null`.
4. **Settlement.** Nearest settlement from GeoNames `cities500`, restricted to the resolved
   country. If its distance is within the locality threshold, `level` is `locality`. Otherwise
   `level` is `region` when `admin1` resolved, else `country`, and `degraded_from` is
   `"locality"`.
5. **Outside every polygon.** Simplified coastlines put a beach or harbor coordinate in the sea.
   Nearest settlement with no country constraint; if it is within the locality threshold, `level`
   is `locality` and `country` and `admin1` come from that settlement's GeoNames codes. Otherwise
   `no_result`. This is the only path that produces `no_result`; a point inside a country always
   gets at least the country.
6. **Fit** the label as described under Composition.

The locality threshold is 20 km, compared against the distance in whole meters, and is stated on
the public page.

## Privacy and logging

- The coordinate and the returned name are never written to durable storage the service
  controls: its own log lines, the platform's invocation logs, and any log export configured on
  the service's hostname. There is no flag that enables it.
- A request log line carries: request id, key id, status or error code, `place.level`, latency
  in milliseconds. Nothing else. The platform's automatic invocation logs, which include the
  request URL, are switched off in configuration, so a coordinate a caller wrongly puts in a
  query string is not logged either.
- Retention, published on the public page:

| Data | Retention |
|---|---|
| Request log lines as above | The platform log product's retention: 3 days on the Workers Free plan, 7 days on Workers Paid, as read 2026-09-24 |
| Per-key daily counters | Current and previous UTC day only |
| Key id, key hash, daily limit | Until the key is revoked |
| Query coordinates and returned names | Not stored |

- Returned names come from open data with user-generated content upstream. They are plain
  strings with control characters removed. `labels.short` is at most `max_label_length`;
  `components` values are bounded only by the longest name in the loaded data, as stated under
  Response.

## Public page

`GET /` serves a short static HTML page: what the service does, the locality threshold, the
retention table above, the GeoNames and geoBoundaries credit with links, the pinned data release
versions, and a link to this contract. This page is what the customer's own privacy policy points
at.

## Not in version 1

Billing, credits, quota headers, key management endpoints, publishable keys, test-mode keys,
`Idempotency-Key`, a `language` field, `labels.medium` and `labels.long`, ADM2 counties, a
response cache, batch lookups, an OpenAPI document. Each of these would be a new field, route,
or page added beside what is here. None changes the meaning of a field in this document.
