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
- Implemented generator version 4 hashes the ASCII seed with FNV-1a and uses Mulberry32. Warped shores and deep curved bays give the larger islands more organic silhouettes while retaining broad separated landmasses. Bays are canonical water, not a cosmetic cutout: the same map drives movement, exploration and replay. Rules are version 4; older-generator and older-rule matches are kept unchanged but require a compatible version to resume. Movement traversal order is east, south-east, south-west, west, north-west, north-east.
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

A* finds a destination route, bounded by remaining movement; Dijkstra produces the reachable range. Both use charted, unoccupied terrain only, the fixed hex neighbour order and FIFO ties at equal priority. Movement resolves immediately and reveals sight along the route; rules v4 retain the combined current sight of all own units and cities. End-turn activates the next faction and refreshes its movement; the round increments on wrapping to the first faction. With one faction, each end-turn increments the round. Production can add a new unit's sight.

Commands carry faction and monotonically increasing sequence IDs. Invalid orders leave state, history and RNG unchanged. No command currently consumes randomness. Accepted commands are retained in memory for deterministic tests; this is not a save/replay format. The UI offers one scout without opponent AI or faction bonuses. Multi-faction turn order, occupancy and separate fog are domain-tested foundations, not a claim of a complete match.

### Implemented city economy slice (rules version 2)

Each faction starts with one scout and one founder on adjacent land. Founding consumes the founder. A founder may settle only explored land outside every existing city's claims and at least five hexes from another city; a city claims unowned land within hex radius 1 (its own hex and up to six neighbours). Each faction is capped at two cities. Since rules version 3 each city takes the next name from its faction's fixed list (Meridian: Sonnenfurt, Lichtau, …; Lantern: Nordhain, Silberbach, …) in founding order.

Claimed grassland yields 2 food and 1 material per turn; hills yield 1 food and 2 materials; water cannot be claimed. At each active faction's end turn, its cities resolve in founding order: add yields, consume 2 food per population, grow by at most one population if the remaining food reaches `8 + 4 × current population`, then apply materials to the single production queue. If available food cannot cover consumption, the stockpile becomes zero and population does not grow or decline. These initial values are explicit rules-versioned definitions, not balance claims.

The queue choices are **Guard (8 materials)**, **Worker (10)**, and **Storehouse (12)**. A completed Guard or Worker appears on the first free adjacent land hex in the fixed hex neighbour order. If all adjacent land is occupied, the completed item remains at full progress and retries on a later turn; unspent materials remain in the city's stockpile. A Storehouse adds 1 material per turn after completion. Guard combat and Worker actions are not implemented. The HUD exposes city population, food/material stockpiles and yields, claim size, queue choice/cost, progress, and explicit order rejection or completion messages.

### Direct orders and availability (rules version 4)

Tap/click an own unit or its hex to select it. Only its affordable destinations are highlighted; tapping one moves immediately, with no second confirmation button. Scouts retain 4 movement points; founders, guards and workers have 2. Every unit and city provides radius-2 sight; movement reveals its route while the union of current own sight remains visible. Incoming units regain their own budgets at turn start. Existing terrain costs and occupancy still apply. Guard combat, worker improvements and roads remain deferred.

A static glow marks own units with at least one legal destination. Exhausted or blocked units do not glow; selecting them remains possible. Own cities glow while their production queue is empty. Tapping the city or its name plate selects its production controls; queuing removes the glow, completion restores it. Selection has its own outline and accessible pressed state. While waiting for the opponent, neither units nor cities glow or accept orders. The sidebar scout shortcut, city selector and direction buttons remain available. Readable saves using older rules are preserved unchanged but require a compatible version; they are never replayed under rules v4.

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

The world itself uses the bright diorama palette of the [hex voxel concept](concept-hex-voxel.jpg) (`VOXEL` in `src/rendering/voxels.ts`): yellow-green grass, cyan shallows, saturated deep-blue water, pale sandy coasts, warm earth, grey stone, forest/olive foliage and terracotta roofs. Match colours in the rendered image, including shadows and transparent-water blending, not just in the palette constants. Representative grass/deep-water median targets and tolerances are recorded in [ADR-004](architecture.md#adr-004-map-and-rendering); a procedurally different scene cannot be pixel-identical to the illustration. The Art Deco palette below is for the HUD and UI; gold also marks focus and city plates.

| HUD and UI role | Palette |
| --- | --- |
| Navy background/panels | `#102538` |
| Teal accents | `#287F82` |
| Gold focus/civic details | `#D6AF58` |
| Ivory text/highlights | `#F2E9D4` |

Forest uses clustered stepped crowns; hills use **low connected terraces, not separate grassy pillars or cones on each hex**. The four detailed land levels span only 0.625–1 world units, with localized grey stone outcrops instead of repeated mountain columns. Coarse voxels merge elevations rather than making them taller. A separate mountain terrain remains deferred. Trees are about one third shorter than the earlier pass, at most 0.75 world units high with narrower crowns, so the hexes stay readable. Water has a level translucent surface over **four broad submerged terraces and sparse coastal rock groups**, with visible cubic top and side faces. Some irregular rock groups remain wholly submerged; others break through the cap near shallow shores. They are compact outcrops, not tall thin pillars, and exposed grey rock replaces the water surface in its footprint. A flat plane decorated with squares is not the intended voxel water, nor are ten or more narrow stair rings. The seabed follows warped distance from charted land, creating irregular coves; sandy shallows fade through patchy stone into a muted deep-blue floor. Keep the four main depths independent of fine voxel density: material colour patches are not additional height steps. Coarser grids merge unrepresentable levels; the coarsest scale omits coastal relief and rocks. Opaque blue walls close the diorama sides. Thin water hexes sit on the level cap without hiding the underwater relief. There are no dynamic waves, refraction or water physics; exposed rocks are picked at their real height but remain water tiles with unchanged rules. Terrain identity must not rely on color alone.

**Sandbanks are areas and cliff interruptions, not painted outlines.** Broad, irregular pale-sand pockets lower parts of existing land hexes to just above the water, sometimes occupying the centre of a tile. Alternate wide beaches, small inlets and intact cliffs, with sandy side faces and a low inland shelf. Only charted water can shape a bank; unseen neighbours must not reveal their coastline. Keep whole tree roots off these lowered areas, allow sparse stones, and retain level settlement sites and dry land-resource sites. Figures and selection follow the actual terrain height. These are visual changes inside existing land, not newly walkable water tiles or changes to domain elevation and movement.

**Stone, apples and fish are visual occurrences, not a new economy.** Hills can carry broad irregular grey voxel deposits, grassland small round apple groves with red fruit, and water a fish-shoal symbol. Stone groups combine overlapping blocks with varied flat cap heights, chipped shoulders and occasional rubble, not identical narrow towers. Their centres stay clear for figures at scale 4 and finer. Original projected icons identify each kind; hover and selection name it and explicitly say harvesting is not available. Placement is deterministic and independent of simulation RNG. Unknown occurrences stay hidden, remembered ones are dimmed, and a city replaces the occurrence on its tile. Icons stay sparse and disappear in the overview; they are UI annotations, not image textures on the terrain. Harvesting, resource yields, worker extraction and further resource kinds need a separate rules decision.

**Surface shading:** water is calm, but not a single flat colour. Its translucent cap has stepped blue/turquoise light and dark patches; grass, sand and rock tops have finer material shades. Five tone levels follow world-aligned voxel cells rather than screen pixels or hex-sized colour blocks. Water uses broader 2-by-2-voxel patches; ground uses one-voxel detail. Fine contrast recedes in the overview and stays softer along the shoreline. Sparse animated sun glints add a sense of motion without displacing water or hiding the underwater terraces. Keep them subtle and translucent, not bright white flashes: at most 35% sun-colour blending and about a third fewer flashes than the initial glint implementation. Their world-anchored flashes run at at most about 12.5 idle frames/second, stop under reduced motion and in distant overviews, and exclude remembered water. No imported image textures are used; uncharted fog stays uniform.

Ordinary hex frames on **both land and water** are crisp, approximately one-pixel hairlines, not wide blurry strokes. Visible cap lines supersede the earlier water-grid suppression; submerged floors never inherit a grid. Reachable outlines and territory bands remain land-only and slimmer too, with restrained glow rather than broad colour smears. Selection remains a high-contrast gold hex outline plus inspector text. Ownership uses a faction-coloured border band on the inner edge of each territory, distinct from selection; city name plates carry the population. Expedition fog uses subdued explored tiles and opaque uniform unseen tiles, hiding terrain silhouettes, trees, resources, picking and tooltips. Provide readable labels, keyboard-accessible controls, and a non-color selection indicator.

**Hex voxel world (implemented):** the approved concept [`concept-hex-voxel.jpg`](concept-hex-voxel.jpg) combines hex fields with cubic voxels: each hex is a stepped diorama column with cliffs and soil, a calm surface with a few small trees on its back row, so the centre stays free for a unit figure. It draws on the readable board layout of *Into the Breach*, the clear territories and city plates of *Polytopia* and the chunky voxel figures of *Voxel Tactics*, without copying their art. It departs from `showcase.png` in tile shape and palette with explicit user approval. Since then the two references split the authority: the concept governs the look of the board, and `showcase.png` remains authoritative for landforms, composition and scale. The binding graphics rules are in the [Copilot instructions](../.github/copilot-instructions.md#graphics-rules-for-the-hex-voxel-world).

Prototype controls: bounded pan, bounded zoom, click/tap to inspect, reset view, seed/dimension inputs with inline errors. Keep the camera's orthographic orientation fixed. Display tile coordinates, canonical ID, terrain, and any resource; don't imply future gameplay is already available.

**Reference-aligned camera and finer fields:** the fixed view uses yaw 45° and pitch 35.264° so the two horizontal cube axes have equal projected length and slope at 30°. This is a consistent isometric calibration of the illustrated reference, whose exact camera data is unavailable. The 32² showcase uses 16 voxels across each hex rather than 8, about four times as many surface cells; trees, buildings and coast widths retain their world-space proportions. In the overview, maps with a dimension above 32, 64 or 128 step down to 8, 4 or 2 voxels respectively. Zooming in restores detail up to 16 in a bounded window around the visible area, including trees, deposits, banks and underwater terraces. The visible window has one resolution at a time; discrete height rounding changes together with picking and figure placement, rather than producing mixed-resolution seams. The hard maximum is 256 × 256. This changes rendering detail, not the domain hexes, map generation, movement, saved games or rules.
