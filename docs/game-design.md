# Polaris: game design

## Vision and scope

An original, browser-first, turn-based 4X game about rival societies rebuilding a fractured world. Explore readable voxel landscapes, grow cities, and choose between cooperation and conquest. Art Deco geometry gives the world civic grandeur without copying an existing game's art, names, factions, or rules.

**Implemented scope:** seeded terrain with canonical four-tier water depth and offshore shoals (G1/#53), an interactive camera, tile/depth inspection, scout movement and faction fog, the first city/economy/production slice (roadmap briefs 6–7), and a validated shared-landmass scenario scaffold (P2/#36) for two-player messenger matches. Players independently choose presentation-only tribes; three public reserved beacons, drawn as neutral voxel lighthouses once charted, and later-founder production are implemented. Boats, separate playable island starts, combat, worker actions, research, diplomacy, AI and victory remain planned. The [visual mockup](visual-mockup.svg) is an original labeled concept, not a screenshot or implementation commitment.

**Canonical design, status checked 12 November 2026:** this document contains both the implemented contracts and the complete target design. [The roadmap](roadmap.md#detailed-target-delivery-plan) owns delivery packages and acceptance; [architecture](architecture.md#planned-target-domain-and-compatibility) owns technical compatibility. The entire foundation #20 → #21 → #22 → #24 → #29 → #31, design #33/#34 and save reliability #47 are integrated into main at `c6c4cad`. Target gameplay remains planned. [Current running-application screenshots](../README.md#current-verification-and-screenshot-provenance) show only the implemented foundation; the reference images remain unchanged.

## Map contract

- Pointy-top **hex tiles** in odd-r offset rows (odd rows shift half a tile east); world axes are **x east, z south, y up**.
- Movement adjacency is the six hex neighbours; every step has the same length, so there are no diagonals or corner cases.
- Dimensions are integers from **8 through 256**, inclusive, on each axis.
- Seeds are strings of **1–64 ASCII letters, digits, underscores, or hyphens**; preserve case and reject invalid input rather than silently rewriting it.
- Default showcase: **32 × 32**. Stress fixture: **256 × 256**.
- A seed, dimensions, generator version, and rules/content versions identify a reproducible map.
- Implemented generator version 5 hashes the ASCII seed with FNV-1a and uses Mulberry32. It preserves generator-v4 land/water identity, broad separated landmasses, warped shores, deep ocean-connected bays, land elevations, trees and RNG progression. G1/#53 adds one canonical depth tier to each water hex: **shallow, shoal, shelf or deep**. Variable coastal widths and broad submerged offshore sandbanks create irregular shallow regions, including extensions beyond two hexes from land; no fixed coastal-radius rule or guaranteed island connection. These remain water, not walkable or landable sand islands. Depth is fixed at generation and cannot change with exploration, zoom or decoration; charted-water inspection names it. Rules v5 adds the P2/#36 scenario scaffold; all water remains impassable and messenger starts share one connected landmass until P3a. Older-generator and older-rule matches are kept unchanged but require a compatible version to resume. Movement traversal order is east, south-east, south-west, west, north-west, north-east.
- Target terrain vocabulary: plains, forest, hills, mountains, and water. The current renderer builds grassland, hills, water and decorative trees from cubic voxels inside each hex; forests and mountains as terrain types are art direction, not a claim of implemented assets. Prototype resource markers are decorative or inspectable data only, not an economy.

## Planned core loop

**Explore → settle and supply → position and fight → hold the beacons → win.** Two human players use the existing serverless messenger mode; AI, diplomacy and research are not prerequisites for the first complete match.

| Target layer | Planned scope | Delivery boundary |
| --- | --- | --- |
| Complete core match | Small fair hex map, on one landmass or with separate home and beacon islands; common Landing crossing over coastal water; three common counter-classes, deterministic combat and city capture, three beacons, defeat and draw | First; may retain the existing generic-material economy as an explicitly versioned intermediate slice |
| Economy and cities | Six resources, population-operated improvements, paid construction, housing, territorial expansion without a city cap, hunger and military food debt | After the core match; small research tree accompanies the full economy; no implicit save conversion |
| Four tribes | Amazons, Raccoons, Engineers and Sorceresses; independent choice including mirrors, initially one characteristic ability each | Full two-tier unit and building/ability catalogs remain expansion goals |
| Later depth | Additional tribal content, optional diplomacy/policies and bounded fog-respecting AI | Not blockers of human-versus-human victory |

Costs, ranges, yields and thresholds belong in versioned definitions, not UI code. The [decision register](#target-decision-register) separates chosen direction from proposals and unvalidated test values.

### Implemented exploration slice (rules version 1)

The atlas is unchanged by default; **Start expedition** starts one Meridian scout on the largest connected landmass, nearest the map center (ties use canonical tile ID). The scout has 4 movement points and sight radius 2 (hex distance since rules version 3), with no terrain occlusion at this stage. Grassland costs 1 and hills 2 to enter; water is blocked. Trees are decorative and add no movement cost.

A* finds a destination route, bounded by remaining movement; Dijkstra produces the reachable range. Both use charted, unoccupied terrain only, the fixed hex neighbour order and FIFO ties at equal priority. Movement resolves immediately and reveals sight along the route; rules v4 retain the combined current sight of all own units and cities. End-turn activates the next faction and refreshes its movement; the round increments on wrapping to the first faction. With one faction, each end-turn increments the round. Production can add a new unit's sight.

Commands carry faction and monotonically increasing sequence IDs. Invalid orders leave state, history and RNG unchanged. No command currently consumes randomness. Accepted commands are retained in memory for deterministic tests; this is not a save/replay format. The UI offers one scout without opponent AI or faction bonuses. Multi-faction turn order, occupancy and separate fog are domain-tested foundations, not a claim of a complete match.

### Implemented city economy slice (rules version 2)

Each faction starts with one scout and one founder on adjacent land. Founding consumes the founder. A founder may settle only explored land outside every existing city's claims and at least five hexes from another city; a city claims unowned land within hex radius 1 (its own hex and up to six neighbours). Each faction is capped at two cities. Since rules version 3 each city takes the next name from its faction's fixed list (Meridian: Sonnenfurt, Lichtau, …; Lantern: Nordhain, Silberbach, …) in founding order.

Claimed grassland yields 2 food and 1 material per turn; hills yield 1 food and 2 materials; water cannot be claimed. At each active faction's end turn, its cities resolve in founding order: add yields, consume 2 food per population, grow by at most one population if the remaining food reaches `8 + 4 × current population`, then apply materials to the single production queue. If available food cannot cover consumption, the stockpile becomes zero and population does not grow or decline. These initial values are explicit rules-versioned definitions, not balance claims.

The queue choices are **Guard (8 materials)**, **Worker (10)**, **Storehouse (12)** and **Founder (18, provisional)**. The extra founder price exceeds the current unit/building choices to make expansion a deliberate production commitment; it is not a verified balance value. A completed Guard or Worker appears on the first free adjacent land hex in the fixed hex neighbour order. A later Founder uses that same deterministic placement order and can be queued only while the faction has an unfilled city slot after counting existing cities, founders and queued founders. If all adjacent land is occupied, a completed unit/founder remains at full progress and retries on a later turn; unspent materials remain in the city's stockpile. A Storehouse adds 1 material per turn after completion. Guard combat and Worker actions are not implemented. The HUD exposes city population, food/material stockpiles and yields, claim size, queue choice/cost, progress, and explicit order rejection or completion messages.

### Direct orders and availability (introduced in rules version 4)

Tap/click an own unit or its hex to select it. Only its affordable destinations are highlighted; tapping one moves immediately, with no second confirmation button. Scouts retain 4 movement points; founders, guards and workers have 2. Every unit and city provides radius-2 sight; movement reveals its route while the union of current own sight remains visible. Incoming units regain their own budgets at turn start. Existing terrain costs and occupancy still apply. Guard combat, worker improvements and roads remain deferred.

A static glow marks own units with at least one legal destination. Exhausted or blocked units do not glow; selecting them remains possible. Own cities glow while their production queue is empty. Tapping the city or its name plate selects its production controls; queuing removes the glow, completion restores it. Selection has its own outline and accessible pressed state. While waiting for the opponent, neither units nor cities glow or accept orders. The sidebar scout shortcut, city selector and direction buttons remain available. The current game rules are version 5; readable older-rule saves are preserved unchanged and never replayed under different rules.

### Implemented: play by messenger and P2 scenario

Two players play the same seeded world without a server. Player 1 creates the match and moves first; each player independently chooses one of four **presentation-only** tribes, including mirror matches. The existing player-specific Meridian/Lantern factions remain internal ownership and turn-order IDs; they are not tribe IDs. A deterministic scenario places both players on the largest connected landmass, with one free scout and founder each, and reserves three public beacon tiles. The validator checks land reachability, free beacon neighbours, room for two further legal city sites per player and weighted travel-turn differences of at most one for mirrored starts and beacon targets; failing maps are rejected, never bridged. Scenario version and tribe choices travel with each turn; the map seed reconstructs the validated placement. No faction-wide stockpile exists in this prototype, so neither player is granted one; existing food/materials are city-local and begin at zero when a city is founded.

On their own turn a player gives legal orders, then ends the turn. The finished turn travels as a link, a code or a file through any chat, and the opponent's device replays it and takes over. Turns strictly alternate; the round counter increases after both factions have played. Nothing resolves simultaneously, and an opponent's message can never contain orders for the receiving player's side. A player can run several matches with different people at once; each received turn opens its own match after the current one is safely saved, and a list shows where it is their turn.

The messenger transport retains at most 10,000 orders per match, with the final slot reserved for End turn. At capacity, no further orders are accepted; this is not victory/defeat/draw and does not change solo rules. Readable already-over-limit archives stay stored and listed without replay. Storage failures show a persistent warning and keep an unsaved match open when shelving or switching; explicit Leave is the discard path. Keep the page open and save/send a completed turn before leaving if local storage is unavailable.

Fog stays per faction: each player sees only their own explored and visible tiles, and the HUD lists only their own cities. All three beacon markers are public from the start and their tiles cannot be used as city sites; once a player charts a beacon, it appears as a neutral voxel lighthouse. Activation, combat and victory are not implemented. The shared-landmass start is reachable by land; all water remains impassable and separate islands are not playable yet. Both devices hold the whole match, so fog is a courtesy rule rather than a secret, and the mode suits friends rather than ranked play. The map draws every unit as a small voxel figure with its faction colour and each city with a name plate and a coloured territory border; the opponent's cities and units appear only while they are in sight. A match has no victory or defeat condition. The technical design is [ADR-005](architecture.md#adr-005-serverless-play-by-messenger).

## Target status and baseline

The following is the complete planned game, not a description of executable gameplay. It supersedes earlier future proposals, never the implemented versioned rules above.

| Label | Authority |
| --- | --- |
| **Confirmed** | Chosen product direction; do not reopen as an undecided requirement |
| **Target** | Intended gameplay, not implemented behavior |
| **Test rules / test value** | Coherent provisional implementation/playtest fixture, not verified balance |
| **Proposal** | Recommended edge-case resolution to confirm before implementation |
| **Implemented baseline** | Versioned executable contracts in the current repository; not a claim of completed target gameplay |
| **Later** | Not a prerequisite for the first complete two-human match |

Unless explicitly described as implemented, **all target numbers are test values**. Tribe, unit and building names are working names; their English names below are the canonical documentation vocabulary, not a migration of stored content IDs. Confirmation of a direction does not validate its balance.

The historical main commit `6aa2dbe8d45ccea58def5054ff32a55295a22b04` had a four-neighbour square atlas, generator 2, rules 1, scout movement, faction visibility and turns. It is not the functional basis of this plan. The design was prepared against `klaus/graphics-polish` at `834ffc491fa4932e3c719191db837b3fea639445`, cumulatively including #20, #21, #22, #24, #29 and #31. That foundation and the complete design integrated on main at `f3f07d4`; save reliability #47 followed at `c6c4cad`, without changing the versioned game rules.

| Baseline area | Development contract to preserve | Target change |
| --- | --- | --- |
| Cities/economy | Rules introduced in v2: two-city cap, radius 1, spacing 5, food/materials, single queue | Explicitly replace with workforce, six resources and hunger in new rules |
| Two humans | Host Meridian, guest Lantern; complete serverless command replay | Separate player slots from tribe definitions |
| Hex world | Pointy-top odd-r; six neighbours; IDs `z * width + x` | Use hex distance, never Manhattan distance |
| Direct orders | Rules v4: all existing unit types move; combined own unit/city sight | Do not regress to an immobile founder |
| Terrain/rendering | Generator v5 adds canonical water depths to unchanged v4 landforms; voxel meshing, fixed orthographic camera, real ocean-connected bays | No new engine or incidental topology change; boating remains P3a |
| Resource pictures | Apples, fish and stone are visual occurrences only | Do not treat them as harvestable economic deposits |
| Storage | Incompatible rules/generators are not replayed; readable saves remain stored | Preserve explicit version boundaries |
| Missing gameplay | Combat, worker jobs, research, diplomacy, AI and victory | Documentation must not present them as finished |

This baseline was checked against `src/game/expedition.ts`, `src/game/map.ts` on historical main and `src/game/hex.ts`, `src/game/expedition.ts`, `src/game/match.ts`, `src/exchange/match-storage.ts` and documentation in the cumulative commit. All six PRs, including graphics polish, are integrated groundwork to preserve. The documentation issue #32 is complete; its target gameplay is not. Current package issues and actual blocked-by relationships are recorded in the [roadmap](roadmap.md#existing-dependencies-and-legacy-issues); do not infer new implementation or merge approval from this historical baseline.

## Target world and player promise

Two humans each lead one of four tribes across a readable hex map. They explore, found and supply cities, develop resources and command a few distinct troop roles. Three ancient beacons create a visible conflict: hold at least two through three own turn endings to win. Conquest is a means, not a requirement to exterminate the opponent. Routes, supply, construction choices and three-class interplay provide depth without an unbounded collection of exceptions.

### The beacons and the Extinguishing

Monumental beacons once linked cities as navigation points, message hubs and carriers of an enigmatic energy. The **Extinguishing** broke the network. Cities became isolated, knowledge fragmented into local traditions, and new communities formed.

Now one beacon shines again. Some see a shared future; others fear the return of a danger nobody understands. The cause of the Extinguishing deliberately remains unresolved. Engineers understand maintenance, conduits and mechanics; Sorceresses know resonances, songs and signs. Neither owns the whole truth.

The origin of upright Raccoons is also open. Damaged ancient installations near their settlements are a clue, not a scientifically established explanation. Neither a campaign nor a technology must resolve that mystery.

### Design principles

- Four complete societies with daily life, internal disagreements and architecture, not caricatures of single traits.
- Shared legible rules; differences change preparation and decisions rather than giving one tribe universally better statistics.
- No gender-dependent combat values.
- Deterministic previews, not hit rolls, critical hits or hidden random events.
- Fair accessible essentials; rare crystals and ruins are advantages, never prerequisites for a basic counter.
- Browser-first, two humans by messenger; no server, networking replacement or engine change.

## Target scenario, geography and information

Exactly two opposing **player slots**, not four participants. **Confirmed:** each chooses any of the four tribes independently; mirrors are allowed from the start. Units, cities, commands and research belong to distinct player IDs, not a shared tribe ID. The host creates the seed, map/rules/content versions, first player and both tribes; the guest confirms the same package. Hosting and moving first must not be permanently tied to a tribe.

**P2 scaffold implemented (rules v5, scenario v1):** player 1 chooses both tribe assignments independently, including mirrors; the current Meridian/Lantern faction IDs remain player-specific ownership/turn IDs, separate from tribe IDs. A deterministic validator places both players on the largest connected landmass, gives each one free scout and founder, reserves three public beacon tiles and verifies weighted travel turns, adjacent beacon space and two further legal city sites per player. Failing seeds are rejected rather than repaired. The match package carries scenario version and tribe IDs; placements are reconstructed from the seed. Tribe choices currently affect presentation only. The prototype has no faction-wide stockpile, so neither player receives one; city-local starting food/materials are zero. Later founders can be produced while a city slot remains. This scaffold does not implement beacon activation, combat, victory, or island crossings.

A deterministically generated and validated **shared-landmass** map is implemented first in P2. **24 × 24** is a tested fixture, not a mandatory size. Home-island and beacon-island topologies remain P3a; measure travel, match duration and mobile legibility before requiring larger worlds.

**Chosen start:** one founder and one scout each, no completed army. Equal faction stockpiles remain a target, but the current prototype has no faction-wide inventory model and therefore grants none to either player. The first city and production path to all three basic classes require no research, crystals or salvage. The initial founder is explicitly free scenario equipment; subsequent founders are expensive production choices. An immediate army containing each class belongs only in a separate combat fixture.

### Geography and fairness

Use the fixed six-neighbour order east, south-east, south-west, west, north-west, north-east. Land units never walk on water; they cross coastal water only as embarked boats ([water crossing](#water-crossing)). Mountains as a domain terrain type remain later; visible stones do not make land impassable. Decorative trees imply no forest movement obstacle or defense.

Each starting region needs food, reachable wood/stone and a reliable early metal path, not necessarily all inside the first city. Crystals and ruins may be contested. Random placement must never deny a tribe its three basic counters.

Three neutral beacons occupy reserved legal land: one nearer each start and one contested central site. Each may lie on a start landmass or on its own beacon island, and each is reachable from both starts with the common baseline crossing. Compare **weighted path cost**, choke points, arrival time and supply access, not just geometric distance. Fair routes need not look identical. Beacons cannot double as city or resource sites.

**Chosen direction: separate islands allowed (Klaus, 12 November 2026).** This replaces the earlier shared-landmass proposal, which could leave too little room on small maps. Two independent choices shape a scenario: both starts share one landmass or each uses its own **home island**, and each beacon lies on a start landmass or on a neutral **beacon island**. Island beacons are deliberate strategic objectives: holding one requires landing troops and supplying a crossing. Every combination is legal when validation passes (details are proposals; numbers are test values):

- **Room:** each player has the start plus at least two further legal city sites at the minimum spacing on its home landmass (on a shared landmass, sites nearer its own start than the opponent's), and a legal coastal city site on land next to navigable shallow water, so the first city can build a Landing.
- **Reachability:** from each start, the opponent's start and all three beacons are reachable with the **common baseline** only: land movement plus connected shallow-water routes through a Landing. Deep water, Harbours, research, [tribal water styles](#water-crossing), bridges and ruins never count.
- **Contestability:** each beacon has at least two free adjacent land tiles, so an occupant can be attacked after a landing; boats cannot attack.
- **Fairness:** compare baseline travel turns of a basic combat unit, not geometric distance: 2 land movement with hills costing 2, embarking and disembarking each end the turn, 3 shallow-water hexes per turn and equal Landing lead time. Each player's travel turns to its own near beacon, to the central beacon and to the opponent's start may differ from the opponent's mirrored value by at most 1 turn.

Maps that fail are rejected, never repaired with land bridges, a teleport or forced paths. Further islands are expansion space reached through shallow-water routes, a later Harbour or a tribal style; nothing needed for victory or the three basic counters lies only there. An earlier generator-v4 proximity probe found that water within 2 hexes of land connected the two largest landmasses on 7 of 10 multi-island maps and water within 3 hexes connected all 10, with crossings of 1–14 water hexes; some islands lie only across open sea. These figures are exploratory only: the chosen direction replaces distance-based water classes with generated depth zones, which P3a must validate. On a shared landmass, starts were 7–30 land steps apart.

### Visibility and public objectives

Own knowledge has unknown, explored and currently visible states. Enemy units and changing enemy economy are known only in current sight; remembered information is explicitly last-known. Attacks, including ranged attacks, require current sight.

**Safe-order proposal:** march destinations and executed route segments must be currently visible; scouts extend sight through individual advances. Remembered terrain may show a nonbinding travel plan, but range searches, tooltips and rejection reasons must not disclose hidden occupancy. Alternative exploration orders need their own tested information contract.

Beacon positions, owners and streaks are public from the start. Ownership changes reveal only the objective event, not nearby terrain or the acting unit. The UI separates public objectives from sight data. Both messenger copies contain the whole match: fog is courtesy protection for trusted players, not cryptographic secrecy or an anti-cheat promise.

## Target resources and improvements

### Six resources

| Resource | Source | Use | Limit |
| --- | --- | --- | --- |
| Food | Fields, orchards, fisheries | Population, growth, army upkeep | Local city stores and bounded turn yields |
| Wood | Managed forests | Buildings, routes, weapons, optional machine operation | Initially renewable; no automatic clear-cutting |
| Stone | Quarries and suitable hills | Administration, fortification, infrastructure | Initially nondepleting |
| Metal | Explicit visible ore deposits with mines | Troops, workshops, advanced upgrades | One metal, not iron/copper subsystems |
| Crystals | Rare resonance deposits with collectors | Paid abilities and advanced buildings for every tribe | Bounded yield; never required for basic counters |
| Salvage | Displayed finite ruin inventory | Reconstruction and lossy wood/metal conversion | Extraction reduces that specific inventory to zero |

The first five initially provide steady bounded yields without deposit depletion. Sustainable forestry is standard; clear-cutting is a later decision. Construction work and research are **progress**, not seventh/eighth stockpiled resources. Nonfood resources are faction-wide; food stays local. HUD must explain that distant metal can fund a build, but an unconnected orchard does not feed a city.

### Worker jobs and population operation

A worker begins a paid job on explored own land assigned to an own city. Check terrain, deposit, unlocks, resources and legal occupancy before starting. Count work in own turn endings. **Proposal:** remaining at the site uses all movement/action; leaving interrupts the job but retains paid progress.

After completion the worker can leave. Yield requires assigned population, required connection and no enemy occupation. An improvement does not permanently require a worker figure.

| Improvement | Prerequisite | Cost/work profile | Effect |
| --- | --- | --- | --- |
| Field | Suitable own land | Small: wood, little work | Food |
| Orchard | Canonically usable fruit deposit | Small: wood/work | Food; an apple picture alone is insufficient |
| Forestry | Canonical wood deposit | Small: wood/work | Sustainable wood |
| Quarry | Suitable hill/stone deposit | Small: wood/work | Stone |
| Mine | Explicit ore deposit | Medium: wood/stone/work | Metal |
| Fishery | Own coastal water beside accessible own land | Small: wood/work from land | Food without a fleet |
| Crystal collector | Crystal deposit | Medium: wood/stone/metal/work | Crystals |
| Salvage site | Ruin with remaining inventory | Small: wood/work | Finite salvage; owner sees remaining inventory |
| Road | Legal own land | Small wood/stone/work per segment | Transport connection; movement effects separately versioned |

The [shared test data](#provisional-shared-test-data) are an economy fixture, not current terrain yields or validated balance.

### Connections, occupation and dismantling

The centre and adjacent own city tiles are connected. More distant improvements require an uninterrupted own road to the centre or an explicitly equivalent tribal connection. Water cannot bridge a road gap; a fishery uses its land access. Drawing a road never makes impassable terrain traversable.

Enemy occupation stops a tile's yield; occupying a required road interrupts dependent operations. It does not automatically destroy anything or block all food merely because an enemy is nearby. Enemy civilians also count as occupiers but gain no control zone.

Dismantling is an explicit logged worker job. **Refund proposal:** normal dismantling returns at most half the resources actually paid, rounded down per kind; Raccoons at most three quarters. Use the paid-cost receipt, never list price or the market value of a freely captured building. No work, upkeep, spent charges or duplicated material refunds. Ruins help Raccoons but are not an existence requirement.

## Target cities, population and production

**Ownership** permits use and prevents foreign founding; **operation** requires assigned workforce; **connection** permits transport. Purchased, unimproved or disconnected territory has no automatic yield.

### Founding and territorial expansion

Founding consumes an own founder on free legal explored land, outside foreign territory, unoccupied and not a beacon. Claim the centre and up to six unowned neighbours. **Target change:** adjacent coastal water may be claimed for fisheries, without making water walkable. Existing assignments are not overwritten; preview the actual claim.

| Maximum reach | Unlock | Actual effect |
| --- | --- | --- |
| Radius 1 | Founding | Initial claim, not automatic operation of every tile |
| Radius 2 | Population at least 4 plus council house/equivalent administration | Individual connected tiles may be claimed through projects |
| Radius 3 | Population at least 7 plus higher administration | Individual projects, not a free outer ring |

Expansion stays within unlocked hex distance and adjacent to that city's territory. **Proposal:** one currently visible unowned tile per project, small/medium costs increasing with distance. Enemy occupation blocks both start and completion; never query hidden occupancy outside current sight. Each tile belongs to exactly one city. No passive cultural takeover; first legal ownership persists. Own cities may explicitly transfer an adjacent tile if both territories remain connected and radius limits hold. Its improvement and paid-cost receipt transfer too; workforce assignments are revalidated. City centres cannot transfer separately.

**Test spacing:** city centres at least **4 hex steps** apart. Radius-3 catchments may geometrically overlap, but ownership cannot. Overlap creates choices rather than an entitlement to a full ring. The existing spacing 5 remains only in older rules.

**Confirmed: unlimited city count**, including founded, captured and lifetime-founded cities. Legal sites, spacing, resources, supply and founder opportunity costs constrain expansion. The implemented two-city cap is not a target rule.

Additional founders cost approximately **three base combat units' work**, plus wood, stone and local food, with no implicit population spend. Reserve the local food package at production start; carry it as provisions on the completed founder and transfer it into the new city on founding. Death destroys provisions without loot. A blocked output creates neither a second founder nor extra food. The initial free founder exception does not repeat for later cities.

### Workforce, building slots and housing

Each population group provides exactly one workforce slot, operating either an improved tile or a staffed building. Ordinary unit production does not consume population; neither does initial founder production.

**Deadlock-free test start:** an unstaffed centre yields 3 food and 2 work per own ending. A city starts at population 1 with a completed initial field on the first suitable own neighbouring land in hex order. Without a suitable neighbour the site is invalid in the first test map. The field belongs to the founding package; its paid dismantling receipt is zero. New cities generate no free shared resources; only scenario setup grants initial stocks. Basic buildings/troops need no metal; metal improves tier 2.

Automatic profiles are growth, production and balanced. Legal manual pins take priority; remaining slots use prioritized yield and tile/building ID ties. Population loss releases unpinned assignments first, then most recently pinned, with ID ties. UI distinguishes unstaffed, disconnected and enemy-occupied workplaces.

**Deterministic assignment proposal:** let `N` be food, `A` work and `R` the sum of five nonfood yields. Growth scores `4*N + A + R`, production `N + 4*A + 2*R`, balanced `2*N + 2*A + R`; highest first. Non-numeric functions without direct yield require explicit activation/pins, not invented utility scores. Sort candidates once from one snapshot and assign each at most once. Weights are test values; later need-aware heuristics require equally reproducible rules.

**Slot proposal:** four special building slots per city; middle/higher administration opens a fifth/sixth. Centre, housing and fortifications are outside these slots. Tribal chains and common storehouse/administration/knowledge buildings each use one. A tribal equivalent replaces the common function rather than stacking a second bonus. Upgrades retain their slot. A Path House thus competes with other development rather than granting free superior roads. Every tribe has common administration; conquest is not required for radius 2/3.

| Housing tier | Population limit | Prerequisite / profile |
| --- | --- | --- |
| Founding | 3 | Centre |
| Housing compound | 6 | Cultivation Methods; wood/stone, medium work; **no** population-4 or council-house requirement |
| Expanded residential quarter | 9 | Compound and City Planning; stone/metal, high work; **no** population-7 requirement |

Housing is separate from territory reach. Hunger does not remove an unlocked administration building. **Proposal:** achieved reach remains unlocked and population loss does not revoke existing tiles.

**No progression deadlock:** Stockpiling → Cultivation Methods enables housing at population 3, then growth to 4. Roadbuilding → City Planning plus council house then permits radius 2. City Planning and the compound enable housing 9 before population 7 and higher administration unlock radius 3. Research, basic food and housing need no outer ring.

### Food, growth and hunger

Each population group consumes 2 food per own ending. After supply and deliveries, growth requires `8 + 4 * current population` food and free housing. Grow at most once and subtract that threshold once. New population works/eats only from the next own turn.

**Storage proposal:** base capacity 24, storage tiers 36/48/60 as functional equivalents. Test growth before final capacity clamping. Missing housing or blocked growth does not consume the threshold; overflow above capacity is visibly lost. Display stock, capacity, consumption, growth blockers and expected overflow.

Underfed population increments local hunger. First consecutive own ending warns; second loses one population, then persistent hunger loses at most one per ending, never below 1. Full feeding resets the counter. Army shortage alone is not civilian hunger. Population loss precedes growth; a hungry city cannot grow in the same ending.

This intentionally changes the prototype's zero-food/no-population-loss shortage behavior. Old saves retain their old version's outcome.

### Production, upgrades and cancellation

Each city has one active queue. Buildings, troops, research preparations and city projects need a resource vector plus local work. Reserve resources at start, removing them from freely available stocks. Work is local and is not banked without an active project.

Small profiles emphasize early wood/little stone; medium wood/stone and sometimes metal; large multiple basics/metal and sometimes crystals. Duration follows actual work, not an independently promised turn count. Missing special prices must never mean zero.

Upgrades require the previous tier, unlock and free city access. They replace rather than stack the predecessor's whole yield. Everyday operation primarily needs workers, not automatically fresh resources each turn. Only explicit conversions, machine operation or abilities incur ongoing materials.

**Cancellation proposal:** for paid cost `C`, required work `W`, progress `p`, refund each resource as `floor(C * (W - min(p,W)) / W)`. Already installed materials cannot be refunded again by dismantling. A fully worked but blocked troop has no unused material remainder. Show receipt, refund and final loss before confirmation.

Founder food stays local within its paid vector. Refund only the unused portion to the original still-own source city, capped by free storage; disclose overflow loss. Foreign capture never pays it to the new owner or a global food pool.

Completed units appear on the first free legal neighbouring tile in fixed hex order. Blocked outputs wait at full progress; no overwrite, stacking or double completion. **Proposal:** new/upgraded units are exhausted until next own turn; upgrades retain proportional health damage and reset neither counter budget nor upkeep.

### Provisional shared test data

This is a coherent initial implementation/playtest dataset, **not measured balance** and not a replacement of rules v4. At 2 centre work, a 12-work soldier takes 6 own endings and a 36-work founder 18. Faster expansion requires prioritizing work over food/resources.

| Test definition | Integer value |
| --- | --- |
| Scenario equipment per player | 20 wood, 12 stone, 0 metal/crystals/salvage; founder carries 12 food; one scout, no army |
| Population / centre | Population 1; centre 3 food + 2 work; no free research per city |
| Field / orchard / fishery | 4 food per staffed workplace |
| Cultivation Methods field upgrade | 5 instead of 4 food; paid 4 wood + 2 worker endings; no automatic global yield increase |
| Forestry / quarry / basic mine | 3 wood / 2 stone / 2 metal per workplace |
| Crystal collector / salvage site | 1 crystal / at most 2 salvage until inventory zero |
| Test ruin inventory | 12 salvage per canonical ruin, no regeneration |
| Common workshop workplace | 3 additional work, one workforce slot |
| Basic Bulwark | 6 wood + 4 stone + 12 work |
| Basic Assault | 8 wood + 2 stone + 12 work |
| Basic Breaker | 10 wood + 4 stone + 12 work |
| Scout / worker | 4 wood + 8 work / 6 wood + 2 stone + 10 work |
| Additional founder | 12 wood + 8 stone + 12 local food + 36 work; no population |
| Field, orchard, forestry, quarry, fishery | 4 wood + 2 worker endings |
| Basic mine / crystal collector | 4 wood + 4 stone + 3 worker endings / additionally 2 metal, 4 worker endings |
| Salvage site / road segment | 2 wood + 2 worker endings / 1 wood + 1 stone + 1 worker ending |
| Small / middle / high building tier | Initial profiles: 8 wood + 4 stone + 12 work / 12 wood + 8 stone + 4 metal + 20 work / 16 wood + 12 stone + 8 metal + 28 work |
| Housing compound / residential quarter | 8 wood + 4 stone + 12 work / 12 stone + 4 metal + 20 work |
| Additional territorial claim | Radius 1: 2 wood + 2 stone + 4 work; radius 2: 4 wood + 4 stone + 8 work; radius 3: 6 wood + 6 stone + 12 work |

A worker ending means one full action of that worker figure, not another population workplace. The common centre workshop is an ordinary special-slot building initially possible without research or metal. Generic storage/administration use these tier profiles; tribal deviations must be priced explicitly. Later second-tier unit prices and every additional special effect must be completed individually before code; they are not all part of the one-ability-per-tribe increment.

## Target supply and turn resolution

### Army food without an opt-out exploit

Each combat unit costs 1 food per own ending; initially no tactical hunger penalty. Civilians initially have no separate upkeep. Each combat unit displays a supply city; road interruption cannot switch off the obligation.

**Confirmed first-iteration abstraction:** the city is an accounting assignment, not a range requirement. It pays even for distant units. On losing it, reassign to the own city with lowest stable ID; assignment changes cannot reduce an already due obligation. Other own cities' surpluses may cover unpaid upkeep in stable order. This is explicitly abstract army accounting, not an implicit general civilian food route.

If total food is insufficient or no cities remain, record **faction-wide food debt** in match state, not as a tradeable resource. It survives city loss, reassignment, dismissal of the unit and import/export. Future free city food repays debt before exports/growth; outstanding debt blocks combat recruitment. Local population reserves its available basic ration before army levy; foreign-city surplus reaches population only through a real delivery route. Existing armies remain tactically unchanged. Without cities, debt continues while a founder prevents defeat; rebuilding does not start debt-free.

This accepted provisional model prevents deleting upkeep through disconnection or renaming. It deliberately permits temporarily unpaid combat instead of desertion/stat penalties. Cityless armies and accumulating debt require focused playtests, not reopening the already chosen direction without a documented revision.

### Intercity deliveries

**Target, expandable after the core:** connected own cities may establish standing food deliveries, initially none to another player.

**Proposal:** source, destination and integer maximum per route; initially at most 4 food per route/ending and 4 total exports per source. Reserve population, assigned current army upkeep and debt repayment first; export only the remainder. Occupied roads visibly suspend rather than delete standing orders.

Compute all exports from one pre-delivery snapshot. Received food cannot be re-exported or increase another export budget that ending. Sort sources by city ID, then routes by destination ID and route ID. Reserve destination capacity in that order across multiple sources; do not send into fully reserved storage. A→B→C therefore cannot circulate food.

### Complete proposed own-ending sequence

Movement, attacks, claims after completed projects and beacon activation are immediately checked/applied. Rejected orders change no state, sequence, history or RNG. At the **active player's** ending, resolve atomically:

1. Close command intake and snapshot ownership, connections, sight, occupation and workforce. Fix due upkeep assignments; every ordering uses stable IDs.
2. Simultaneously calculate own-city yields from already completed, operated, connected, unoccupied facilities, including centres. Occupation discounts affect only nonfood/work. Book nonfood globally and food locally; reduce ruins by actual extraction.
3. Reserve `2 * population`; allocate current army upkeep from local remainder and other city surpluses. Add unpaid army amounts to debt; use remaining surplus against older debt in city-ID order. Population deficits may still receive deliveries in step 4.
4. Plan/execute standing transfers once from the common snapshot after reservations. Recipient capacity accounts for reserved own consumption; imports may cover population deficits. No forwarding or export recalculation after receipt.
5. Deduct reserved/import-covered population food; update hunger and population loss. Current army upkeep was paid or recorded in step 3, never charged twice; hunger cannot erase unpaid army food.
6. Check growth once using remaining food and existing housing; debt blocks growth. Then enforce capacity and report overflow loss.
7. Credit local construction, declared worker jobs and common research. Complete in city/job-ID order; blocked outputs remain waiting. New yield/housing/research bonuses apply only next own ending. Up-front reservations prevent races for shared materials.
8. Advance qualified occupation duration. The second qualified ending was still economically occupied; the next is normal. No retroactive production/recruitment.
9. Check defeat, then the active player's beacon streak/victory, then the 40-complete-round limit where applicable. Finalize result and lock gameplay commands.
10. Only without a result, switch players, renew incoming movement/action/counter budgets, update sight/events and permit export of a complete ending. Advance the round after the second player.

Use snapshot population for local food/growth; newly grown groups add no retroactive work. A completed building cannot fund itself. UI previews use this same domain calculation, never a simplified second simulation.

## Target units and tactical combat

### Common roles and costs

| Role | Purpose | Hard boundary |
| --- | --- | --- |
| Bulwark | Hold space, intercept Assault, control approaches | Counters Assault; countered by Breaker |
| Assault | Exploit gaps, attack Breakers, enter cities | Counters Breaker; loses to Bulwark |
| Breaker | Defeat Bulwarks and fortifications | Counters Bulwark; vulnerable to Assault |
| Scout | Explore routes/deposits | Civilian, not a combat class or city capturer |
| Founder | Establish cities | Consumed on founding |
| Worker | Improvements, roads, dismantling | Civilian, not a fourth combat class |

**Bulwark > Assault > Breaker > Bulwark** (the previous working terms were Bollwerk, Sturm, Brecher). Role and range are separate properties. Basic counters need no crystals or ruins. Initially two unit tiers suffice; upgrades require the previous tier, military unlock, paid resources and time in an own supplied city.

| Shared profile | Materials/work | Unlock |
| --- | --- | --- |
| Basic Bulwark | Wood/stone, medium work | Centre, no metal requirement |
| Basic Assault | Mainly wood, medium work | Centre, no crystal requirement |
| Basic Breaker | Wood/stone, medium/higher work | Centre, no ruin requirement |
| Tier 2 | Previous unit plus wood/stone/metal, high work; crystals only for optional abilities | Appropriate military building and research or explicit scenario unlock |
| Scout / worker | Wood, small work / wood/stone, medium work | Centre |
| Founder | Wood/stone/local food, roughly three basic troops' work, no population | Centre; legal founding site/spacing, never a city cap |

The twelve tribal combat chains use comparable profiles. Amazons emphasize wood; Engineers especially later stone/metal; Raccoons may substitute salvage for a bounded ordinary-material portion; Sorceresses pay crystals only for extras. No variant may remove basic counter access. Final integer tribal prices precede the corresponding economy/content implementation.

### Common tactical test rules

| Parameter | Test value / proposed rule |
| --- | --- |
| Health | 10 |
| Combat movement | 2; only narrowly scoped tribal exceptions |
| Attack | Once per own turn; ends remaining movement |
| Order | Move then attack legal; no free movement afterward |
| Terrain | Plains 1, hills 2; decorative trees grant no forest cover |
| Melee | Adjacent currently visible target |
| Ranged | At most 2 hex steps, current sight and clear line |
| Same/unrelated class | 4 base damage |
| Class advantage / disadvantage | 6 / 3 |
| Defense | Hill -1, entrenched -1, combined at most -2; minimum damage 1 |
| Flank | +1 to active melee with two own combat units on distinct target neighbours |
| Wounded | Initially unchanged attack strength |
| Randomness | No hit chance or critical hits |

The attacking melee unit counts as one flanker; the second must be alive and adjacent when attacking. Civilians/allied buildings do not count.

Damage order: class base, active-melee flank, defense, clamp to at least 1, then explicit bounded ability protection. **Protection proposal:** at most one additional point, never below 1; identical protections do not stack. Fortification damage uses separate siege values.

### Paths, occupancy and control zones

Own units may be traversed, but at most one unit ends on a tile. Traversal is legal only if a free next intermediate/end tile remains reachable within the same budget and no control zone ends movement on the occupied tile. Civilians occupy space; a city is no extra stacking slot. Enemy occupancy blocks routes. Equal-cost rediscoveries retain the first route; neighbour/queue ties are stable.

**Bulwark zone proposal:** its six neighbouring tiles are controlled. Entering ends remaining movement but preserves an available attack. Starting inside permits exactly one ordinary legal step, then ends movement even when leaving. No free escape chain or permanent immobilization. Own Bulwarks do not impede own units; overlapping zones grant no extra actions. Zones affect civilians/cities; ranged troops/cities generate none.

Teleport also ends movement, cannot target a controlled tile and is disabled when starting in a zone. The conquest advance below is an explicit exception, not a general bypass.

Hidden zones cannot leak through previews. **Contact proposal:** preview/pathfinding use only currently known occupancy/zones. An accepted march executes its fixed path stepwise, revealing sight after each step; a newly seen zone can stop it normally at the first controlled tile. Log a successful shorter march, not retroactive rejection or a second command. If the contact would stop on an own occupied traversal tile, stop before entering that passage; never create illegal stacking. Warn generically of possible early contact at unseen neighbours, without querying hidden truth. Orders already illegal under visible starting knowledge must reject without mutation.

### Entrenchment, counters and ranged fire

Entrench is a separate command, legal only before movement/attack, spending attack and ending movement. Protection starts immediately and lasts until the next own movement/teleport-like relocation. A later normal attack does not remove it. Merely passing grants no extra bonus. Tribal stationary defenses share this state.

A surviving melee-capable defender counters **once between own turn starts**, initial visible budget 1. No counter when dead, against ranged fire, by a pure ranged defender or against a fortification target.

Counter damage: defender's class base against attacker, subtract attacker's hill/entrench defense, clamp to at least 1, halve rounded up; apply existing attacker protection afterward, still minimum 1. No flank/active attack ability in counters, no counter-counter and no consumption of the later normal attack. Renew at own turn start, not per incoming attack.

A ranged unit adjacent to enemy combat cannot shoot any target, including another unit/city. It must legally disengage or be protected. **Proposal:** pure ranged units cannot substitute a full ordinary melee attack; preview explains the limitation.

**Line-of-fire proposal:** endpoints and every intersected intermediate hex must be visible, derived from canonical hex coordinates. A shot exactly along an edge requires both touched intermediate tiles clear. An intermediate hill blocks when canonical domain height is at least the higher endpoint height; lower hills do not. Explicitly blocking buildings also obstruct; decorative trees/figures and a nonexistent forest terrain do not. Test height/tie behavior in pure domain functions, never Babylon rays.

### Rest and paid abilities

Rest replaces the entire movement/attack turn and requires no previous action, connected own land and no adjacent enemy combat. Heal 2, or **3 total** near an operating appropriate healing/repair facility. **Proposal:** near means on or adjacent to it. Never 2+3, no multiple-facility stacking or health above 10.

Abilities have visible targets, resource prices, fixed movement/attack consumption and caps. Rejection spends nothing. No healing in enemy-threatened adjacent space, attack-heal-attack or free recharge via city switching. Catalog costs are profiles, not approved numerical balance.

### Water crossing

**Proposal (E17), test values:** crossing water is a common production rule available from the start, never research ([E16](#target-common-research)). Every tribe has the same baseline, so map validation and the basic counters never depend on a tribe.

**Implemented foundation, not boating:** G1/#53 supplies generator-v5 canonical depth data, matching terraces/cap colours and charted-water inspection. The following movement, vessel, production and scenario rules remain planned. P3a consumes G1's field and validates suitable island scenarios; any later change to generated depths requires another generator boundary.

- **Water classes:** the four broad underwater terraces define the planned navigation split, per water hex: **shallow** and **shoal** are shallow water, passable to ordinary boats; **shelf** and **deep** are deep water, impassable to ordinary boats. The deterministic, irregular bathymetry follows warped coasts and can extend outward as connected submerged sandbanks; there is no fixed distance-from-land cutoff. These offshore shoals are water features, distinct from the lowered sandy pockets inside land hexes. Each water hex has one stable depth class even when fine voxel detail or a small rock outcrop varies within it. Sandbank hexes remain water: future boats can cross them, but units cannot walk, land or disembark on them. Rendering, future movement previews and domain legality must agree on each class. Island-route suitability and the ordinary/deep-water balance still need P3a validation.
- **Landing:** common city project, legal only in a coastal city, one with a territory land tile adjacent to navigable shallow water; test price 10 materials in the M2 generic economy (between Guard 8 and Storehouse 12), with wood/stone prices set alongside the six resources. One per city; it transfers with a captured city.
- **Embark:** a land unit, combat or civilian, with at least 1 movement left on a land tile in the territory of an own city with a Landing moves onto an adjacent free shallow-water tile and becomes embarked. Embarking ends its movement and attack for that turn.
- **At sea:** an ordinary boat has 3 movement and pays 1 per shallow-water hex; deep water is impassable to it. A Harbour-equipped or otherwise deep-water-capable boat also enters deep water, paying 2 movement per hex there and 1 in shallow water. One unit per tile; own boats may be traversed and enemy boats block. Sight stays 2. Boats cannot attack, entrench, rest, found, work, capture or activate a beacon, and they generate no control zones. Bulwark control zones also cover adjacent water tiles, so a coastal Bulwark can stop a passing boat.
- **Vulnerable boats:** land units may attack an adjacent boat in melee or one within range and line of fire with ranged units. Every such attack deals a neutral 4 without class, terrain or entrench modifiers, and boats never counter. There is no boat-versus-boat combat.
- **Disembark and return:** with at least 1 movement left, the boat moves onto an adjacent free land tile that is not an enemy city centre; enemy territory and a free beacon tile are legal. Disembarking ends movement and attack, so a landing never attacks, captures or activates in the same turn: the defender always gets one response turn. The unit retains its watercraft when ashore and may re-embark from any land tile beside free water its vessel can enter; an ordinary boat needs shallow water, while a deep-water-capable vessel can also use deep water. No city or Landing is required on the destination island.
- Founders may settle other islands, army food still applies at sea and a founder at sea still prevents defeat. Boats follow ordinary fog rules; previews and rejections use only known occupancy.
- **Harbour (later, with the full economy):** paid Landing upgrade without research; units first embarking there receive a deep-water-capable vessel, which may enter shelf and deep water at 2 movement per hex. Re-embarking preserves the unit's vessel capability. Naval combat and warships remain later depth.

Embarked state records the vessel kind so tribal and Harbour variants share one rule path.

**Tribal water styles (Proposal, E18):** each tribe crosses water in its own way through one passive trait, delivered with the first tribal increment beside its single characteristic ability. Map validation never relies on them; pairing playtests measure their effect on island maps.

| Tribe | Style | Effect | Bound |
| --- | --- | --- | --- |
| Amazons | Bark canoes | Shallow-water movement 4 instead of 3 | Shallow water only; embark/disembark rules unchanged |
| Raccoons | Drift rafts | Build/embark from any land tile beside shallow water, including foreign islands, without a Landing, for 1 wood | A raft moves 2, not 3, and cannot enter deep water |
| Engineers | Bridges | A Construction Team bridges one shallow-water hex with land on two opposite sides | Expensive stone/metal and several workdays; every land unit may cross, including enemies; boats cannot pass it; dismantling or siege damage (test: 4 points) removes it; no bridge chains |
| Sorceresses | Star navigation | Their boats may enter deep water without a Harbour | Deep water still costs 2 per hex; no other sea advantage |

Each style matches its tribe's identity: Amazon terrain mobility, Raccoon improvisation, Engineer construction and the Sorceresses' preserved star charts. None removes the response turn after a landing or makes boats able to attack.

## Target siege, capture and occupation

### Walls are not a fourth class

Proposed city fortification is 8, upgraded to 12/16. At most one ordinary combat unit garrisons the centre. There is no independent free city ranged attack.

While fortification is positive, an attack on the city hits **only fortification**: Bulwark/Assault 1, Breaker 3. No class/flank/hill/entrench modifiers, overflow to garrison or garrison counter behind intact walls. Range, sight and ranged engagement limits still apply. At zero, fight the garrison by normal class rules; architecture adds no extra generic city-defense modifier.

### Capture and explicit civilian attacks

Only a **melee-capable Bulwark or Assault** captures by entering an unfortified centre free of enemy units. An enemy civilian is not a combat garrison but occupies space and must first be explicitly attacked. Breakers/pure ranged units can damage walls and enemies but cannot capture; own civilians cannot capture either.

**Advance exception:** when an adjacent eligible melee attacker kills the final enemy unit in a zero-fortification centre, it may immediately advance despite attack normally ending movement. This includes an explicitly attacked civilian. Likewise if it destroys the last wall point and the centre is **free of every enemy unit**. Exactly one tile, no extra attack. Enemy control does not prevent this completion step but ends movement there. Ranged destruction never advances from afar. Removal, advance and ownership transfer are atomic; evaluate defeat afterward.

**Confirmed civilian direction:** an adjacent enemy combat unit may explicitly attack and deterministically remove a currently visible civilian, spending normal attack and ending movement, without counter. No automatic movement kill, loot, conversion, escape or prisoners. Presentation stays abstract and non-graphic. A pure ranged unit may also perform this special adjacent attack; that grants neither normal melee against troops nor range-2 civilian attacks.

Walls protect civilians on city tiles too: reduce fortifications to zero first, without overflow/automatic death, then explicitly attack the civilian. An eligible melee killer may atomically advance; a Breaker only clears the tile for a later eligible unit. Outside this city exception no free entry follows an attack. Preview clearly shows cost, fatal removal and any takeover, never a hidden escape destination.

### Captured assets and blocked functions

Capture transfers city, territory, improvements, buildings, population and **local** food, retaining recognizable architecture. It grants no access to the former owner's global resources.

Freeze ongoing production with its paid receipt; no automatic refund. **Proposal:** the new owner may abandon it but receives no refund for foreign-paid reserves. Generic compatible projects may resume after occupation; foreign tribal recruitment/ability projects remain blocked. Liberation by the original job owner permits resumption; repeated conquest cannot multiply materials.

Map generic functions explicitly: housing, storage, administration tier and shared rest improvement retain their function, with normal staffing. Exclusive tribal recruitment, research and active abilities are not collected. A foreign special building supplies only registered common equivalents; otherwise label it inactive. Architecture is not access to all four tribes' bonuses. Research ownership is specified under [research](#target-common-research).

### Two qualified occupation endings

A captured city requires two own endings with at least one own combat unit anywhere in its territory. **Proposal:** without presence, progress pauses rather than resets. Through the second qualified ending, halve nonfood yields/work, rounding down once after each city's per-kind sum. Food stays normal; combat recruitment/military upgrades are blocked.

Ownership changes reset occupation to zero. **Liberation proposal:** recapture by the original founding owner ends occupation immediately; retain permanent origin ID, never inherit an enemy's partial occupation. Other transfers require two endings again. No random revolt or automatic population penalty; real food shortage can still cause hunger.

Walls do not regenerate automatically. Paid repair restores displayed points; adjacent enemy combat blocks start/progress. Repaired walls protect remaining garrison but grant no free attack. Road/tile occupation has concrete effects; mere siege proximity does not block all city food.

## Target four-tribe catalogs

### Common catalog rules

The four target tribes replace Meridian/Lantern only in new versioned content. Stonewatch and Tidebound were discarded alternatives, not fifth/sixth tribes.

Each full expansion catalog has **three two-tier combat chains, three civilian roles and four three-tier special building chains**. The first tribal increment delivers **one characteristic ability each** alongside common classes/civilians. Remaining abilities/building tiers are expansion goals, not first-increment requirements. Selection of the initial ability and concrete prices remains P12 work. Each tribe's passive [water style](#water-crossing) (E18) is a proposal beside that ability; because it widens E9's first increment, it needs both maintainers' approval.

All three basic classes recruit from the centre; military buildings support tier 2 rather than gating basic counters behind rare resources.

**Catalog test rules:** building tier 1 requires founding/free special slot; tier 2 its predecessor/common research; tier 3 its predecessor/advanced research. Administration reach additionally needs population 4/7, not every workshop. Administration never requires its own unavailable higher tier; storage/housing remain accessible before population 4. Upgrades retain slots. Passive housing/administration/storage unlocks need no staff; productive/active chains provisionally need one workforce slot regardless of tier. Only explicitly passive capacities work without operation.

### Amazons — Covenant of Dawn

An all-adult-women community descended from defenders of early refuges. Membership is admission and oath, not biological superiority. Training, local knowledge and mutual responsibility shape society. Internal conflict: does isolation protect them, or must cities reconnect?

Open courtyards, terraces, light dwellings and distinctive gates define cities. Optional cultural dress for adult figures may include stylized, nonsexual bare torsos; this is neither the primary identity, depiction of minors nor an image-generation request.

Strengths: food, wood, terrain and defensive mobility. Heavy industry requires equally costly, slow preparation; no free universally superior economy.

| Class | Basic → upgrade | Profile / bounded ability |
| --- | --- | --- |
| Bulwark | Spear Warden → Shield Sister | Melee, stationary defense; upgrade shares entrench state, no second additive free cover |
| Assault | Huntress → Windrunner | Melee despite hunting name; once per own turn pay 1 rather than 2 movement for a hill entry; zones still bind |
| Breaker | Heavy Archer → Sun Archer | Pure ranged, range 2/normal line of fire; heavy bows, not stacked range |

**Ability proposal:** while entrenching, Shield Sister pays 1 wood to reduce exactly the next hit by another 1, minimum damage 1. One guard per unit, ending on movement/consumption. Windrunner's terrain impulse also has a small wood cost to test jointly. Sun Archer improves preparation/unlocks, not range, health and base damage together.

Civilians: **Pathfinder, Founder, Field Worker**, with shared roles/cost classes.

| Building chain | Tier 1 / 2 / 3 effects | Cost / tradeoff |
| --- | --- | --- |
| Community Garden → Irrigation Court → Seed House | Staffed city-food bonus; larger bounded bonus; later lower displayed storage loss, never infinite food | Wood, later stone; small/medium/large, one worker |
| Training Ground → Spear Court → War School | Support common recruitment; tier-2 Bulwark/Assault; tier-2 Breaker/bounded training projects | Wood/stone, later metal; never exclude a basic class |
| Path House → Runner House → Path Network | Connect one / two / three outer own tiles along continuous own land within city reach | Wood/increasing work; special slot and operation instead of free superior roads |
| Assembly Court → Council House → Covenant Hall | Shared administration tier 1; fulfill radius-2 condition; radius-3 condition, later stability function | Wood/stone, later metal; passive administration, no unstated unrest mechanic |

**Naming:** use Path House consistently, not alternating Way Station. Its connection is not teleportation, cannot cross enemy tiles/water, fails when its own path breaks and does not automatically replace intercity transport or grant military movement discounts.

### Raccoons — Covenant of Finds

Upright mutated raccoons with ringed tails and dexterous paws made abandoned installations habitable. Their conflict with human descendants of earlier owners pits actual reconstruction against inherited ownership. Internally, are finds communal property or individual inventors' rights?

Interlocked houses, walkways, sorting yards and deliberately reused structures form comprehensible cities, not mere rubbish heaps. Adaptation/recovery are strengths; peak mass production remains below prepared Engineer industry.

| Class | Basic → upgrade | Profile / bounded ability |
| --- | --- | --- |
| Bulwark | Lid Guard → Armored Guard | Melee; whole-turn repair under shared rest conditions, small material price, at most 3 healing total |
| Assault | Alley Runner → Hook Jumper | Melee; bounded route flexibility through an own occupied intermediate tile, never skip enemy occupancy, water or zones |
| Breaker | Scrap Slinger → Spring Slinger | Pure ranged, range 2; reliable basic counter without ruin finds |

Hook Jumper is not a free map jump. **Tier-2 proposal:** paid two-step move through legal visible land neighbours, at least 2 movement, normal zone checks at each step. If it adds no useful distinction, replace in playtesting rather than invent a hidden exception.

Civilians: **Trail Seeker, Nest Founder, Tinkerer**. Later **Salvage Crew** is a worker upgrade with greater work output, not a fourth class or prerequisite for normal ruin access.

| Building chain | Tier 1 / 2 / 3 effects | Cost / tradeoff |
| --- | --- | --- |
| Collection Point → Sorting Yard → Recycling Works | Controlled dismantling recovery; higher bounded ratio; more efficient but still lossy reuse | Wood/stone, later metal; slot/staff for active projects |
| Workbench → Workshop → Inventors' Hall | Support basic production; tier-2 Bulwark/Assault; tier-2 Breaker and worker upgrade | Wood/metal, medium/high work |
| Supply Nest → Cool Cellar → Shared Store | Food capacity 36 / 48 / 60 rather than base 24 | Wood/stone, later metal; passive capacity, delivery still needs connection |
| Exchange Point → Market → Trading Court | One conversion order; higher order limit; broader ordinary-material exchanges | Wood/stone/metal, staffed work; no net-gain loop |

**Naming:** Supply Nest is the first storage tier, not another separate Storehouse. Other tribes receive common functional storage projects without copying its architecture.

**Conversion proposal:** 3 salvage → at most 2 wood **or** 1 metal, with work/own ending. Ordinary market exchange uses an openly lossy table. Dismantling, free capture, exchange and rebuilding must never combine into more starting materials. All tribes can use salvage; Raccoons optimize recycling, not exclusive access.

### Engineers — Workers' Union

Humans of all genders descended from maintenance teams, building crewed machines rather than an autonomous robot army. Their conflict asks whether dangerous knowledge should be shared freely or restricted by accountable custodians.

Art Deco stepped halls, modular housing, conduits and machine yards emphasize precision/standardized parts, unlike improvised Raccoon reuse. Prepared production is strong at the price of materials, build time and optional operation costs.

| Class | Basic → upgrade | Profile / bounded ability |
| --- | --- | --- |
| Bulwark | Steel Bearer → Shield Walker | Crewed melee; shared entrench stance, not permanently superior health |
| Assault | Shock Runner → Piston Runner | Melee; prepared paid impulse on legal land, no extra attack/zone bypass |
| Breaker | Bolt Thrower → Drill Carriage | Pure ranged; preparation for an effective special shot, range remains 2 |

**Setup proposal:** basic Bolt Thrower works as common Breaker with no added waiting requirement. Drill Carriage's paid siege special requires no movement since own turn start; its ordinary class-countering attack remains available. A full previous-turn setup is a later alternative, not a silently additional obligation.

**Impulse proposal:** small wood price, once per own turn one extra movement point, no remainder above the defined maximum; ordinary zones/attack-end rules. Never bundle greater damage, range and health.

Civilians: **Surveyor, Construction Team, Mechanic**.

| Building chain | Tier 1 / 2 / 3 effects | Cost / tradeoff |
| --- | --- | --- |
| Work Yard → Machine Hall → Precision Works | More work; larger bonus against explicit wood consumption; better specialized production projects | Stone/metal, large investment; one worker, operation switchable without free output |
| Assembly Yard → Factory Hall → Heavy Works | Support basics; tier-2 Bulwark/Assault; tier-2 Breaker | Wood/stone/metal; preparation, not universally superior stats |
| Depot → Pump Works → Supply Centre | Shared storage/supply; bounded delivery-capacity increase; more reliable own network | Stone/metal; no food from missing connections |
| Repair Yard → Maintenance Hall → Central Depot | Rest healing 3 total; more legal repair workplaces; paid maintenance projects | Stone/metal and staff; healing stays capped |

If machine fuel operation is introduced, use existing wood, not an automatic seventh resource. Missing fuel stops only the explicitly paid extra operation, not silently the entire ordinary city.

### Sorceresses — Circle of Afterglow

An all-women society preserving refuge rituals, songs and star charts. Resonance is learned preparation, not unlimited miracles. Their conflict: reactivate the network or contain its old danger?

Round courtyards, stepped observatories, geometric shrines and visibly carried bows shape settlements. Effects stay sparse, readable and deterministic.

| Class | Basic → upgrade | Profile / bounded ability |
| --- | --- | --- |
| Bulwark | Threshold Warden → Seal Warden | Melee; pays for bounded protection on an adjacent own unit |
| Assault | Spark Runner → Veil Dancer | Melee; short paid step to visible free land, no fog jump |
| Breaker | Resonance Caller → Star Caller | Pure ranged, range 2/ordinary line of fire; no guaranteed-hit special arithmetic |

**Shield proposal:** 1 crystal, spends attack/movement, at most one shield per target, reduces next hit by 1 with minimum damage 1, expires no later than next own turn start. Renewal/multiple sources do not stack; counter/wall rules remain explicit.

**Veil Step proposal:** 1 crystal, at most hex distance 2, destination visible/free/land, not an enemy city or controlled tile. Cannot start in a zone; ends movement but preserves an available ordinary attack. Never overwrite enemies or activate a beacon after already spending attack. Test limits/costs against normal routes.

Civilians: **Veil Seer, Circle Founder, Sign Weaver**.

| Building chain | Tier 1 / 2 / 3 effects | Cost / tradeoff |
| --- | --- | --- |
| Herb Garden → Moon Garden → Life Court | Bounded food bonus; greater bonus; shared rest function still capped at 3 | Wood/stone, crystals only for extra projects; one worker |
| Teaching Circle → Sign Hall → Star Convent | Support basics; tier-2 Bulwark/Assault; tier-2 Breaker | Wood/stone/metal, crystals only for active extras |
| Observation Point → Observatory → Sky Archive | Paid small sight window; bounded larger range; longer but temporary reconnaissance | Stone/metal/crystals; never permanently open enemy map |
| Shrine → Resonance Court → Beacon Circle | At most one / two / three stored resonance charges | Crystal-paid charging, one worker; no self-generating infinite account |

**Reconnaissance proposal:** originate from a currently visible target, use a small specified radius, expire next own turn start; price and named maximum range increase by tier. Never query arbitrary unknown coordinates for hidden enemies. A window shows units only during its actual lifetime.

No mind control, whole lost enemy turns, infinite summons, unlimited healing/protection stacking. Every basic counter works without crystals; normal materials still matter.

## Target common research

**Chosen design:** all four tribes share four two-step branches, with tribal applications rather than four separate trees. Research is not an entry requirement for the first isolated combat/victory increment; it governs unlocks in the full economy/content mode.

| Branch | First technology, no research prerequisite | Second technology, requires only first in branch |
| --- | --- | --- |
| Supply | **Stockpiling:** larger storage and standing food deliveries | **Cultivation Methods:** improved fields and housing |
| Construction | **Roadbuilding:** roads and distant extraction facilities | **City Planning:** administration and wider territory |
| Craft | **Metalworking:** advanced workshops | **Equipment:** tier 2 of all three combat classes |
| Resonance | **Resonance Measurement:** access/use crystals | **Resonance Engineering:** advanced tribal abilities |

Basic food, wood, stone, simple metal, all three basic classes and beacon activation are available **from the start**. No basic class or essential healing/supply is gated behind research, crystals or ruins. Local first-ring yields need no Roadbuilding; outlying facilities and intercity deliveries need their stated unlocks.

**Confirmed: no movement research.** Every land unit may enter hills from the start at movement cost 2; land units never walk on water. No technology unlocks or cheapens hill or water movement. A request to gate hill/water movement behind research (#11) was rejected on 12 November 2026. Water is crossed through the common Landing (E17) and later Harbour, both without research; tribal water styles (E18) come from tribes, not this tree.

One active project per **player faction**, not tribe/city. A small fixed faction baseline exists once even with many cities: no free research per new city. Staffed knowledge buildings add output at population/slot cost. Switching preserves progress **on each technology**, neither deleting nor transferring points. No selected project means no unallocated banked research.

Conquest transfers neither technologies, partial progress nor active projects. After common occupation/staffing rules, a captured knowledge building may generate future own research, never steal past knowledge. Mirrors retain separate research. An ending invests only in its selected project, with no overwrite of prior points or automatic overflow into another.

**Test values:** 1 point per faction/own ending plus 1 per staffed knowledge workplace. Military occupation treats that contribution as nonfood and halves it accordingly; “staffed” never means enemy occupation. First technologies cost 5, second 8. Without buildings, first completion takes 5 own turns, within the **4–6** test target, not measured balance. A match need not unlock every branch.

The common Knowledge House is available from the start at small building cost, one special slot/worker. Housing 6 via Cultivation Methods has no population-4 prerequisite; City Planning enables administration whose radius-2 use later needs population 4. Housing 9 is available before population 7. Assign later three-tier catalogs to these eight technologies without inserting unapproved mandatory technologies.

## Target society, diplomacy and AI

Food, industrial, frontier and trade cities emerge from location, tiles, staff and slots, not separate minigames. Frontier cities may grow; industry still pays food. Later stability/politics/unrest may add choices; initial administration implies no specific unrest statistic. Occupation is deterministic, not random rebellion.

**Confirmed PvP:** war from the start. Beacon contest, interruption and conquest need no prior diplomacy package. This explicitly replaces the old peace-first/nonaggression/declaration proposal.

Later diplomacy may add peace, war and bounded pacts. First decide how peaceful rivals can retake beacons; do not block the core with contradictory war gates.

AI is later, never a two-human prerequisite. It must use the same commands, prices and sight, stable evaluations and bounded search, without hidden-unit knowledge or randomness/time budgets changing replay. Native wrappers or new networking are outside this plan.

## Target victory, defeat and draw

### Three public beacons

A living combat unit occupies a free beacon and activates with its available attack, ending movement/attack. **Any combat class, including a ranged Breaker**, may activate; city-capture restrictions do not apply. Civilians cannot.

Adjacent enemy ranged engagement prevents shooting, not this interaction. Remove an enemy occupant through normal combat first. A ranged attack never activates remotely. Ownership persists after leaving until legal enemy reactivation.

At own ending, owning at least two increments own streak; the third qualified ending wins. Fewer than two means zero. **Any intervening event reducing ownership below two resets immediately**, including in the opponent's turn. A different pair is legal if ownership never fell below two. Activation, ownership and reset are atomic.

### Defeat and round boundary

A player loses with neither cities nor living founders. One founder keeps them alive; scouts, army or beacons alone do not.

**Boundary proposal:** check defeat after each state-changing command that can alter cities/founders and again at ending. Never evaluate midway through an atomic capture. An eliminated player cannot issue a later winning action. Simultaneous elimination in a fixture draws rather than selecting by ID.

A complete round contains one turn of each player. Round 1 ends after player two, not after two calendar days. At the second turn ending of round **40**, draw unless defeat/beacon victory already decided.

Priority: **defeat before beacon victory before round cap**. Check active-player beacon victory at own ending; player two can still win at round 40's final ending. After result, gameplay commands lock; export/reimport of that completed result remain possible.

First-player advantage is not solved. Replay each map/tribe pairing with starts and first player swapped; separately measure activation time, protection through the third ending and last response opportunity.

## Target interaction and visual continuity

Before attack show class, range, line of fire, raw damage, flank, defense, protection, counter budget, final health and possible capture step. Before ending show local food, army share/debt, deliveries, hunger, growth, work and beacon progress.

City inspection separates ownership, operation, connection, occupation and housing. Upgrade, cancellation, dismantling and explicit civilian attack preview consequences before confirmation. Rejections explain visible-information-safe reasons without mutation.

Role, silhouette and symbol distinguish units, not only colour/gender. Keyboard and small-touch usability are full-match gates; effects must not obscure sight/selection.

The existing two visual references remain unchanged: `showcase.png` governs broad separated landforms, coast, stepped highlands, composition and scale; `concept-hex-voxel.jpg` governs board presentation/palette. Tribal architecture derives from them rather than reinventing the board. The visual contracts below remain binding. Catalog buildings/clothing are future direction, not implemented assets. This documentation correction changes no visuals; old/reference pictures are not evidence of target gameplay. Actual visual implementations require fresh running-app captures in a separate **Visual overview**.

## Target worked examples

### A complete own turn

The player previews ending and starts a city project, immediately reserving materials. An Assault moves over one visible plain and attacks an adjacent Breaker, ending movement with no second attack. Another combat unit on a neutral beacon uses its own attack to activate. Separate units acting is not a double turn for one figure.

At ending, only existing operated facilities yield. Feed population/army, process routes once, resolve hunger/growth, then work. Housing completed now helps only next ending. Continuously holding two beacons increments the streak. Without result, send the complete turn; timely enemy recapture can reset it immediately.

### City economy without hidden free work

Test city: population 3, housing 6, food 14; two food workplaces at 4 each, one quarry at 2 stone. Centre supplies 3 food/2 work. An unstaffed food building gives nothing.

Yield is 11 food/2 stone: stock 25, population consumes 6, two combat troops consume 2, leaving 17. Threshold `8 + 4*3 = 20`: no growth. Work 2 advances the paid project; an unworked claimed tile changes nothing.

Next identical ending: `17 + 11 - 6 - 2 = 20`; grow once, subtract 20. Stock 0, population 4. The fourth workplace and its food requirement start only next own turn.

### Delivery without chain multiplication

A has 8 surplus after own needs/debt and A→B maximum 4. B has no surplus but B→C maximum 4. A sends 4; B sends **0** because its export basis predates receipt. Road occupation suspends A→B without deleting it. Hunger in B depends on actual final food, not route status alone.

### Hunger

Population 3 obtains only 5 of required 6 food including stores/yield/import. First ending: hunger 1, no loss. Second equally underfed ending: hunger 2, population 2. Another underfed ending loses at most one, down to 1. Complete feeding between would reset the sequence. Unpaid army food is separate and cannot cause a second population loss.

### Combat and counter

Assault attacks Breaker: class advantage 6, second own adjacent troop grants flank +1, target hill/entrench gives -2: damage 5, full-health target retains 5. A pure ranged Breaker cannot counter.

Against a plains Bulwark without flank, the Assault deals 3. Surviving Bulwark with counter budget has advantage 6, halved/rounded up without attacker cover to 3 counterdamage. A second attacker receives no new counter before Bulwark's next own start.

### Siege

Three Breaker attacks take wall 8→5→2→0, without overflow. They require separate units/attack opportunities, not three actions by one unit. An eligible melee unit must then defeat the garrison normally; only the last lethal melee attack may capture. If ungarrisoned, Assault may later enter with legal movement; alternatively an adjacent Assault destroys the final 1 wall point and immediately advances. A ranged Breaker never captures alone.

### Beacon reset between own turns

A owns two beacons and has streak 2. B activates one: A drops to one, immediately resets to 0. Recapturing next turn yields streak 1, not 3. If A had owned all three and dropped to two, its streak would remain.

### Landing on a beacon island

The central beacon lies on a small island across a strait of 4 shallow-water hexes from A's home island. A's coastal city completes a Landing. Turn 1: an Assault walks onto a land tile in that city's territory beside shallow water and embarks onto the first water hex, ending its turn. Turn 2: it sails the remaining 3 hexes; had it entered a hex beside B's coastal Bulwark, its movement would have stopped there and any land attack would deal 4 without a counter. Turn 3: it disembarks beside the free beacon, ending its turn. B sees the landing and may respond. Turn 4: if it survives and the beacon is still free, the Assault moves onto it and activates with its attack. The Assault keeps its boat and can later re-embark from any land tile beside shallow water, without a city on the island.

## Target decision register

Confirmed product decisions, provisional rules and actual open choices are separate. Tests may justify documented revisions; they do not make settled direction undecided again.

| ID | Status / decision | Rule and reason | Verification / remaining scope |
| --- | --- | --- | --- |
| E1 | **Confirmed:** start at war | Diplomacy later; no peace-first gate | No new fundamental approval needed |
| E2 | **Test rules:** combat/walls/healing | Health 10, movement 2, damage 4/6/3, walls 8/12/16, rest 2/3 | Preview/domain/playtests, not a balance claim |
| E3 | **Confirmed:** unlimited cities; **test:** spacing 4 | Sites, supply and costly founders constrain growth | Test more than two cities, spacing 3/4 and overlapping catchments |
| E4 | **Chosen test design:** start/economy | Founder/scout/no army; founder 36 work = three basic soldiers plus wood/stone/local food | Shared dataset; complete later special prices |
| E5 | **Test rules:** population/buildings | One workplace/group, four special slots, storage 24/36/48/60 | Economy, overflow, acyclic housing/admin progression |
| E6 | **Provisionally confirmed:** army debt | City loss/reassignment cannot erase it; no tactical hunger penalty | Cityless armies/recruitment lock |
| E7 | **Test rules:** counters/zones/advance | Explicit tactical ordering | Test edge cases, not an unresolved product principle |
| E8 | **Chosen direction:** civilians can die | Explicit adjacent attack only; no escape/prisoner/loot systems | Clear before capture; atomic transfer/defeat |
| E9 | **Confirmed scope:** one initial ability/tribe | Full catalog remains expansion | **Open P12:** select first representative ability; price/effect later additions |
| E10 | **Chosen:** common eight technologies | Four two-step branches; one project/fixed baseline/retained progress/no theft | Test 1/5/8 and 4–6-turn target; no housing/reach cycle |
| E11 | **Confirmed:** mirrors allowed | Independent free choice from start | Six mixed/four mirror pairings; separate player identities |
| E12 | Target identities; provisional names/assets | No gender-dependent stats; cultural dress as above | **Open:** final names and actual art |
| E13 | **Test rules:** visibility-safe actions | No hidden state via previews/reasons | Contact stop, line of fire, bounded reconnaissance |
| E14 | **Unmeasured:** scenario/first player | Weighted routes, victory 2 of 3 through 3 endings; test round cap 40 | Set release maps and measurable balance acceptance before M5 |
| E15 | **Chosen direction:** separate start and beacon islands allowed | Klaus replaced the shared-landmass proposal on 12 November 2026 because it could get too cramped; starts share a landmass or use home islands, beacons lie on start landmasses or beacon islands | P2 validates shared-landmass maps; P3a adds island placement with baseline reachability, room, contestable beacons and travel turns within 1 (test values) |
| E16 | **Confirmed:** no movement research | Hills cost 2 movement from the start; land units never walk on water; #11 request rejected | No movement or crossing technology in F1; water is crossed through the common Landing (E17) |
| E17 | **Proposal:** common depth-based water crossing | Four stable depth tiers: shallow/shoal open to ordinary boats, shelf/deep require deep-water capability; irregular generated bathymetry and sandbanks, no distance cutoff; Landing for first embark, retained boat for return, Harbour enables deep water without research | P3a; test tier boundaries and map distribution, Landing price, response time, shallow-route reachability and deep-water incentives |
| E18 | **Proposal:** tribal water styles | Amazon canoes, Raccoon drift rafts, Engineer bridges and Sorceress star navigation as passive traits beside E9's single ability | Needs both maintainers' approval; delivered in P12, measured in P13; never a map-validation dependency |

Each implemented package updates this register, implemented rule sections and agent guidance together. A test value is binding for replay **in its test-rules version**, not a permanent balance claim. Changes need traceable rules/content version boundaries.

## Visual and interaction direction

**Original voxel Art Deco:** block-built landforms, stepped civic shapes, restrained brass detailing, geometric typography, and clean panels in the HUD.

The world itself uses the bright diorama palette of the [hex voxel concept](concept-hex-voxel.jpg) (`VOXEL` in `src/rendering/voxels.ts`): yellow-green grass, cyan shallows, saturated deep-blue water, pale sandy coasts, warm earth, grey stone, forest/olive foliage and terracotta roofs. Match colours in the rendered image, including shadows and transparent-water blending, not just in the palette constants. Representative grass/deep-water median targets and tolerances are recorded in [ADR-004](architecture.md#adr-004-map-and-rendering); a procedurally different scene cannot be pixel-identical to the illustration. The Art Deco palette below is for the HUD and UI; gold also marks focus and city plates.

| HUD and UI role | Palette |
| --- | --- |
| Navy background/panels | `#102538` |
| Teal accents | `#287F82` |
| Gold focus/civic details | `#D6AF58` |
| Ivory text/highlights | `#F2E9D4` |

Forest uses clustered stepped crowns; hills use **low connected terraces, not separate grassy pillars or cones on each hex**. The four detailed land levels span only 0.625–1 world units, with localized grey stone outcrops instead of repeated mountain columns. Coarse voxels merge elevations rather than making them taller. A separate mountain terrain remains deferred. Trees are about one third shorter than the earlier pass, at most 0.75 world units high with narrower crowns, so the hexes stay readable. Water has a level translucent surface over **four canonical submerged terraces and sparse coastal rock groups**, with visible cubic top and side faces. Some irregular rock groups remain wholly submerged; others break through the cap near shallow shores. They are compact outcrops, not tall thin pillars, and exposed grey rock replaces the water surface in its footprint. A flat plane decorated with squares is not the intended voxel water, nor are ten or more narrow stair rings. The generator's irregular depth regions and offshore sandbanks determine the seabed: sandy shallows fade through patchy stone into a muted deep-blue floor. A charted water hex keeps that depth even when nearby land is hidden or newly revealed. Only charted coasts shape decorative rocks and shoreline highlights; unknown water has no visible floor or depth label. Keep the four main depths independent of fine voxel density: material colour patches are not additional height steps. Coarser grids merge unrepresentable levels; the coarsest scale omits relief and rocks but preserves depth cap colours and inspection names. Opaque blue walls close the diorama sides. Thin water hexes sit on the level cap without hiding the underwater relief. There are no dynamic waves, refraction or water physics; exposed rocks are picked at their real height but remain water tiles with unchanged rules. Terrain identity must not rely on color alone.

**Sandbanks are areas and cliff interruptions, not painted outlines.** Broad, irregular pale-sand pockets lower parts of existing land hexes to just above the water, sometimes occupying the centre of a tile. Alternate wide beaches, small inlets and intact cliffs, with sandy side faces and a low inland shelf. Only charted water can shape a bank; unseen neighbours must not reveal their coastline. Keep whole tree roots off these lowered areas, allow sparse stones, and retain level settlement sites and dry land-resource sites. Figures and selection follow the actual terrain height. These are visual changes inside existing land, not newly walkable water tiles or changes to domain elevation and movement.

**Stone, apples and fish are visual occurrences, not a new economy.** Hills can carry broad irregular grey voxel deposits, grassland small round apple groves with red fruit, and water a fish-shoal symbol. Stone groups combine overlapping blocks with varied flat cap heights, chipped shoulders and occasional rubble, not identical narrow towers. Their centres stay clear for figures at scale 4 and finer. Original projected icons identify each kind; hover and selection name it and explicitly say harvesting is not available. Placement is deterministic and independent of simulation RNG. Unknown occurrences stay hidden, remembered ones are dimmed, and a city replaces the occurrence on its tile. Icons stay sparse and disappear in the overview; they are UI annotations, not image textures on the terrain. Harvesting, resource yields, worker extraction and further resource kinds need a separate rules decision.

**Public beacons are neutral voxel lighthouses (#56).** A charted beacon tile is levelled and cleared of trees, ground details and resource occurrences, like a city site but without a keep, and gets a small irregular paved plaza with a lane towards the front edge. On it stands one lighthouse of the finest 1/16-unit voxels: a dark stone plinth, an ivory octagonal shaft with two terracotta bands, a gallery with parapet posts, a warm golden lantern between four dark posts and a verdigris dome. At 19/16 world units it is a deliberate landmark, taller than trees, yet its footprint stays inside its hex. It stands 0.15 world units behind the hex centre, so a unit on the beacon steps forward and remains readable in front of the tower; the public ✦ number floats above the lantern. The tower carries no faction colour, because ownership and activation are later rules. The lantern glow is static: unlit voxels at full palette brightness, with no light source, bloom or animation. Uncharted beacons show only their public marker above uniform fog; remembered beacons are dimmed like remembered terrain. The lighthouse is presentation only and changes no placement, movement, picking target or beacon rule.
**Surface shading:** water is calm, but not a single flat colour. Its translucent cap has stepped blue/turquoise light and dark patches; grass, sand and rock tops have finer material shades. Five tone levels follow world-aligned voxel cells rather than screen pixels or hex-sized colour blocks. Water uses broader 2-by-2-voxel patches; ground uses one-voxel detail. Fine contrast recedes in the overview and stays softer along the shoreline. Sparse animated sun glints add a sense of motion without displacing water or hiding the underwater terraces. Keep them subtle and translucent, not bright white flashes: at most 35% sun-colour blending and about a third fewer flashes than the initial glint implementation. Their world-anchored flashes run at at most about 12.5 idle frames/second, stop under reduced motion and in distant overviews, and exclude remembered water. No imported image textures are used; uncharted fog stays uniform.

Ordinary hex frames on **both land and water** are crisp, approximately one-pixel hairlines, not wide blurry strokes. Visible cap lines supersede the earlier water-grid suppression; submerged floors never inherit a grid. Reachable outlines and territory bands remain land-only and slimmer too, with restrained glow rather than broad colour smears. Selection remains a high-contrast gold hex outline plus inspector text. Ownership uses a faction-coloured border band on the inner edge of each territory, distinct from selection; city name plates carry the population. Expedition fog uses subdued explored tiles and opaque uniform unseen tiles, hiding terrain silhouettes, trees, resources, picking and tooltips. Provide readable labels, keyboard-accessible controls, and a non-color selection indicator.

**Hex voxel world (implemented):** the approved concept [`concept-hex-voxel.jpg`](concept-hex-voxel.jpg) combines hex fields with cubic voxels: each hex is a stepped diorama column with cliffs and soil, a calm surface with a few small trees on its back row, so the centre stays free for a unit figure. It draws on the readable board layout of *Into the Breach*, the clear territories and city plates of *Polytopia* and the chunky voxel figures of *Voxel Tactics*, without copying their art. It departs from `showcase.png` in tile shape and palette with explicit user approval. Since then the two references split the authority: the concept governs the look of the board, and `showcase.png` remains authoritative for landforms, composition and scale. The binding graphics rules are in the [Copilot instructions](../.github/copilot-instructions.md#graphics-rules-for-the-hex-voxel-world).

Prototype controls: bounded pan, bounded zoom, click/tap to inspect, reset view, seed/dimension inputs with inline errors. Keep the camera's orthographic orientation fixed. Display tile coordinates, canonical ID, terrain, water depth where applicable, and any resource; don't imply future gameplay is already available.

**Reference-aligned camera and finer fields:** the fixed view uses yaw 45° and pitch 35.264° so the two horizontal cube axes have equal projected length and slope at 30°. This is a consistent isometric calibration of the illustrated reference, whose exact camera data is unavailable. The 32² showcase uses 16 voxels across each hex rather than 8, about four times as many surface cells; trees, buildings and coast widths retain their world-space proportions. In the overview, maps with a dimension above 32, 64 or 128 step down to 8, 4 or 2 voxels respectively. Zooming in restores detail up to 16 in a bounded window around the visible area, including trees, deposits, banks and underwater terraces. The visible window has one resolution at a time; discrete height rounding changes together with picking and figure placement, rather than producing mixed-resolution seams. The hard maximum is 256 × 256. This changes rendering detail, not the domain hexes, map generation, movement, saved games or rules.
