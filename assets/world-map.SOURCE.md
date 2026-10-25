# Natural Earth map data

The offline map is derived from the public-domain Natural Earth dataset.

- Terms: https://www.naturalearthdata.com/about/terms-of-use/
- Maintainer repository: https://github.com/nvkelso/natural-earth-vector
- Outlines: `geojson/ne_110m_admin_0_countries.geojson`.
- Country label positions (including small states): `geojson/ne_50m_admin_0_countries.geojson`.

`world-map.json` records both source URLs and SHA-256 digests. The outlines are projected to an equirectangular SVG plane, rounded to two decimals, and omit Antarctica. Bubble locations use Natural Earth's label coordinates. They represent countries/areas, not campus or researcher locations. No third-party map requests are made by the dashboard.

The dashboard counts come from the OpenAlex snapshot. Natural Earth supplies geography only.

---

Copyright (c) 2026 Ikhwan Arief (ikhwan[at]eng.unand.ac.id). All rights reserved. Licensed under the PolyForm Noncommercial License 1.0.0 (https://polyformproject.org/licenses/noncommercial/1.0.0). Commercial use requires prior written permission from the copyright holder. See LICENSE and NOTICE.
