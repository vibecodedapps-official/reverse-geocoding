---
name: deploy
description: Deploy the Worker, ship to production, deploy the dev Worker, update the KEYS secret. Builds the index, sets the key secret when it changed, and deploys with wrangler to production or the dev environment.
disable-model-invocation: true
---
# deploy

Done when the chosen Worker serves the new build and `GET /healthz` returns the expected `build_id`.

Confirm with the user before step 3, and before step 2 when it runs: both change a live system. Production is the `reverse-geocode.vibecodedapps.net` custom domain; `dev` is a separate Worker on its own workers.dev URL with its own keys and counter.

1. Build the index the Worker imports: `npm run data:build`. The output ends with the build id. `data/build/*.bin` must exist or the deploy bundle fails.
2. Only when the key list changed, set the secret: `wrangler secret put KEYS` for production, `wrangler secret put KEYS --env dev` for dev. The value is a JSON list of `{"id", "sha256", "daily_limit"}`, where `sha256` is the hex SHA-256 of the full key. The command reads the value from an interactive prompt, so the user runs it themselves and pastes the value there; never write it into a file in the repository.
3. Deploy: `npm run deploy` for production, `wrangler deploy --env dev` for dev. The output shows the uploaded Worker, its bindings, and the route or URL.
4. Verify: `GET /healthz` on the deployed URL returns `200` with `data.build_id` equal to the build id from step 1.

## Checks

- `npm run check`: passes before the deploy.
- `curl -s https://<host>/healthz`: `status` is `ok` and `data.build_id` matches.

## Report

Which environment was deployed, the build id and data date now live, and whether `KEYS` was changed.
