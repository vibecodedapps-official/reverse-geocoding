<!-- primer -->
# reverse-geocoding

A Cloudflare Worker that turns a WGS84 coordinate into a short place name at locality, region, or country level, from an in-memory index built from GeoNames and geoBoundaries. It never stores the coordinate or the returned name, fits the label to a caller-declared maximum length, and serves one customer from one server key. Read `docs/API.md` before changing request parsing, the response shape, errors, or logging in the Worker.

## Commands

- `npm run check`: typecheck, then the unit and Worker tests.
- `npm run typecheck`: both TypeScript projects, the Worker one and the Node one.
- `npm test`: the vitest `node` and `workers` projects against a synthetic fixture index that the Worker project builds into `test/.build` first.
- `npm run test:data`: calibration and edge fixtures against the real index in `data/build`; needs a completed `npm run data:build`.
- `npm run data:pin`: downloads the current upstream files to `data/raw` and rewrites the pins in `data/manifest.json`.
- `npm run data:build`: verifies the pins, fetching a missing or mismatched file from its archive, and writes `data/build/*.bin`, `manifest.json` and `report.json`.
- `npm run dev`: wrangler dev; needs a completed `npm run data:build`.
- `npm run deploy`: wrangler deploy to production; needs a completed `npm run data:build`.

## Constraints

- Node 22.18 or later. Scripts run TypeScript directly with Node's type stripping; there is no compile step.
- `data/raw/`, `data/build/` and `test/.build/` are generated and git-ignored; never commit them.
- The coordinate and the returned name are never logged or stored, and no error message carries a value from the request body.
