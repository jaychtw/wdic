# World Disaster Information Center (WDIC) · 全球災害資訊站

Bilingual, event-first tropical cyclone and disaster monitoring on GitHub Pages.

Run `python collect.py` to refresh the index, then `python -m http.server --directory site 8000`. Run `python -m unittest -v` for the collector tests. No keys or build dependencies are required.

GitHub Actions requests a refresh twice each hour. Each feed has a last-success timestamp and independent fallback. Reports expire even after a failed retrieval. A storm row can combine sources by explicit WMO aliases or matching name and nearby centre. A source product retains the issuer and time. For unsupported jurisdictions the dashboard exposes its coverage gap.

Discovery uses WMO Severe Weather Information Centre cyclone tracks, NOAA NHC active storms, Taiwan CWA typhoon analyses and local earthquake reports, and Global Disaster Alert and Coordination System (GDACS) RSS. Disaster entries are recent reports, including updates to earlier events. Taiwan earthquake reports have a 48-hour window. The interface displays the original language of source content. Agency directory adapted from WMO member metadata. Land outlines from Natural Earth, public domain.

Camera links point to public operator-hosted streams in Taiwan. Distances refer to a reported point or forecast waypoint. No camera match implies no nearby catalogued camera. Stream availability is controlled by each operator.
