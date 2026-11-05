# Polaris: game design

## Vision and scope

An original, browser-first, turn-based 4X game about rival societies rebuilding a fractured world. Explore readable voxel landscapes, grow cities, and choose between cooperation and conquest. Art Deco geometry gives the world civic grandeur without copying an existing game's art, names, factions, or rules.

**This PR delivers only the map prototype:** seeded terrain, an interactive camera, tile inspection, and a visual foundation. No units, turns, cities, ownership simulation, fog rules, or victory logic are implemented here. The [visual mockup](visual-mockup.svg) is an original labeled concept, not a screenshot or implementation commitment.

## Map contract

- Square tiles; world axes are **x east, z south, y up**.
- Movement adjacency is four-cardinal. Diagonal movement is deferred; isometric presentation does not imply diagonal adjacency.
- Dimensions are integers from **8 through 256**, inclusive, on each axis.
- Seeds are strings of **1–64 ASCII letters, digits, underscores, or hyphens**; preserve case and reject invalid input rather than silently rewriting it.
- Default showcase: **32 × 32**. Stress fixture: **256 × 256**.
- A seed, dimensions, generator version, and rules/content versions identify a reproducible map.
- Implemented generator version 1 hashes the ASCII seed with FNV-1a and uses Mulberry32. Planned movement traversal order is north, east, south, west.
- Target terrain vocabulary: plains, forest, hills, mountains, and water. The current renderer uses three terrain material types and two marker materials on shared boxes; the richer silhouettes below are art direction, not a claim of implemented assets. Prototype resource markers are decorative or inspectable data only, not an economy.

## Planned core loop

Observe → issue valid orders → commit the turn → resolve in a documented stable order → inspect outcomes. Exploration opens settlement choices; settlements fund units, infrastructure, and research; policy and diplomacy shape whether expansion remains sustainable.

| Future system | Initial playable rule | Later depth |
| --- | --- | --- |
| Terrain and resources | Terrain movement costs; food/material deposits; water and mountains impassable to initial land units | Biomes, strategic resources, extraction limits, environmental events |
| Movement | Four-cardinal paths; movement points; occupancy and enemy blocking; deterministic path ties | Embarkation, supply, zone of control; diagonals only after a rules decision |
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

## First playable: two representative factions

- **Meridian Union:** one civic feature—its first food improvement also reduces local unrest. Demonstrates the economy/policy/unrest connection.
- **Lantern Compact:** one exploration feature—its scout receives one additional movement point. Demonstrates movement/fog differentiation.

Use the same basic units, buildings, and research for both. First playable includes one small map, founding and growth, production, worker improvements and roads, a short research graph, one policy choice, unrest, peace/war diplomacy, heuristic AI, fog, and one victory condition. Balance these two features before adding factions or unique systems.

## Visual and interaction direction

**Original voxel Art Deco:** block-built landforms, stepped civic shapes, restrained brass detailing, geometric typography, and clean panels.

| Role | Palette |
| --- | --- |
| Navy background/panels | `#102538` |
| Teal land/accents | `#287F82` |
| Gold focus/civic details | `#D6AF58` |
| Ivory text/highlights | `#F2E9D4` |

Forest uses clustered stepped crowns; hills use broad terraces; mountains use taller narrow peaks; water stays low and flat. Terrain identity must not rely on color alone.

Selection is a high-contrast gold perimeter plus inspector text. Future ownership uses inset border patterns and faction symbols, distinct from selection. Future fog uses subdued explored tiles and opaque unseen tiles; never expose hidden units through picking or tooltips. Provide readable labels, keyboard-accessible controls, and a non-color selection indicator.

Prototype controls: bounded pan, bounded zoom, click/tap to inspect, reset view, seed/dimension inputs with inline errors. Keep the camera's orthographic orientation fixed. Display tile coordinates, canonical ID, terrain, and any resource; don't imply future gameplay is already available.
