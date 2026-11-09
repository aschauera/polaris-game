# Polaris: game design

## Vision and scope

An original, browser-first, turn-based 4X game about rival societies rebuilding a fractured world. Explore readable voxel landscapes, grow cities, and choose between cooperation and conquest. Art Deco geometry gives the world civic grandeur without copying an existing game's art, names, factions, or rules.

**Implemented scope:** seeded terrain, an interactive camera, tile inspection, scout movement and faction fog, plus the first city founding/economy/production slice (roadmap briefs 6–7) and two-player matches played by exchanging turn messages. Combat, workers, research, diplomacy, AI and victory remain planned. The [visual mockup](visual-mockup.svg) is an original labeled concept, not a screenshot or implementation commitment.

## Map contract

- Pointy-top **hex tiles** in odd-r offset rows (odd rows shift half a tile east); world axes are **x east, z south, y up**.
- Movement adjacency is the six hex neighbours; every step has the same length, so there are no diagonals or corner cases.
- Dimensions are integers from **8 through 256**, inclusive, on each axis.
- Seeds are strings of **1–64 ASCII letters, digits, underscores, or hyphens**; preserve case and reject invalid input rather than silently rewriting it.
- Default showcase: **32 × 32**. Stress fixture: **256 × 256**.
- A seed, dimensions, generator version, and rules/content versions identify a reproducible map.
- Implemented generator version 3 hashes the ASCII seed with FNV-1a and uses Mulberry32. Movement traversal order is east, south-east, south-west, west, north-west, north-east.
- Target terrain vocabulary: plains, forest, hills, mountains, and water. The current renderer builds grassland, hills, water and decorative trees from cubic voxels inside each hex; forests and mountains as terrain types are art direction, not a claim of implemented assets. Prototype resource markers are decorative or inspectable data only, not an economy.

## Planned core loop

Observe → issue valid orders → commit the turn → resolve in a documented stable order → inspect outcomes. Exploration opens settlement choices; settlements fund units, infrastructure, and research; policy and diplomacy shape whether expansion remains sustainable.

The full loop is **explore → develop → negotiate or fight → progress → win**. Keep tactical orders simple (move, work, attack, end turn) and damage previews explicit, while putting strategic depth in scarce production, settlement location, research priorities, and policy tradeoffs. Add representative systems only when they produce a distinct decision; do not reproduce an exhaustive historical simulation.

| Future system | Initial playable rule | Later depth |
| --- | --- | --- |
| Terrain and resources | Terrain movement costs; food/material deposits; water and mountains impassable to initial land units | Biomes, strategic resources, extraction limits, environmental events |
| Movement | Six-direction hex paths; movement points; occupancy and enemy blocking; deterministic path ties | Embarkation, supply, zone of control |
| Tactical combat | On-map attacks between adjacent units; health, terrain defense, explicit deterministic damage; preview before command | Ranged attacks, promotions, combined arms, sieges; no separate battle scene initially |
| Cities | Found on valid land with minimum spacing; claim a small explicit territory; population consumes food | Growth specializations, districts, border disputes |
| Production | One queue per city; visible costs and progress for units and buildings | Queue management, projects, tradeoffs between local and shared industry |
| Workers and roads | Worker actions consume turns; improve owned deposits; roads reduce movement cost | Maintenance, networks, bridges, logistics |
| Research | Small prerequisite graph; science per turn; unlock one unit and one improvement | Branching technologies and specialization |
| Policies | Choose one policy from a small mutually exclusive set; clearly listed effects | Slots, reform costs, ideological combinations |
| Unrest | Expansion and policy choices alter city unrest; thresholds reduce yields; warning before penalty | Revolts, legitimacy, occupation, recovery decisions |
| Diplomacy | Peace/war state, explicit proposals, and bilateral agreements | Trade, treaties, reputations, coalitions |
| AI | Same legal commands as humans; stable heuristic priorities; bounded decisions | Strategic personalities, threat assessment, difficulty without hidden cheating |
| Fog | Unseen, explored, visible states per faction; explored tiles retain last-known information | Intelligence sharing, scouting tools, stale enemy reports |
| Victory | One documented territorial objective with defeat and draw handling | Research, diplomatic, and civic victories; configurable scoring |

Costs, ranges, yields, and thresholds belong in versioned definitions, not UI code. Each new rule needs an observable explanation and domain tests before added complexity.

### Implemented exploration slice (rules version 1)

The atlas is unchanged by default; **Start expedition** starts one Meridian scout on the largest connected landmass, nearest the map center (ties use canonical tile ID). The scout has 4 movement points and sight radius 2 (hex distance since rules version 3), with no terrain occlusion at this stage. Grassland costs 1 and hills 2 to enter; water is blocked. Trees are decorative and add no movement cost.

A* finds a destination route, bounded by remaining movement; Dijkstra produces the reachable range. Both use charted, unoccupied terrain only, the fixed hex neighbour order and FIFO ties at equal priority. Movement resolves immediately, reveals sight along the route, and leaves only current scout sight visible. End-turn activates the next faction in declared order and refreshes only its movement; the round increments on wrapping to the first faction. With one faction, each end-turn increments the round. Static terrain needs no end-turn fog recomputation.

Commands carry faction and monotonically increasing sequence IDs. Invalid orders leave state, history and RNG unchanged. No command currently consumes randomness. Accepted commands are retained in memory for deterministic tests; this is not a save/replay format. The UI offers one scout without opponent AI or faction bonuses. Multi-faction turn order, occupancy and separate fog are domain-tested foundations, not a claim of a complete match.

### Implemented city economy slice (rules version 2)

Each faction starts with one scout and one stationary founder on adjacent land. Founding consumes the founder. A founder may settle only explored land outside every existing city's claims and at least five hexes from another city; a city claims unowned land within hex radius 1 (its own hex and up to six neighbours). Each faction is capped at two cities. Since rules version 3 each city takes the next name from its faction's fixed list (Meridian: Sonnenfurt, Lichtau, …; Lantern: Nordhain, Silberbach, …) in founding order.

Claimed grassland yields 2 food and 1 material per turn; hills yield 1 food and 2 materials; water cannot be claimed. At each active faction's end turn, its cities resolve in founding order: add yields, consume 2 food per population, grow by at most one population if the remaining food reaches `8 + 4 × current population`, then apply materials to the single production queue. If available food cannot cover consumption, the stockpile becomes zero and population does not grow or decline. These initial values are explicit rules-versioned definitions, not balance claims.

The queue choices are **Guard (8 materials)**, **Worker (10)**, and **Storehouse (12)**. A completed Guard or Worker appears on the first free adjacent land hex in the fixed hex neighbour order. If all adjacent land is occupied, the completed item remains at full progress and retries on a later turn; unspent materials remain in the city's stockpile. A Storehouse adds 1 material per turn after completion. Guard combat and Worker actions are not implemented. The HUD exposes city population, food/material stockpiles and yields, claim size, queue choice/cost, progress, and explicit order rejection or completion messages.

### Implemented: play by messenger

Two people can play **Meridian Union** (host, moves first) and **Lantern Compact** (guest) on the same seeded world without a server. On their own turn a player gives any number of orders, then ends the turn. The finished turn travels as a link, a code or a file through any chat, and the opponent's device replays it and takes over. Turns strictly alternate; the round counter increases after both factions have played. Nothing resolves simultaneously, and an opponent's message can never contain orders for the receiving player's side. A player can run several matches with different people at once; each received turn opens its own match, and a list shows where it is their turn.

Fog stays per faction: each player sees only their own explored and visible tiles, and the HUD lists only their own cities. Both devices hold the whole match, so this is a courtesy rule rather than a secret, and the mode suits friends rather than ranked play. The map draws every unit as a small voxel figure with its faction colour and each city with a name plate and a coloured territory border; the opponent's cities and units appear only while they are in sight. A match has no victory or defeat condition, so the rivals cannot interact beyond racing each other; combat or diplomacy is the natural next step. The technical design is [ADR-005](architecture.md#adr-005-serverless-play-by-messenger).

## First playable: two representative factions

- **Meridian Union:** one civic feature—its first food improvement also reduces local unrest. Demonstrates the economy/policy/unrest connection.
- **Lantern Compact:** one exploration feature—its scout receives one additional movement point. Demonstrates movement/fog differentiation.

Use the same basic units, buildings, and research for both. First playable includes one small map, founding and growth, production, worker improvements and roads, a short research graph, one policy choice, unrest, peace/war diplomacy, heuristic AI, fog, and one victory condition. Balance these two features before adding factions or unique systems.

**Concrete planned match:** a fixed 24 × 24 map, one human and one AI faction, each starting with a founder and scout. Found up to two cities and choose between producing a guard, a worker, or a storehouse. Explore to reveal three neutral beacon sites. Hills cost two movement points versus grassland's one and grant a visible defensive bonus: occupy a slower hill or take the exposed short route. Choose **Surveying** (cheaper road construction) or **Terracing** (improved hill food yields) as the first research. Choose the council policy **Common Granaries** (+food, reduced production) or **Civic Workshops** (+production, increased unrest). This is the first minimal government decision, not a separate government simulation. Happiness is initially represented by inverse unrest, with a warning and yield penalty above one explicit threshold.

Begin at peace; offer a ten-turn nonaggression pledge or declare war to contest the beacons. **Victory:** hold two of the three beacon sites at the end of three consecutive own turns. Defeat follows loss of all cities and founders; turn 40 is a draw if no faction has won. Resolve defeat before beacon victory, then the turn cap; the active faction resolves its condition at its end-turn boundary. Test these exact boundaries. These values are an initial testable design, subject to recorded playtest revision—not implemented in this PR.

## Visual and interaction direction

**Original voxel Art Deco:** block-built landforms, stepped civic shapes, restrained brass detailing, geometric typography, and clean panels in the HUD.

The world itself uses the bright diorama palette of the [hex voxel concept](concept-hex-voxel.jpg) (`VOXEL` in `src/rendering/voxels.ts`): green grass, blue water, sandy coasts, brown soil and cliffs, and leaf colours from teal to lime. The Art Deco palette below is for the HUD and UI; gold also marks focus and city plates.

| HUD and UI role | Palette |
| --- | --- |
| Navy background/panels | `#102538` |
| Teal accents | `#287F82` |
| Gold focus/civic details | `#D6AF58` |
| Ivory text/highlights | `#F2E9D4` |

Forest uses clustered stepped crowns; hills use broad terraces; mountains use taller narrow peaks; water stays low and flat with restrained color grain. Coasts read through a light shallow rim, a turquoise shoal, a blue shelf and deeper open water, all derived only from charted land. The hex grid is a quiet aid: faint on open water and fading when zoomed out, so coasts, borders and outlines carry the overview. Terrain identity must not rely on color alone.

Selection is a high-contrast gold hex outline plus inspector text. Ownership uses a faction-coloured border band on the inner edge of each territory, distinct from selection; city name plates carry the population. Expedition fog uses subdued explored tiles and opaque uniform unseen tiles, hiding terrain silhouettes, trees, picking and tooltips. Provide readable labels, keyboard-accessible controls, and a non-color selection indicator.

**Hex voxel world (implemented):** the approved concept [`concept-hex-voxel.jpg`](concept-hex-voxel.jpg) combines hex fields with cubic voxels: each hex is a stepped diorama column with cliffs and soil, a calm surface with a few small trees on its back row, so the centre stays free for a unit figure. It draws on the readable board layout of *Into the Breach*, the clear territories and city plates of *Polytopia* and the chunky voxel figures of *Voxel Tactics*, without copying their art. It departs from `showcase.png` in tile shape and palette with explicit user approval. Since then the two references split the authority: the concept governs the look of the board, and `showcase.png` remains authoritative for landforms, composition and scale. The binding graphics rules are in the [Copilot instructions](../.github/copilot-instructions.md#graphics-rules-for-the-hex-voxel-world).

Prototype controls: bounded pan, bounded zoom, click/tap to inspect, reset view, seed/dimension inputs with inline errors. Keep the camera's orthographic orientation fixed. Display tile coordinates, canonical ID, terrain, and any resource; don't imply future gameplay is already available.
