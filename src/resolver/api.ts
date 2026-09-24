// Types shared by the resolver and the Worker.

export type Level = "locality" | "region" | "country";

export interface Components {
  locality: string | null;
  admin1: string | null;
  country: string | null;
  country_code: string | null;
}

export type Resolution =
  | {
      status: "ok";
      components: Components;
      level: Level;
      /** Whole meters, or null when no settlement lies within the search radius. */
      distanceMeters: number | null;
      degradedFrom: "locality" | null;
    }
  | {
      status: "no_result";
      distanceMeters: number | null;
    };

/** Locality threshold in kilometers. Stated on the public page. */
export const LOCALITY_THRESHOLD_KM = 20;
/** Settlement search radius in kilometers; beyond it the distance is null. */
export const SEARCH_RADIUS_KM = 500;
