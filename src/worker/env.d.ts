import type { DailyCounter } from "./counter.ts";

declare global {
  namespace Cloudflare {
    interface Env {
      COUNTER: DurableObjectNamespace<DailyCounter>;
      /** JSON list of {"id", "sha256", "daily_limit"}. */
      KEYS: string;
    }
    interface GlobalProps {
      mainModule: typeof import("./index.ts");
      durableNamespaces: "DailyCounter";
    }
  }
}
