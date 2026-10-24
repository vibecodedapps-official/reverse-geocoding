---
paths:
  - "data/admin1-overrides.csv"
---
# admin1 overrides

Each row maps one geoBoundaries ADM1 polygon to a GeoNames region when the build cannot derive the mapping, which needs at least 80 percent of the settlements inside the polygon to share one region code. The header is `shape_id,admin1_code,reason`, and the build rejects a file whose header differs, a row without a `shape_id`, a `shape_id` listed twice, a `shape_id` that matches no ADM1 feature in the build, or an `admin1_code` that is not in `admin1CodesASCII.txt`.

`admin1_code` is the GeoNames code within the polygon's country, such as `04`, or empty to map the polygon to no region, which makes `admin1` null for points inside it. It is one of three cases: the region whose name matches the polygon's name, the region most of the settlements inside share, or empty when the polygon spans several regions, such as a statistical macro-region.

`reason` starts with the country code and the polygon name, then says which of the three cases applied and the evidence from the build's candidate counts, as in `AE Fujairah: name matches GeoNames region AE.04; 3 of 5 settlements inside` or `AO Cuando Cubango: no GeoNames region holds 80 percent of the settlements inside (top CBG 13 of 30)`.
