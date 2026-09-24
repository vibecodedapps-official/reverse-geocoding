import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { createHash } from "node:crypto";
import { defineConfig } from "vitest/config";
import { TEST_KEYS } from "./test/keys.ts";

const root = import.meta.dirname;
const testKeyList = JSON.stringify(
  TEST_KEYS.map((k) => ({ id: k.id, sha256: createHash("sha256").update(k.key).digest("hex"), daily_limit: k.daily_limit })),
);

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["test/node/**/*.test.ts"],
        },
      },
      {
        test: {
          // Needs the real data build in data/build; run with npm run test:data.
          name: "data",
          environment: "node",
          include: ["test/data/**/*.test.ts"],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.toml" },
            miniflare: {
              bindings: { KEYS: testKeyList },
            },
          }),
        ],
        resolve: {
          // The Worker imports data/build/*.bin; tests get the synthetic fixture build instead.
          alias: [{ find: /^.*\/data\/build\/(.*\.bin)$/, replacement: `${path.join(root, "test/.build")}/$1` }],
        },
        test: {
          name: "workers",
          include: ["test/worker/**/*.test.ts"],
          globalSetup: ["test/global-setup.ts"],
        },
      },
    ],
  },
});
