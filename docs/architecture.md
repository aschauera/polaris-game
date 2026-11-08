# Polaris: architecture

## Scope and boundaries

Browser-first **strict TypeScript + Vite + Babylon.js WebGL2**, in a single package. The atlas, the first scout-exploration slice and a serverless two-player turn exchange (ADR-005) are implemented, not the full first-playable match. Pure `src/game` owns generation, commands, pathfinding, faction fog and the match package (replay plus checksums). Use **Vitest in Node** for domain tests and **Playwright** for browser behavior.

| Directory | Responsibility | Must not contain |
| --- | --- | --- |
| `src/game` | Definitions, seeded generation, immutable expedition state, commands, movement/fog, match packages (replay log and checksums); later saves/AI | DOM, Babylon objects, wall-clock time, renderer state |
| `src/exchange` | Turn codes (compress, encode, decode links/files) and the browser-storage adapter for a running match | Game rules, Babylon objects; storage is injected, never reached through globals |
| `src/rendering` | Babylon scene, pure voxel construction/meshing (`voxels.ts`), camera, heightfield picking adapter | Authoritative gameplay rules or independent tile state |
| `src/ui` | Inputs, validation feedback, inspector, HUD, messenger panel | Simulation logic or direct mutation of domain state |

Dependencies point toward `src/game`. A small composition entry point wires adapters together. Rendering and UI consume domain snapshots/events and submit intents; neither determines authoritative outcomes.

## ADR-001: browser stack

**Decision:** strict TypeScript, Vite, Babylon.js, WebGL2, one package.

| Alternative | Tradeoff and reason not selected |
| --- | --- |
| Godot native | Strong editor and native pipeline. Current Godot 4 C# projects cannot export to web; web export requires the Compatibility renderer and WebGL2, not Forward+/Mobile rendering parity. Those constraints favor the TypeScript browser stack here |
| Three.js renderer | Flexible, smaller rendering abstraction; more camera, picking, batching, and tooling assembly than Babylon for this prototype |
| Unity | Mature tooling, but heavier browser delivery and proprietary terms require a current legal/commercial terms review before any adoption |
| Bevy/Rust | Attractive ECS and native performance; Rust/WASM integration and browser tooling add complexity before gameplay needs justify it |

Revisit Godot if native desktop/mobile becomes the primary distribution target, console delivery becomes a requirement, or profiling shows browser memory/rendering limits prevent the required scope. Assess platform support and export constraints then; a native-primary decision is not a promise of equivalent web support. Revisit the renderer on measured browser incompatibility or demonstrated limits, not speculative scale. **WebGPU is deferred**; WebGL2 is the prototype baseline. This decision does **not** choose a source-code license; review dependency obligations separately when installing packages.

## ADR-002: deterministic domain

- Canonical tile ID is **`z * width + x`**, row-major. Coordinates derive from ID; renderer chunk, vertex or draw indices are not tile IDs.
- Validate dimensions as integers **8–256** and seed as **`^[A-Za-z0-9_-]{1,64}$`** at the domain boundary. Reject bad values before allocation or generation.
- **Generator version 2:** hash the ASCII seed with unsigned 32-bit **FNV-1a**, then generate randomness with **Mulberry32**. V2 places separated irregular continent forms, then derives coast noise, stepped elevation and clustered trees. Preserve these algorithms and fixtures when refactoring; incompatible changes require a version bump. PRNG state is explicit, never a global singleton or `Math.random()`; future commands/saves must preserve it.
- Use stable row-major generation. Future entity IDs, command sequence numbers, neighbor order, and tie-breakers must be explicit; planned traversal order is **north, east, south, west**. Avoid relying on unordered collections or callback completion order.
- Keep authoritative arithmetic integer-based where practical. Never use frame delta, wall time, DOM state, or Babylon transforms to resolve gameplay.
- Unit tests must verify fixed fixtures, repeatability, PRNG state transitions, rectangular-map IDs, bounds, and invalid inputs.

**Command resolution:** rules version 1 established deterministic movement and turns; rules version 2 adds founding, city economy and production. `applyCommand` validates faction, sequence and legality, rejecting with a reason and the identical state reference. Accepted orders return immutable snapshots, explicit affected tile IDs where rendering changes, and a user-facing outcome. The accepted-command log retains sequence order; no command consumes RNG. Movement resolves immediately. At end-turn, the active faction's cities resolve in founding order before control advances; incoming scout movement is restored and the round increments on wrap. No simultaneous resolution, AI or save format is introduced.

`findPath` uses Manhattan A* and `movementRange` uses Dijkstra, sharing a binary min-heap. Equal priorities preserve insertion order, neighbors are N/E/S/W, and equal-cost rediscoveries retain the first parent. Searches stop at the current integer movement budget and cannot traverse uncharted terrain, water or occupied tiles. The UI submits commands and displays domain outcomes rather than independently resolving rules.

## ADR-003: data and persistence

Terrain/resource definitions are typed, data-driven records with stable symbolic IDs. City yields, founding constraints and production items follow the same approach; their effects live in `src/game`, separate from HUD presentation. Future research, policy, and faction definitions should follow this pattern. Validate references and constraints on loading; keep presentation metadata separate from authoritative effects.

**Future saves/replays—not prototype features:** use an envelope carrying schema, generator, rules, content, and RNG algorithm versions, map dimensions/seed, canonical entity IDs, explicit RNG state, turn/phase, and command-log version. Saves contain authoritative state; replay starts from the recorded initial state and ordered commands. Validate shape, bounds, unique IDs, references, versions, and size limits before accepting either. Reject unsupported versions clearly; migrations must be explicit and tested. Do not serialize Babylon meshes or assume a seed alone reconstructs a progressed game. Verify state hashes at checkpoints to detect replay divergence. The **match package** of ADR-005 is the first, deliberately narrow use of this idea: a versioned, validated command log replayed from a seed with two checksums. It does not carry content or RNG-algorithm versions yet, because no command consumes randomness.

## ADR-004: map and rendering

- Square grid, four-cardinal movement; diagonals deferred. Squares simplify row-major storage, rectangular chunks, voxel construction and picking. Hexes offer six more uniform movement directions and fewer corner ambiguities, but complicate coordinates, chunking and block-built visuals. Prefer the simpler square contract until gameplay evidence justifies a breaking topology change.
- World axes: **x east, z south, y up**. One consistent tile scale and origin for generation, rendering, camera bounds, and picking.
- Current renderer: **voxel terrain in 64 × 64-column chunks**, one mesh per chunk, not one mesh per tile. The pure module `src/rendering/voxels.ts` builds a voxel volume from the domain map, with **8 voxels per tile edge** up to 64², 4 up to 128² and 2 above. Powers of two keep voxel coordinates exact and cap the columns at 512 per axis. Each tile becomes a column stack: a stratified soil base, banded dirt or rock cliffs, a grass, sand or rock surface, terraced hill mounds, and trees, tufts, flowers and stones stamped deterministically from the map seed. A greedy mesher emits only visible faces with palette colours and per-corner ambient occlusion; faces merge only when their occlusion is uniform. Stamps only fill empty voxels and each chunk meshes a one-voxel apron, so chunk borders are identical from both sides. The module holds no Babylon objects; Node tests cover winding, chunk-border equivalence, fog leaks, picking and vertex budgets.
- `world.ts` uploads each chunk as a `Mesh` sharing one `StandardMaterial` with a material plugin. The plugin adds per-voxel colour grain, explored dimming and the reachable-range tint, read from a **width × height tile-state texture**, plus flat unlit fog. Lighting is a hemispheric fill and a directional sun with one 1024² PCF shadow map. The shadow map uses a 16-bit single-channel colour target plus 32-bit depth, about 6 MiB, fixed and independent of map size. It is redrawn only after map changes or remeshing once shaders are ready, not every frame. Estimated map GPU allocations are therefore about 11 MiB for the showcase and 24 MiB at 256². The showcase has **16 chunks + 2 markers = 18 meshes, 3 materials**; the 256² fixture has **64 chunks, 66 meshes**. Unit tests cap the meshed showcase at 250k vertices and both larger fixtures at 900k.
- Picking does not ray-cast meshes. The renderer keeps a per-tile surface height, which is the fog height for unseen tiles. `pickTile` walks the camera ray through the tile grid (2D DDA) and returns the canonical ID of the first column the ray enters at or below its surface. Unit tests check it against a brute-force intersection. Decorations never intercept picks, and identity never derives from draw order.
- Separate selection overlays from terrain chunks; markers and the scout render in a later rendering group so trees cannot hide them.
- Fixed orthographic orientation; no rotation. Pan target clamps to tile centers `0..width-1`, `0..height-1`, with no outside padding. Zoom half-height clamps from 3 world units to an aspect-correct whole-map fit with 3 units of framing margin. Resize preserves the relative zoom. Ray intersection/pick results go through the mapping adapter, then domain bounds validation.
- Dispose old chunk meshes, the tile-state texture, listeners and selection on regeneration. Clear stale picks and selection before showing a replacement map.
- Detect missing WebGL2 and display a useful fallback message rather than an empty canvas.

### Future incremental work and simulation costs

Implemented fog is a faction-owned sparse immutable record of explored/visible tile IDs; absent entries are unseen. Terrain is immutable, so the map itself is the remembered terrain source. Moving copies the discovered record, processes old/new/traveled sight regions (not every map tile) and returns only changed visibility IDs. End-turn and camera motion do not alter fog. Mutable last-known terrain and enemy-unit hiding remain brief 11 work.

Unseen tiles are meshed as one flat slab at a uniform fog height and colour. They have no terrain-dependent height, silhouette, shadow, occlusion, trees or picking result. Only charted neighbours shape a tile's rim (beaches, shallows), and trees grow only from charted tiles, so known land never outlines hidden terrain. Explored dimming and reachable tiles come from the tile-state texture, updated in place, so remembering terrain and showing ranges never remesh. When tiles become charted, only the chunks within tree reach of them are remeshed (`affectedChunks`), in place; mesh and geometry counts stay constant. Full mode transitions and regeneration initialize all tiles. A separate non-pickable scout indicator renders above the terrain and is disposed on leaving the expedition or regeneration. No per-tile meshes or per-frame visibility computations are added.

Pathfinding should start with deterministic A* for a single destination and Dijkstra for movement ranges. On a four-cardinal grid, edges scale with tile count; heap-based searches can approach O(V log V) and O(V) memory. Repeating a full search for every unit/candidate can dominate AI turns. Bound AI candidate sets and search counts, reuse valid results with explicit terrain/occupancy invalidation, and measure expanded nodes and per-turn work. Defer Web Workers until profiling shows main-thread stalls justify serialization and coordination costs. If introduced, use immutable inputs, explicit RNG state and ordered results; worker scheduling must not alter outcomes. This refers to browser threads, not gameplay worker units.

## ADR-005: serverless play by messenger

**Decision:** two players exchange finished turns as text through any messenger, e-mail or file. A turn message is a **match package**: the complete ordered command log of the match so far plus what is needed to rebuild the world, never a snapshot of state.

```text
MatchPackage { format, matchId, rules, generator, seed, width, height, factions, commands[], mapHash, stateHash }
```

- **Replay, not state.** The receiver regenerates the map from seed and generator version and replays every command through `applyCommand`. This relies on ADR-002: integer arithmetic, explicit tie-breaks, no wall time and no randomness in commands. `mapHash` (hash of the generated tiles) proves both devices built the same world; `stateHash` (canonical hash of the replayed state, fog included) proves they reached the same position. A mismatch is refused with a reason and never half-applied.
- **Turn discipline.** `MATCH_FACTIONS` fixes the order: the host plays Meridian and moves first, the guest plays Lantern. A received package must end with `end-turn`, extend the local log of the same `matchId` (the shared prefix must be identical) and contain no orders for the receiver's own faction. Equal or shorter logs are reported as already known. Duplicates, reordering and lost messages are therefore harmless: the newest package supersedes everything before it, and an opponent's message can also start a match on a device that has never seen it.
- **Several matches.** The receiver reads the `matchId` before replaying and checks the package against that match's saved log, whichever match is on screen; an unknown `matchId` starts a new match. So any number of matches run side by side without the player sorting messages. The list of saved matches reads only the package shape and counts `end-turn` orders for round and active side (`matchProgress`); the full replay happens when a match is opened.
- **Untrusted input.** Packages are pasted text: caps on text (1.5 M characters) and decompressed JSON (1 MB), at most 10,000 orders, strict shape and identifier checks before the world is allocated, and the usual seed/dimension contract. Compact orders are re-validated by the normal rules during replay.
- **Encoding.** `polaris1z.<base64url(deflate-raw(JSON))>` with `CompressionStream`, falling back to `polaris1j.<base64url(JSON)>`. The decoder also accepts a link (`#turn=` fragment), a chat message around a code, or the JSON of a saved file. The prefix and `format` leave room for later versions. The fragment never reaches a web server.
- **Persistence.** Each match is stored as a package with the player's faction and an optional local name under its own `localStorage` key `polaris.matches.v1.<matchId>`; `polaris.current-match.v1` names the match that reopens after a reload. A match is replayed and verified when it is opened and discarded with a visible reason if it no longer verifies. The single match of earlier versions (`polaris.match.v1`) is migrated on start. The outbox is derived from state and faction instead of stored, so a reload offers the identical link.
- **Presentation.** `main.ts` remains the composition root. The viewer faction decides what is rendered (own fog, own scout, own reachable tiles) and whether orders are accepted; `src/game` knows nothing about devices or messengers.

| Alternative | Why not now |
| --- | --- |
| Hot-seat on one device | Two people cannot play remotely; rejected by the project owner |
| WebRTC or Bluetooth | Needs a live peer and a signalling exchange that is itself a copy-and-paste step; NAT and browser support add complexity |
| Relay or lobby server | Adds hosting, accounts, abuse handling and cost before the rules justify it; remains the path for secrets, simultaneous turns and notifications |

**Consequences and risks**

- No anti-cheat: both devices know everything, fog is presentation, checksums only detect accidents. Both players need the same game, rules and generator version; a mismatch is reported.
- The generator uses `Math.sin`, `Math.cos`, `Math.hypot` and `Math.sqrt`, whose last bits are not guaranteed identical across JavaScript engines (for example Chromium and Safari). Tile classification would only flip on a near-tie, and `mapHash` turns any such divergence into an explicit refusal at join time instead of a silent desync. Cross-engine play should still be tested on real devices; a table- or integer-based replacement needs a generator version bump and new fixtures.
- Links grow with the log. A file export is the fallback for chats that cut messages; delta packages (only the new orders plus a checksum of the shared prefix) are the next optimization if logs get long.
- Revisit with a server when hidden information, more than two players, asynchronous notifications or ranked play become requirements. The command log and checksums carry over unchanged.

## Benchmark protocol

**Initial evidence:** the first benchmark here will be a shorter software-rendered runner sample, not the full protocol below. Report its actual duration, sample count, software renderer, environment and limitations alongside results. Do not extrapolate it to hardware-rendered desktop/mobile performance, sustained frame rates, or leak-free operation. No numbers below are measurements.

**Future full protocol:** use the **32 × 32 showcase** and **256 × 256 stress fixture**, with fixed published seeds and generator version. Record browser/version, OS, CPU/GPU, RAM, viewport, device-pixel ratio, power mode, build mode, and commit. Test a production build on named desktop and mobile-class reference devices; runner results are not a device baseline.

After warm-up, perform five regenerations and a repeatable 30-second pan/zoom/pick path. Report median and worst generation-to-interactive time, p50/p95 frame duration, pick latency, draw calls, instance counts, and available memory indicators. Capture cold-load separately. Repeat regeneration 20 times to check retained resources; distinguish noisy browser memory indicators from verified leaks.

**Provisional targets, not measured results:** these apply to the eventual named desktop baseline; mobile budgets await measurements.

| Metric | 32 × 32 showcase | 256 × 256 stress | Measurement boundary |
| --- | --- | --- | --- |
| Map generation only, p95 | ≤25 ms | ≤250 ms | Pure domain generation; excludes scene upload and first frame |
| Generation-to-interactive | ≤1 s | ≤3 s | Includes generation, upload and first usable frame |
| Interaction frame duration, p95 | ≤33 ms | ≤50 ms | Warm pan/zoom/pick path |
| Pick-to-inspector, p95 | ≤100 ms | ≤100 ms | Input to visible inspector update |
| Map-attributable retained JS heap | ≤32 MiB | ≤128 MiB | Settled map minus empty-app baseline; report availability/noise |
| Estimated map GPU allocations | ≤16 MiB | ≤64 MiB | Buffers/textures counted separately from JS heap; not total browser memory |
| Draw calls per frame | ≤20 | ≤800 | Terrain and markers; the on-demand shadow-map pass is excluded. Instrument, do not infer from mesh count |
| Future turn resolution, p95 | ≤100 ms | ≤500 ms | Domain + one AI faction; fixed fixture of 100 total units/10 cities; excludes animation/rendering |

Future turn budgets are unimplemented targets, not generator performance claims. Publish actual numbers, fixture details and gaps before calling any target met. Optimize only demonstrated bottlenecks while retaining deterministic fixtures and correct picking.
