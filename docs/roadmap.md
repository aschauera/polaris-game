# Polaris: implementation roadmap

**Canonical delivery plan, status checked 12 November 2026:** this document owns the full target packages, dependencies, acceptance and test strategy. [Game design](game-design.md#target-status-and-baseline) owns complete rules, lore, catalogs and decision status; [architecture](architecture.md#planned-target-domain-and-compatibility) owns technical version/save contracts. Foundation PRs #20 → #21 → #22 → #24 → #29 → #31, design #33/#34 and save reliability #47 are integrated into main at `c6c4cad`; their prerequisite issues are closed. G1/#53 and the shared-landmass scenario/player scaffold P2/#36 are implemented; combat, island crossing and the remaining target gameplay are still planned.

**New delivery order:** existing hex/city/messenger/graphics foundation → complete two-human match with three common classes, common coastal crossing for island maps, three beacons, city capture and end conditions → six-resource/worker/city economy with the chosen small common research tree → first four-tribe slice with one characteristic ability each → six mixed plus four mirror pairings with swapped starts → further documented tribal catalogs. Diplomacy, policies and AI are optional later. Research is not required before the isolated first combat/victory slice, but its unlocks govern the complete economy. This supersedes the historical future sequencing below, not implemented regression contracts or real GitHub blockers.

Confirmed directions and numeric caveats are recorded once in the [design decision register](game-design.md#target-decision-register). Acceptance below exercises those rules; it does not turn provisional values into measured balance.

The atlas foundation and briefs 6–7 (scout exploration and the first city/economy slice) are implemented on main. Legacy follow-ups #9–#15 have been reconciled with the package map below under maintenance #35; creating or rescoping them does not implement their gameplay. G1/#53 implements canonical bathymetry and its presentation without new gameplay. P2/#36 adds a deterministic shared-landmass scenario, independent tribe selection, reserved public beacons and produced later founders. The board is a **hex grid** with rules version 5 and generator version 5; the renderer draws hex fields from cubic voxels in 66×66-column chunks (`src/rendering/voxels.ts`), with territory borders, city name plates and voxel unit figures.

Sizes in historical briefs are rough focused-development estimates: **S** 1–2 days, **M** 3–5 days, **L** 6–10 days. Re-estimate and split packages into narrow issues before execution when needed. Use the current package map and live *blocked by* issue relationships, not the obsolete brief-number sequence ([working order](../.github/copilot-instructions.md#working-order-issues-blocked-by-and-stacked-prs)). The completed foundation chain was #8 → #25 → #26 → #27 → #28 → #30.

## Detailed target delivery plan

The remaining gameplay packages below remain planned; G1's generator/data/presentation increment and P2's shared-landmass scenario scaffold are implemented here. Issue #32 was delivered by #33/#34 and is closed. Save maintenance #35 was delivered by #47 and is also closed: storage failures and the transport history boundary are covered, and the GitHub backlog is reconciled. Documentation/capture refresh #48 records that integrated state without authorizing another merge, release or deployment.

### Baseline and working order

Use integrated main from `c6c4cad` and then-current compatible maintenance: cities, messenger, hex rules v4, graphics polish, canonical design and save safeguards. Water design #50/#51 merged at `30e6be5`; G1/#53 advances only the generator to v5 with canonical depth data. Historical main `6aa2dbe8d45ccea58def5054ff32a55295a22b04` lacks those contracts. The original documentation was prepared against cumulative graphics commit `834ffc491fa4932e3c719191db837b3fea639445`; #33/#34 subsequently integrated it, and #47 added save reliability. Do not discard inherited foundation work when reviewing a later narrow change.

Before any package, reread current code/blockers, fix its test rules and acceptance cases, choose a narrow reviewable increment and appropriate versions, and synchronize affected docs/guidance. Do not reopen confirmed decisions or implement blocked predecessors incidentally. Estimates follow source inspection; package IDs are planning labels mapped to GitHub issues below, not promised dates.

### Existing dependencies and legacy issues

**Current integration:** #20, #21, #22, #24, #29, #31, #33, #34 and #47 are merged. Foundation issues #8 and #25–#30, documentation issue #32 and save reliability #35 are closed. P2/#36 implements the scenario/player scaffold; P3/#10 is the next gameplay package.

The island/water design #50/#51 is merged at `30e6be5`. On 12 November 2026 Klaus approved extracting **G1/#53, canonical bathymetry and its presentation**, from P3a. G1 adds no boats or water movement; P2/#36 now implements the shared-landmass scaffold, and P3/#10 is next.

The following GitHub relationships were configured during maintenance #35, read back after #47 merged, then updated for the approved G1 extraction after #51 on 12 November 2026. Parent #5's obsolete brief-number waves were synchronized with this map; its original native child links remain historical traceability, not delivery order. The parent stays open for unfinished gameplay. Check live state again before starting:

| Package | Issue | Blocked by |
| --- | --- | --- |
| Save reliability (completed via #47) | [#35](https://github.com/aschauera/polaris-game/issues/35) | #30 (closed) |
| G1 canonical bathymetry/presentation (implemented here) | [#53](https://github.com/aschauera/polaris-game/issues/53) | #50 (closed) |
| P2 scenario/player scaffold | [#36](https://github.com/aschauera/polaris-game/issues/36) | #30, #32, #35 (all closed) |
| P3 visibility-safe combat | [#10](https://github.com/aschauera/polaris-game/issues/10) | #36 |
| P3a water crossing/island scenarios | [#52](https://github.com/aschauera/polaris-game/issues/52) | #10, #53 |
| P4 city capture/occupation | [#37](https://github.com/aschauera/polaris-game/issues/37) | #10 |
| P5 beacons/results | [#15](https://github.com/aschauera/polaris-game/issues/15) | #37, #52 |
| P6 complete two-human match | [#38](https://github.com/aschauera/polaris-game/issues/38) | #15 |
| P7 resources/worker jobs | [#9](https://github.com/aschauera/polaris-game/issues/9) | #38 |
| F1 small common research | [#11](https://github.com/aschauera/polaris-game/issues/11) | #9 |
| P8 workforce/territory/construction | [#39](https://github.com/aschauera/polaris-game/issues/39) | #9, #11 |
| P9 food/hunger/army obligation | [#40](https://github.com/aschauera/polaris-game/issues/40) | #39 |
| P10 food deliveries | [#41](https://github.com/aschauera/polaris-game/issues/41) | #40, #11 |
| P11 tribal data/buildings | [#42](https://github.com/aschauera/polaris-game/issues/42) | #40, #11 |
| P12 initial tribal abilities | [#43](https://github.com/aschauera/polaris-game/issues/43) | #42 |
| P13 pairings/playtests | [#44](https://github.com/aschauera/polaris-game/issues/44) | #43; also #41 if deliveries are included |
| F2 optional policies | [#45](https://github.com/aschauera/polaris-game/issues/45) | #40, #11 |
| F3 peace/beacon decision | [#46](https://github.com/aschauera/polaris-game/issues/46) | #38 |
| F3 optional diplomacy | [#13](https://github.com/aschauera/polaris-game/issues/13) | #38, #46 |
| F4 optional AI | [#14](https://github.com/aschauera/polaris-game/issues/14) | #44; F1 too if its mode uses research |

Before P13 starts, record whether deliveries are included and add #41 as an actual blocker when they are. P3a/#52 was added on 12 November 2026 for island maps (E15/E17); it is blocked by #10 and #53 and blocks #15. #12 is closed as superseded, **not implemented**: its remaining information-safe combat acceptance belongs to P3/#10. The research part of old #11 is F1; policies are separately tracked in #45. Old #14's faction content belongs to #42/#43; #14 now tracks later AI. No mandatory AI/diplomacy edge remains before core victory.

<details>
<summary>Historical pre-integration snapshot from the original documentation</summary>

These were the issue relationships before the foundation merged, not current open blockers:

| Issue | Recorded blocker | Associated PR | Meaning at that snapshot |
| --- | --- | --- | --- |
| [#8](https://github.com/aschauera/polaris-game/issues/8), city economy | #7, closed | [#20](https://github.com/aschauera/polaris-game/pull/20) | First city economy; issue open |
| [#25](https://github.com/aschauera/polaris-game/issues/25), messenger | #8, open | [#21](https://github.com/aschauera/polaris-game/pull/21) | Serverless two humans |
| [#26](https://github.com/aschauera/polaris-game/issues/26), voxel engine | #25, open | [#22](https://github.com/aschauera/polaris-game/pull/22) | Renderer/settlements |
| [#27](https://github.com/aschauera/polaris-game/issues/27), hex world | #26, open | [#24](https://github.com/aschauera/polaris-game/pull/24) | Six-neighbour voxel board |
| [#28](https://github.com/aschauera/polaris-game/issues/28), guidance | #27, open | [#29](https://github.com/aschauera/polaris-game/pull/29) | Shared contracts/docs |
| [#30](https://github.com/aschauera/polaris-game/issues/30), graphics polish | #28, open | [#31](https://github.com/aschauera/polaris-game/pull/31), draft at snapshot | Rules/generator v4, direct orders, visual occurrences |

The intended integration was **#20 → #21 → #22 → #24 → #29 → #31 → #33**. PR #33 targeted `klaus/graphics-polish`; #34 brought the completed design to main. Its original `Closes #32` did not close the issue on the stacked base, so maintenance explicitly verified delivery and closed #32. Continue checking base, CI and issue closure after future stacked merges rather than assuming automatic retargeting.

</details>

### Milestones and deliberate limits

| Milestone | Outcome | Not yet required |
| --- | --- | --- |
| M0 concept | Saved target, baseline, decisions and order | Gameplay code |
| M1 integrated foundation | Hex cities, deterministic messenger, compatible storage | New economy/tribes |
| M2 complete core | Two humans, small fair map on one landmass or separate islands, common coastal crossing, three classes/beacons, conquest and explicit result | Full tribal buildings, research, diplomacy, AI |
| M3 viable economy | Six resources, work, unlimited city expansion, hunger, supply and small common research tree | Full special effects |
| M4 initial four tribes | Common classes/civilians and one characteristic ability each, free choice/mirrors | Entire three-tier buildings/all abilities |
| M5 verified matches | Six mixed/four mirror pairings, swapped starts, measured resource/counter/duration problems | Final balance claim |
| M6 later depth | Further catalogs, optional diplomacy and compliant AI as needed | Server/new engine/unrequested platform move |

M2 may retain the existing generic-material economy. It is not yet a complete workforce/hunger economy: mark that intermediate state in UI/docs and assign separate rules versions. Never expose a half-built mixed economy with invented six zero balances.

### P0 — Concept and approval register

**Prerequisites:** none. **Outcome:** canonical design and this plan; M0.

Acceptance: complete four tribes/common rules; historical main separated from the integrated foundation; coherent provisional numeric rules; confirmed choices not marked open. README and guidance point to the existing English canonical documents. Delivered by #33/#34; no target gameplay was implemented by that documentation.

### P1 — Have the existing foundation integrated

**Prerequisites:** P0 and the real six-PR chain. On main, prerequisite issues must actually be closed; alternatively use an expressly approved stacked basis.

The foundation and save reliability #35/#47 are integrated on main at `c6c4cad`, with the prerequisite issues closed. Before new gameplay, reread then-current hex/city/messenger/storage/render contracts and run the existing checks. [Current screenshots and verification](../README.md#current-verification-and-screenshot-provenance) document the foundation, not later combat/crossing gameplay. This completed gate is not permission to merge future work without review.

Acceptance: selected basis has those contracts; two devices exchange valid current turns; incompatible saves survive; no square-grid assumptions in new packages. Resolve conflicts with any later predecessor changes.

### G1 — Canonical bathymetry and presentation

**Prerequisites:** merged water design #50/#51. Extracted from P3a with Klaus's approval; [#53](https://github.com/aschauera/polaris-game/issues/53). No combat prerequisite.

Generate four stable depth tiers per water hex, irregular shallow-water areas and submerged offshore sandbanks. Preserve existing land/water identity, land elevations, trees and PRNG progression. Align seabed terraces, cap colours and charted-water inspection with those canonical classes across zoom and exploration. Use a new generator version and retain incompatible older saves unchanged.

Acceptance: seeded repeatability; variable coastal widths and broad connected shallow extensions beyond two hexes, with deep-water gaps; no depth changes when nearby fog clears; hidden coasts and uncharted inspection remain protected; existing rendering/picking/resource bounds and fresh running-app visuals. No boats, Landing/Harbour, water movement or separate playable island starts. Final start/beacon reachability and fairness belong to P2/P3a.

**G1 implemented:** generator v5, rules v4, required water depth in immutable tiles and the map checksum, four detailed seabed terraces, all four cap/inspection classes even in coarse views, and retained v3/v4 archives. Regression fixtures preserve v4 landforms/elevations/trees/RNG; multi-seed tests require broad connected upper-tier extensions at least three hex steps offshore, variable widths and deep-water gaps. P2 adds validated starts and beacons on one connected landmass under rules v5; all water remains impassable. [Fresh captures and verified evidence](../README.md#current-verification-and-screenshot-provenance) document G1 and P2, not completed P3a.

### P2 — Scenario, player slots and content scaffold

**Prerequisites:** P1. **Implemented as rules v5 / scenario v1.**

Separate player slots from tribe choices; define a deterministically validated shared-landmass layout with two starts, three reserved public beacons and six-direction topology. Keep tribes presentation-only and use the existing common unit/economy rules; this is not the full tribal content or a complete match.

Acceptance:

- Host/first player is not tribe-bound; each player chooses independently, including mirrors. Faction/player ownership remains distinct from tribe IDs. Turn packages carry the scenario version and both tribe choices; starts and beacons are reconstructed from the map seed.
- One free initial founder and scout per player, no completed army. The current prototype has no faction-level stockpile, so neither player receives one; the existing city-local food/material economy starts only after founding. Later founders are production decisions, gated by remaining city capacity.
- Start geography (E15): validated **shared-landmass** layouts have land paths between starts and every beacon, room for at least two further legal city sites per player after reserved scenario tiles, at least two free land tiles beside each beacon and weighted travel turns within 1 between mirrored targets. Reject failing maps instead of bridging them; other islands hold nothing required. Home-island and beacon-island layouts follow in P3a with the same validator extended by coastal-water legs.
- Measure weighted routes and compare the available start package. Resource fairness cannot yet be measured: map resource markers are presentation-only and faction inventories are not implemented. Do not treat mirrored appearance or absent resource data as evidence of future economic fairness.
- Validate IDs/references/class definitions; do not reinterpret Meridian/Lantern saves.

Version impact: content/schema for player/tribe selection; generator only for canonical generation/placement change, not merely a curated fixture with its own scenario version.

**Implemented:** deterministic starts on the largest connected landmass, one adjacent founder per player, three public non-settlement beacons, a route-fairness validator using current movement costs, reserved settlement space, independent tribe choices and the first additional-founder production decision. Rules v5 records the changed command outcomes; scenario v1 identifies the placement contract without changing generator v5. Beacons are public map objectives only: activation, combat and victory remain later packages. Tests cover mirrored tribes, repeatable placements, weighted routes, reserved land, rejection of unsuitable seeds and replay/package tampering.

**Beacon lighthouses (#56, presentation only):** charted beacons are drawn as voxel lighthouses on levelled plazas; uncharted ones keep only their public marker and remembered ones are dimmed. The tower changes no placement, movement or rule.

**Beacon holder display (#58, presentation only):** a lighthouse shows neutral (white lantern, terracotta bands, plain marker) or held (holder-coloured lantern and bands, banners with a faction-specific tail, a named marker plate and “held by …” inspection text). The domain stores no holders yet, so matches show every beacon as neutral; an opt-in diagnostics preview exercises the held look without touching the match. P5 supplies the holders and adds the streak display.

### P3 — Visibility-safe combat foundation

**Prerequisites:** P2. Use E2/E7/E13 test fixtures from the [decision register](game-design.md#target-decision-register).

Health, movement/attack budgets, three classes, shared deterministic preview, melee/ranged/line of fire, entrenchment, flank, counter budget, rest and zones; no tribal abilities yet.

Acceptance:

- Test advantage 6/neutral 4/disadvantage 3; hill/entrench/flank/protection/minimum damage identical in preview/resolution.
- Dead defenders never counter; second melee attack gets no second counter; ranged attacks trigger no melee counter.
- Traverse own units, never stack endpoints; tied paths repeat.
- Explicit cases for zone entry, starting inside, withdrawal, city tiles and restricted teleport.
- No fog leaks through targets, path search, fire lines or rejection reasons; preview never derives from hidden truth.

Version impact: rules and command/transport shape where needed; hashes include health/all budgets.

### P3a — Water crossing and island scenarios

**Prerequisites:** P3 and G1. Use E15/E17 from the [decision register](game-design.md#target-decision-register) and the [water crossing rules](game-design.md#water-crossing); E18 tribal water styles stay in P12.

Consume G1's stable per-water-hex depth classes; add the common Landing project, embark/disembark commands, boats at sea, land attacks on boats and Bulwark zones over water; extend scenario placement/validation to home-island and beacon-island layouts; add voxel boat and Landing pier presentation.

Acceptance:

- Each water hex has one deterministic navigation tier matching its terrain: shallow and shoal allow ordinary boats; shelf and deep require a deep-water-capable boat. The tier field follows warped coasts and broad underwater sandbanks, not a fixed distance from land. Sandbank water is navigable but never walkable or a landing surface; sub-hex decoration cannot change a tile's class.
- Shallow-water routes may extend irregularly away from shore along sandbanks. Validate that both starts and every beacon are connected by land plus shallow water through the common Landing; maps that fail room, contestability or mirrored travel-turn fairness are rejected, never repaired. Verify swapped starts and deep-water-only expansion islands.
- Build a Landing only in a city beside shallow water. Initial embark requires a Landing in the owning city's territory and movement left; once equipped, a unit retains its vessel ashore and can re-embark from any land tile beside free water its vessel can enter, with no second city required. Embarking and disembarking each end movement and attack. Never disembark into an enemy city centre; a landing never attacks, captures or activates a beacon that turn.
- Ordinary boats move 3 per turn in shallow water and cannot enter deep water. Harbour-equipped boats enter deep water at 2 movement per hex and retain that capability after landing and re-embarking. Boats occupy one tile, traverse own boats, are blocked by enemies and stop on entering a Bulwark zone. They cannot attack, entrench, rest, found, work, capture or activate; land attacks deal a neutral 4 without counter. No boat-versus-boat combat.
- Boats are hidden and revealed like land units; previews, paths and rejection reasons leak no hidden boats.
- Fresh running-app captures of boats and piers, delivered separately as Visual overview.

Version impact: rules (navigation using G1 depth classes, commands, retained vessel capability), content (Landing), scenario/generator for changed island placement or generated depths/routes, and schema for vessel state/new commands. Merely consuming G1's existing depth field does not require regenerating it.

### P4 — City attacks, capture and occupation

**Prerequisites:** P3. Use E8 civilian direction; M2 retains existing material economy.

Implement fortification, garrison, eligible capturers, one-tile advance exception, explicit fatal adjacent civilian attacks, ownership transfer, occupation and paid repair.

Acceptance:

- Test walls 8/12/16 and siege damage 1/1/3 separately from class damage; no overflow/free city attack.
- Empty wall breach, last garrison, ranged attackers and control zones handled.
- Exactly two qualified occupation endings; explicit presence, rounding/liberation rules.
- Buildings, local food/territory survive; enemy global stocks not looted.
- Foreign queues pause; no free refunds or collection of foreign abilities.
- Only explicit adjacent attack removes a civilian, spending attack; no retreat/prisoners/loot/conversion. Remove walls first, then civilian attack and eligible advance atomically without entity/ownership gaps.

### P5 — Beacon victory and final result

**Prerequisites:** P4 and P3a. Use E1 confirmed war start and documented round boundaries.

Activation spends attack for any combat class; implement public ownership, immediate reset, victory/defeat/draw and result lock.

Acceptance:

- Two of three through three own endings; losing below two on opponent turn resets immediately.
- Pair changes legal without dropping below two; no civilian activation, ranged Breaker may activate.
- No cities/founders loses; a founder alone prevents defeat.
- Defeat before beacon before draw; 40 complete rounds, player two can win at final ending.
- Completed-result import idempotent; no subsequent gameplay commands.
- Public ownership and streaks are readable on the map and in the HUD without relying on colour alone. Feed P5 holders into the existing lighthouse holder display (#58) instead of replacing it, and add the streak display.

### P6 — Accept M2 device to device

**Prerequisites:** P5.

Two humans complete a link/code/file match. Narrow integration gate, not a new feature collection.

Acceptance: reproducible setup, complete turns, combat, capture, beacon recapture, result and resume, on one shared-landmass map and one map with home islands and a beacon island. Duplicate/late/corrupt/wrong packages do not mutate a match. Test long logs/storage limits with new commands. UI explains the intermediate mode without promising absent economy/tribal bonuses. Fresh running-app captures for any visual changes, separately delivered as Visual overview.

### P7 — Six resources and worker jobs

**Prerequisites:** P6. Use E4 shared test data.

Version generic materials into resource vectors; canonical deposits, finite ruins, improvements, workdays and connection. Set common prices before special bonuses.

Acceptance:

- Explicit source/stock/use for six resources; food local, five others global.
- Presentation apple/fish/stone classification is not silently authoritative extraction data.
- No rare-resource requirement for basic counters; test start-region access.
- Paid worker jobs interrupt and complete exactly once; population operates completed sites, not permanently stationed workers.
- Fisheries from own land; roads do not change water passability.
- Finite ruins, no negative inventories or recycling arbitrage.
- Basic food/wood/stone/simple metal/classes need no research. Until F1, gated distant facilities/crystals are only explicit unlocked test fixtures, not a claimed complete economy.

Version impact: rules/content/economy schema; generator for canonical deposits. No automatic old-material conversion in live games.

### P8 — Workforce, territory and construction economy

**Prerequisites:** P7 **and F1 for the complete mode**. E3/E5 test rules; isolated tests may use explicit research fixtures.

Assignments/pins, basic centre, housing/storage, radius unlocks, individual claims, own tile transfer, reservations, expensive founders and cancellation.

Acceptance:

- Each population slot used at most once; unworked ownership has no hidden yield.
- Unstaffed starting centre prevents economic deadlock.
- Population 4/7 plus administration enables radius 2/3, never free full rings.
- Connected unambiguous coastal claims/fisheries without walking on water.
- Common Harbour as a paid Landing upgrade without research; boats first embarked there may enter shelf/deep water at 2 movement per hex and retain that vessel capability after landing (E17).
- No city cap: third/later cities foundable/capturable. Spacing 3 illegal, 4 legal otherwise; overlapping catchments retain unique ownership.
- Test founder 36 work vs basic soldier 12, plus wood/stone/12 local food. Provisions, death, cancellation and blocked output neither create food nor silently remove population.
- Housing 6 through Cultivation Methods before population 4, administration/radius 2 afterward; housing 9 before population 7. No per-city free research or cyclic unlock.
- Reservations unavailable twice; cancellation, blocked troop output and foreign-paid jobs cannot multiply materials.

### P9 — Food, hunger and army obligation

**Prerequisites:** P8. Use E6 provisionally accepted debt.

First implement ordered ending without intercity transfers: yields, local needs, upkeep/debt, hunger/growth, production. Show stores/actual expenditure.

Acceptance:

- 2 food/population; growth `8 + 4 * population`, at most once; housing/overflow visible.
- Second consecutive hungry ending loses population, thereafter at most one/turn, minimum 1; full feeding resets.
- 1 food/combat unit; city loss, reassignment, disconnected roads/citylessness never erase obligation.
- No tactical hunger penalties; debt/recruitment lock visible and serialized.
- New population/buildings not retroactive; occupation rounding/food exception correct.

### P10 — Bounded intercity food deliveries

**Prerequisites:** P9 and F1.

Standing routes after Stockpiling, road connection after Roadbuilding; source needs, shared export snapshots and recipient capacity. May move after M4 if its unlocked-but-unimplemented status is transparent.

Acceptance: multiple sources, constrained recipients, A→B→C, cycles, caps, debt priority, city loss/interruption reproduce. No forwarding newly received food that ending. Transfers conserve totals; only explicit storage overflow loses food.

### P11 — Tribal data, buildings and civilian identity

**Prerequisites:** P9 and F1. E11 mirrors; obtain E12 final content approvals before actual assets.

Four definitions with common equivalents and explicit split between available content and full expansion catalog. Implement first-increment necessities, not every F7 tier in one package.

Acceptance:

- Exactly four target tribes, no additional discarded Stonewatch/Tidebound identities.
- Three common combat/civilian roles each; document two-tier units/four three-tier building chains. Do not expose absent entries as free selectable products.
- Actual content has explicit prices, work, predecessors, staffing/slots, never zero placeholders. Equipment unlocks all tier-2 classes, not basic counters.
- Consistent Path House/Supply Nest naming; Salvage Crew stays worker upgrade.
- Captured foreign buildings use explicit common equivalents: no housing loss from wrong tribe ID or accumulation of every bonus.
- Ordinary troops do not consume population; no gender-dependent stats.

### P12 — Bounded tribal abilities

**Prerequisites:** P11.

Choose **exactly one initial characteristic ability per tribe** from the catalog under a common budget/cost frame. E9 selection remains open; other abilities are not silently included. Further combinations belong to F7.

Acceptance: correct wood/crystal prices, single charges, movement/attack budgets. No protection/healing stacks, fog teleports, zone bypass, free repair or city-switch recharging. No blanket Engineer superiority; Raccoons viable without ruins; Amazons pay alternative connection through building opportunity cost; Sorceresses retain basic counters without crystals.

Tribal water styles (E18) belong here only after both maintainers approve them: Amazon canoes (faster in shallow water), Raccoon drift rafts (cheap initial embark, shallow water only), Engineer bridges (shallow-water hexes, usable by enemies and removable) and Sorceress star navigation (deep water without a Harbour), each with the bounds in the [design](game-design.md#water-crossing). They never change map validation, never let boats attack and never remove the response turn after a landing.

### P13 — M5 pairings, resources and first-player advantage

**Prerequisites:** P12; also P10 if the tested mode includes deliveries.

Ten unordered pairings: Amazons–Raccoons, Amazons–Engineers, Amazons–Sorceresses, Raccoons–Engineers, Raccoons–Sorceresses, Engineers–Sorceresses, plus Amazons–Amazons, Raccoons–Raccoons, Engineers–Engineers and Sorceresses–Sorceresses. Repeat each with starts/first player swapped. Twenty matches give initial full coverage, **not statistical balance validation**. Also independently cross position and first player if the scenario permits them to vary separately. Mirrors must prove separate ownership/research despite the same tribe.

Acceptance: publish seeds, versions, starts, logs and evaluation. Run pairings on shared-landmass and island maps when the release map set contains both, and record first landing, crossing times and tribal water-style effects. Measure first beacon contact, victory time, counter access, shortages, hunger/debt, class shares, blockades and first-player win rate. Agree measurable ranges beforehand, never select thresholds after favorable results. Justify balance changes separately and repeat swapped conditions.

### Additional and later packages

| Package | Prerequisites | Scope / acceptance |
| --- | --- | --- |
| F1 small common research | **P7 only; before full P8** | Eight technologies/applications from design; one player project, fixed baseline plus staffed knowledge, retained per-tech progress/no theft. Not required before isolated M2 |
| F2 society/policies | P9, F1 | Few meaningful choices; stability/unrest not mere numerical burden or double occupation punishment |
| F3 diplomacy | P6 and separate peace/beacon decision | Consistent peace/war/pacts serialization without retroactively blocking core mode |
| F4 AI | P13; optional F1 only if playing research | Same commands/fog, deterministic bounded search, no hidden bonuses; measure worst-case work |
| F5 further resources/world rules | P13 and specific approval | Clear-cutting, depletion, naval combat/warships, rivers with river bridges or further victories individually, never introduced incidentally by graphics; common water crossing is P3a and the Harbour P8, not F5 |
| F6 distribution/platforms | M5 and separate product decision | No unapproved replacement of browser/messenger; evaluate native packaging separately |
| F7 complete tribal expansion | P13, F1 and approval of next catalog stage | Further documented unit/building tiers/abilities individually; retest ten pairings and recycling/protection limits each increment |

**F1 detailed acceptance:** all eight technologies/applications accessible without gating basic supply/counters. No movement technology: hill and water movement are not research-gated (E16); Landing and Harbour need no research. Fixture baseline 1/faction, staffed workplace +1, costs 5/8; first unspecialized technology in 5 own endings within test target 4–6. Switching preserves technology-specific points without transferable credit; capture copies no research. Housing 6 before population 4 and housing 9 before 7 prevent deadlock.

F1 does **not** depend on P8 or P11. Implement/test its baseline and minimal knowledge workplace against P7 definitions/explicit assignment fixtures; complete general workforce/territory integration in P8. No dependency on future tribal buildings is needed.

### Dependency graph

Required package edges (not an ordering inferred from numbering):

```text
P0 -> P1 -> P2 -> P3 -> P4
merged water design #50/#51 -> G1
P3 + G1 -> P3a
P4 + P3a -> P5 -> P6 -> P7 -> F1
P7 + F1 -> P8 -> P9
P9 + F1 -> P10
P9 + F1 -> P11 -> P12 -> P13
P10 -> P13 only when deliveries are in the tested mode
P9 + F1 -> F2
P6 + separate peace/beacon decision -> F3
P13 -> F4 (plus F1 if that AI mode uses research)
P13 + specific approval -> F5
M5 + product decision -> F6
P13 + F1 + next-stage approval -> F7
```

In particular **P7 → F1 → P8**, not P8 → F1 → P11 → P8. Milestone labels describe achieved outcomes; they are not implicit extra dependency edges.

### Version and persistence acceptance

The authoritative change-to-version matrix and save contracts live in [architecture](architecture.md#target-version-and-persistence-boundaries), not a parallel rules document.

For each rules milestone, retain an old readable package and test explicit rejection without overwrite; export/import new packages; replay all commands on two independent states; compare map/state checksums. No faction-name text replacement migration. Reject unknown product/ability IDs, invalid numbers, negative stocks, duplicate IDs, bad references/order and oversized logs before acceptance. No Babylon/DOM/frame data in authoritative state.

### Cross-package verification strategy

Domain tests first: focused new-rule cases, unchanged state on rejection, stable ordering. Scenario/replay tests integrate systems; Playwright verifies actual controls/information/turn handoff. Swapped manual matches provide balance feedback, never replace deterministic boundary tests.

Existing implementation gates: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:e2e`. Start with the narrowest meaningful tests, then required repository gates. Save maintenance #35 adds storage-failure and exact history-boundary regressions, not target-gameplay evidence; setup and release scripts are unchanged.

| Area | Critical regressions |
| --- | --- |
| Victory | Opponent-turn reset, pair change, final player-two victory, founder without city |
| Combat | Dead defender, spent counter, attacker counts in flank, minimum damage, blocked fire line |
| Movement/fog | Zone start/withdrawal, own-unit traversal, hidden target, teleport destination |
| City | Last wall without garrison, last garrison death, explicit civilian attack, atomic capture, foreign queue, recapture, third city |
| Economy | No double assignment, hunger sequence/reset, housing block, overflow, newly completed building |
| Logistics | A→B→C no forwarding, multiple sources, interrupted road, cityless army debt |
| Materials | Reservation, cancellation including full progress, blocked spawn, dismantle/market/capture without gain cycle |
| Research/expansion | One faction baseline despite many cities, retained progress, no knowledge theft, housing 6 before 4/9 before 7, no founder-food duplication |
| Persistence | Readable incompatible save byte-identical; duplicate/old import, limits, replay divergence |
| Presentation | No hidden deposits/enemies through picks/HUD; public beacons leak no sight |

Per package update design/status/register, technical ADR/schema decisions, roadmap milestone/blockers, README usable scope and agent guidance together. For visual changes provide fresh running-app evidence separately; references are not implementation proof. Azure release-only deployment stays unchanged. Report publication/access failures honestly, never bypass them with account changes or alternate unauthorized writes.

## Historical briefs: map prototype

| Brief / objective | Depends on | Boundaries | Acceptance | Size |
| --- | --- | --- | --- | --- |
| **1. Establish browser shell**: strict TS, Vite, Babylon WebGL2, Node Vitest, Playwright | None | One package; `src/game`, `src/rendering`, `src/ui`; no gameplay | App boots; unsupported WebGL2 has useful message; existing scripts support typecheck, domain and browser checks | S |
| **2. Build deterministic map model**: implemented generator/tests; retain regression gate | 1 | No DOM/rendering; 8–256 integer dimensions; seed 1–64 ASCII alphanumeric/underscore/hyphen; version 2 FNV-1a/Mulberry32 | Fixed fixtures repeat; invalid inputs rejected; rectangular IDs equal `z * width + x`; explicit PRNG state and stable iteration tested | M |
| **3. Render voxel terrain**: Art Deco materials and silhouettes | 2 | Greedy-meshed voxel chunks of 64×64 columns; no units or economy | All terrain distinguishable; 32×32 showcase and 256×256 fixture render; regeneration disposes old resources; heightfield picking returns canonical tile IDs | M |
| **4. Make map inspectable**: fixed orthographic camera, bounded pan/zoom, picking and inputs | 3 | No rotation; no movement; future HUD controls not presented as functional | Resize/touch/mouse work; corner picks resolve canonical IDs; reset and regeneration clear stale selection; validation errors visible; keyboard-accessible inputs | M |
| **5. Verify prototype**: browser regression and measured benchmark report | 4 | No gameplay expansion or speculative optimization; initial shorter software-rendered runner evidence is not the full future device protocol | Domain/browser checks pass; sample duration/environment and limitations published; measured results separate from provisional budgets; regeneration and WebGL2 fallback covered; unperformed full-protocol checks explicitly pending | M |

Briefs 1–5 describe the map foundation; the README records actual verification and outstanding device-validation limitations. **Briefs 6–7 are implemented:** scout exploration, deterministic commands, six-direction hex A*/Dijkstra, movement budgets, faction fog, city founding, yields, growth and a one-item production queue. **Recommended next work follows P1–P6 in the new plan**, not the old automatic jump to brief 8: confirm the full integrated baseline, then close the human-versus-human match loop. Named-device performance and accessibility verification remain separate release gates.

## Historical briefs: earlier first-playable proposal

Parent issue #5 has child issues #7–#15 for briefs 6–14 below. These tables retain traceability to existing issues, **not authority for the new target**. In particular Meridian/Lantern features, mandatory AI, peace-first diplomacy and victory only after all of them are superseded. Completion of briefs 6–7 is not completion of the full two-player match. Reconcile issue scope only through separately authorized remote edits.

| Brief / objective | Depends on | Boundaries | Acceptance | Size |
| --- | --- | --- | --- | --- |
| **6. Add turn commands, movement and exploration** | 5 | Deterministic A*/movement range (four-cardinal at first, six hex directions since rules v3), integer costs, occupancy, one scout and per-faction unseen/explored/visible terrain; no combat/cities | Invalid commands do not mutate state/RNG; stable resolution and path ties tested; move/end-turn reveals only affected tiles; UI/picks hide unseen terrain; UI explains rejected orders | M |
| **7. Add founding, yields and production** (implemented; issue #8) | 6 | Claim radius 1 (hex distance since rules v3), minimum city spacing 5, max two cities/faction; food/material economy; one queue per city; cities drawn as voxel settlements that grow with population and show a built storehouse | Founding consumes a founder; claims cannot overlap; food resolves before growth; shortages prevent growth but do not reduce population in this existing version; Guard/Worker/Storehouse costs and progress are visible; blocked unit placement remains queued and cannot complete twice | L |
| **8. Add workers and roads** | 7 | Turn-consuming improvements on owned deposits; road movement discount | Illegal work rejected; completion updates yields; connected road movement correct; no double completion | M |
| **9. Add tactical combat** | 6 | Adjacent on-map attacks, health and terrain defense; no separate battle scene | Preview matches resolution; death/occupancy handled; attacks and turn limits tested; visible damage explanation | M |
| **10. Add research, policies and unrest** | 7, 8 | Short prerequisite graph, one policy choice, explicit unrest thresholds | Unlocks/effects driven by validated definitions; thresholds and warning UI tested; no silent stacking | L |
| **11. Harden faction fog for combat** | 6, 9 | Extend basic exploration with enemy-unit visibility, last-known terrain; dirty regions/chunks, not whole-map updates per action/frame | Per-faction visibility updates correctly; unseen tiles and hidden units inaccessible through HUD/picks; explored information stays stale until seen; camera motion does not recompute fog | M |
| **12. Add basic diplomacy** | 7, 9 | Peace/war, bilateral proposals; no trade network | Acceptance/rejection and state transitions tested; war gates attacks; proposal UI shows terms | M |
| **13. Add two faction features and AI** | 8, 10, 11, 12 | Meridian civic improvement/unrest benefit; Lantern scout movement bonus; bounded heuristic AI/search; browser workers only after profiling | Both features observable and tested; deterministic decisions, no fog cheating or deadlock; search counts and future turn budget measured on fixed fixtures | L |
| **14. Close the first playable loop** | 13 | One territorial victory, defeat/draw; no additional factions | Two factions can complete a match; win/tie ordering documented and tested; tutorial explains representative features; recorded balance/playtest feedback | L |

**Outside the numbered briefs: play by messenger (implemented; issue #25).** A serverless two-player mode ([ADR-005](architecture.md#adr-005-serverless-play-by-messenger)) lets two people alternate turns by exchanging links, codes or files. It replays the deterministic command log, so every later rules change must stay deterministic and bump `RULES_VERSION`. Potential reliability follow-ups: delta packages once logs get long; verify exchange on real iOS/Android and assess cross-device generator arithmetic. A relay or WebRTC is not part of this target and requires a separate architectural decision. (Drawing cities, founders and opponent units is done with the hex voxel world.)

**Outside the numbered briefs: hex voxel world (implemented; issues #26 and #27).** Hex fields built from cubic voxels after the approved concept, with territory borders, city name plates and voxel unit figures ([ADR-004](architecture.md#adr-004-map-and-rendering)). Issue #30 / merged #31 adds reference colours, four underwater terraces, sandbanks, coastal rocks, smaller trees, resources and sharp hex frames; the prerequisite #28 and integration are complete. Generator v4 adds organic bays and low highlands with broad grey deposits. Zoom restores up to 16 voxels per hex in bounded windows through the hard 256² map maximum. Sparse, throttled water glints respect reduced motion. At the maintainer's explicit request, rules v4 and direct selection extend movement to all existing unit types and add availability glows and city-production selection. Readable older-rule/generator saves are retained without migration. This does not complete worker improvements/roads (brief 8), combat (brief 9) or harvesting. Rivers, bridges, further resources, palms, fields and harbours also remain deferred.

## Historical briefs: reliability and later depth

The future ordering and scope below are retained for issue/history traceability only. The new dependency plan governs work: validated messenger replay already exists, four tribes and human victory no longer wait for all old systems, and deployment remains Azure Container Apps rather than the old brief 23 static-host proposal.

| Brief / objective | Depends on | Boundaries | Acceptance | Size |
| --- | --- | --- | --- | --- |
| **15. Add validated saves and replay** | 14 | Versioned schema/rules/content/generator/RNG; explicit migrations only | Round-trip state/RNG exact; rejected corrupt/unsupported inputs; replay hashes match; no render objects in saves | L |
| **16. Deepen exploration and infrastructure** | 15 | Biomes, strategic extraction, embarkation, logistics | New map/rules versions documented; movement and economy edge cases tested; measured performance remains reported | L |
| **17. Deepen cities, research and society** | 15 | Districts, queue projects, research branches, policy slots, revolt/recovery | Effects and dependencies validated; unrest offers recoverable decisions; costs and outcomes legible; balance tests/playtests recorded | L |
| **18. Deepen conflict and diplomacy** | 16, 17 | Ranged/siege units, treaties/trade, AI personalities; no multiplayer commitment | AI respects legal commands/fog; combat previews remain correct; treaties resolve consistently; bounded decision time measured | L |
| **19. Expand victories and faction content** | 18 | Research/diplomatic/civic goals and new factions only after two-faction balance | Every victory has tested simultaneous-outcome rules; faction features are distinct and understandable; full-match playtests completed | L |
| **20. Harden browser release** | 19 | Accessibility, onboarding, device compatibility, delivery and dependency/terms review; no source license choice here | Keyboard and contrast checks; named-device benchmarks; loading/error/recovery flows; save compatibility policy and release checklist reviewed | L |
| **21. Measure larger-world generation** | 14 | Connected land/water, validated starting positions and resources; explicit generator-version bump; retain 256² fixture, expand dimensions only after measurement | Multi-seed connectivity/placement tests; generation/frame/pick/memory/draw/AI costs published against named hardware; chunk culling/dirty updates verified; no universal FPS gate; workers only on profiling evidence | M |
| **22. Establish original asset pipeline** | 5 | Blockbench cuboid models, optional Blender cleanup, versioned glTF/GLB export and scale/origin conventions; procedural placeholders remain runnable | One original unit and building imported with materials/silhouette checks, batch/draw budgets measured; source provenance and licenses recorded; tools not required to run app; no third-party game assets | M |
| **23. Package an accessible first-playable preview** | 14, 21, 22 | Static-host build/config, keyboard map navigation and text equivalent, contrast/non-color markers, reduced motion; no accounts or wrapper | Windows Chromium/Edge smoke test; keyboard-only full match; documented deployment/base path; automated build/browser suite; owner license decision requested before release, never selected automatically | M |

Later briefs describe outcomes, not authorization to expand this PR. Re-estimate and split them using measured prototype and first-playable evidence; create issues only through a separate explicit action.
