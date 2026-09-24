// Keys used by the Worker tests. Test values only; never valid anywhere else.
export const TEST_KEYS = [
  { id: "key_main", key: "pn_live_TestMainKey000000000000000000000", daily_limit: 1000 },
  { id: "key_small", key: "pn_live_TestSmallKey00000000000000000000", daily_limit: 3 },
] as const;

/** Well-formed but absent from the key list, as after revocation. */
export const REVOKED_KEY = "pn_live_TestRevokedKey000000000000000000";
