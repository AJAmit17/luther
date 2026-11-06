# Licensing and attribution

**Selected: Apache-2.0 with a project `NOTICE`, approved by the maintainer.** The authoritative terms are in [LICENSE](../LICENSE), with attribution in [NOTICE](../NOTICE).

This comparison records the reasoning, not additional licence conditions or a legal opinion. The goal is retaining Luther's credit when someone forks or incorporates the project.

## Credit is different from copyleft

Preserving copyright/attribution notices, displaying public product credit, sharing source changes, and protecting a trademark are separate requirements. A stronger copyleft licence does not automatically mean a more prominent “Built with Luther” badge.

| Option | Attribution and downstream obligations | Source-sharing scope |
| --- | --- | --- |
| MIT | Preserve the copyright and permission notice in copies or substantial portions. No general product-UI credit requirement. | No requirement to publish modifications. |
| Apache-2.0 + `NOTICE` | Include the licence; mark modified files; preserve relevant source notices and the applicable `NOTICE` attribution in a permitted location. A notice file or accompanying documentation can satisfy the attribution requirement; UI placement is not mandatory. | Does not require publishing modifications. Includes an express patent grant and conditions. |
| MPL-2.0 | Retain covered-source notices and inform executable recipients how to obtain the covered source. | File-level copyleft when distributing covered code; separately written files in a larger work can use other terms. |
| AGPL-3.0 | Preserve applicable notices and comply with GPL-family distribution requirements. Section 13 adds a source offer for users interacting remotely with a modified version that supports such interaction. | Strong copyleft, including the modified network-service scenario. Not simply a credit badge. |
| CPAL-1.0 | Section 14 allows specified, limited original-developer attribution displayed prominently in a graphical interface, including at launch/session initiation. Exact requirements depend on Exhibit B and the licence's limits. | Also includes source/copying and network-use obligations; not a permissive licence with a cosmetic badge added. |

## Fit for Luther

- If retaining project credit in distributed legal notices is sufficient, **Apache-2.0 with a factual `NOTICE` is a practical fit**. The premise that Apache cannot require downstream attribution is incorrect.
- If distributed changes to Luther's covered files must stay open, **MPL-2.0** addresses that additional goal without treating every separately written file as covered code.
- If visible product attribution is essential, **CPAL-1.0 deserves focused review**, including its Exhibit B, network obligations, compatibility, and the native-app experience. Do not silently bolt an advertising clause onto Apache or MPL and keep calling it the unmodified licence.
- AGPL is relevant if reciprocal source access for modified hosted services is the aim. It is not a substitute for deciding the desired credit location.

App-store distribution terms, DRM/additional restrictions, and third-party dependency compatibility need particular care with copyleft choices. Do not assume that an iPhone developer build proves a licence is suitable for future App Store distribution.

No code licence alone establishes trademark registration or guarantees credit for someone who merely uses a running copy without redistributing software. Provider logos and dependency notices remain separate concerns.

## Decision

The maintainer selected Apache 2.0. This protects applicable project attribution through the licence's notice-preservation rules while allowing commercial/proprietary incorporation. A visible UI badge is not required.

The repo contains the standard licence text and a factual project `NOTICE`, not a custom advertising clause. Package metadata identifies `Apache-2.0`; release archives and installation paths carry the project notices.

Revisiting the licence for future versions would not cancel rights already granted for Apache-licensed versions. Contributor rights and compatibility would need review before any future relicensing.

## Primary sources

- [MIT licence — Open Source Initiative](https://opensource.org/license/mit): notice-preservation condition.
- [Apache License 2.0 — Apache Software Foundation](https://apache.org/licenses/LICENSE-2.0.html): sections 3, 4(a–d), and 6.
- [Applying Apache 2.0 — Apache Software Foundation](https://apache.org/legal/apply-license.html): licence and attribution packaging.
- [MPL 2.0 FAQ — Mozilla](https://www.mozilla.org/en-US/MPL/2.0/FAQ/): covered-source notices, executable distribution, and larger works.
- [GNU AGPL version 3 — Free Software Foundation](https://www.gnu.org/licenses/agpl-3.0.en.html): sections 5–7, 10, and 13.
- [AGPL-3.0-only text — SPDX licence data](https://github.com/spdx/license-list-data/blob/main/text/AGPL-3.0-only.txt): verified section 13 text when the GNU site denied the fetch.
- [CPAL 1.0 — Open Source Initiative](https://opensource.org/license/cpal_1.0): sections 14–15 and Exhibit B.
