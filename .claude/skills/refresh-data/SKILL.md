---
name: refresh-data
description: Refresh the place data, re-pin the sources, rebuild the index, update GeoNames. Downloads the current upstream files, archives them, rebuilds data/build and runs the real-index tests.
disable-model-invocation: true
---
# refresh-data

Done when `data/manifest.json` holds the new pins, the GeoNames files are archived, `npm run data:build` succeeds and `npm run test:data` passes.

1. Download and pin: `npm run data:pin`. The output shows each upstream URL with its byte count and SHA-256, then "wrote data/manifest.json". The checksums in `data/manifest.json` change.
2. Archive the same day, since GeoNames replaces its dump files daily: `node data/pin.ts --upload`. The output shows each GeoNames file uploading as an asset named by its SHA-256 to the release that `archive_base_url` in `data/manifest.json` names, or "already in ... release; refusing to replace it". It needs the `gh` CLI signed in to that repository.
3. Build: `npm run data:build`. The output ends with the build id, the data date, the file sizes and counts, and the number of overlaps and unmapped GeoNames regions.
4. When the build fails with `region mapping failed for N ADM1 polygon(s); add rows to data/admin1-overrides.csv:`, each listed line gives a polygon id, its name, its country group, the reason and the candidate region codes with settlement counts. Add one row per polygon to `data/admin1-overrides.csv` in the form the rule for that file describes, then run step 3 again.
5. Run the fixtures against the real index: `npm run test:data`. A calibration or edge failure means a place the new data names differently; read the failing fixture before changing it.

## Checks

- `npm run data:build`: exits 0 and prints the build id line.
- `npm run test:data`: all tests pass.
- `git status --short`: only `data/manifest.json`, `data/admin1-overrides.csv` and fixture files under `test/fixtures` have changed. `data/raw` and `data/build` are git-ignored.

## Report

The new data date and build id, the number of override rows added with their polygon names, and any fixture that changed with the old and new name. Say whether the upload ran the same day as the pin.
