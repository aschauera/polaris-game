# Polaris: architecture

## Scope and boundaries

Browser-first **strict TypeScript + Vite + Babylon.js WebGL2**, in a single package. The atlas and first scout-exploration slice are implemented, not the full first-playable match. Pure `src/game` owns generation, commands, pathfinding and faction fog. Use **Vitest in Node** for domain tests and **Playwright** for browser behavior.

| Directory | Responsibility | Must not contain |
| --- | --- | --- |
| `src/game` | Definitions, seeded generation, immutable expedition state, commands, movement/fog; later saves/AI | DOM, Babylon objects, wall-clock time, renderer state |
| `src/rendering` | Babylon scene, chunk batches, camera, visual picking adapters | Authoritative gameplay rules or independent tile state |
| `src/ui` | Inputs, validation feedback, inspector, future HUD | Simulation logic or direct mutation of domain state |

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

- Canonical tile ID is **`z * width + x`**, row-major. Coordinates derive from ID; renderer instance indices are not tile IDs.
- Validate dimensions as integers **8–256** and seed as **`^[A-Za-z0-9_-]{1,64}$`** at the domain boundary. Reject bad values before allocation or generation.
- **Generator version 2:** hash the ASCII seed with unsigned 32-bit **FNV-1a**, then generate randomness with **Mulberry32**. V2 places separated irregular continent forms, then derives coast noise, stepped elevation and clustered trees. Preserve these algorithms and fixtures when refactoring; incompatible changes require a version bump. PRNG state is explicit, never a global singleton or `Math.random()`; future commands/saves must preserve it.
- Use stable row-major generation. Future entity IDs, command sequence numbers, neighbor order, and tie-breakers must be explicit; planned traversal order is **north, east, south, west**. Avoid relying on unordered collections or callback completion order.
- Keep authoritative arithmetic integer-based where practical. Never use frame delta, wall time, DOM state, or Babylon transforms to resolve gameplay.
- Unit tests must verify fixed fixtures, repeatability, PRNG state transitions, rectangular-map IDs, bounds, and invalid inputs.

**Command resolution:** rules version 1 established deterministic movement and turns; rules version 2 adds founding, city economy and production. `applyCommand` validates faction, sequence and legality, rejecting with a reason and the identical state reference. Accepted orders return immutable snapshots, explicit affected tile IDs where rendering changes, and a user-facing outcome. The accepted-command log retains sequence order; no command consumes RNG. Movement resolves immediately. At end-turn, the active faction's cities resolve in founding order before control advances; incoming scout movement is restored and the round increments on wrap. No simultaneous resolution, AI or save format is introduced.

`findPath` uses Manhattan A* and `movementRange` uses Dijkstra, sharing a binary min-heap. Equal priorities preserve insertion order, neighbors are N/E/S/W, and equal-cost rediscoveries retain the first parent. Searches stop at the current integer movement budget and cannot traverse uncharted terrain, water or occupied tiles. The UI submits commands and displays domain outcomes rather than independently resolving rules.

## ADR-003: data and persistence

Terrain/resource definitions are typed, data-driven records with stable symbolic IDs. City yields, founding constraints and production items follow the same approach; their effects live in `src/game`, separate from HUD presentation. Future research, policy, and faction definitions should follow this pattern. Validate references and constraints on loading; keep presentation metadata separate from authoritative effects.

**Future saves/replays—not prototype features:** use an envelope carrying schema, generator, rules, content, and RNG algorithm versions, map dimensions/seed, canonical entity IDs, explicit RNG state, turn/phase, and command-log version. Saves contain authoritative state; replay starts from the recorded initial state and ordered commands. Validate shape, bounds, unique IDs, references, versions, and size limits before accepting either. Reject unsupported versions clearly; migrations must be explicit and tested. Do not serialize Babylon meshes or assume a seed alone reconstructs a progressed game. Verify state hashes at checkpoints to detect replay divergence.

## ADR-004: map and rendering

- Square grid, four-cardinal movement; diagonals deferred. Squares simplify row-major storage, rectangular chunks, voxel construction and picking. Hexes offer six more uniform movement directions and fewer corner ambiguities, but complicate coordinates, chunking and block-built visuals. Prefer the simpler square contract until gameplay evidence justifies a breaking topology change.
- World axes: **x east, z south, y up**. One consistent tile scale and origin for generation, rendering, camera bounds, and picking.
- Current renderer: **16 × 16 spatial chunks**, grouped by terrain/type, using box geometry and **thin instances**, not one mesh per tile. Each batch shares its cube geometry across its instances; different source batches need distinct geometries because Babylon stores thin-instance matrix attributes there. Two map-wide thin-instance meshes add clustered tree trunks and canopies. There are **three terrain materials, two tree materials and two marker materials**. With all three terrain batches populated in each chunk, the showcase has **4 chunks × 3 + 4 = 16 meshes**; stress has **256 chunks × 3 + 4 = 772 meshes**. Empty terrain batches may reduce counts. The tree and marker meshes are map-wide, not per chunk. Mesh count is not a measured draw-call count.
- Keep an explicit `(chunk, type, instance index) → canonical tile ID` table; update it whenever batches rebuild. Picking must return domain IDs, including after regeneration; never infer identity from draw order.
- Separate selection overlays from terrain batching. Decorative objects must not intercept tile picking without an explicit mapping.
- Fixed orthographic orientation; no rotation. Pan target clamps to tile centers `0..width-1`, `0..height-1`, with no outside padding. Zoom half-height clamps from 3 world units to an aspect-correct whole-map fit with 3 units of framing margin. Resize preserves the relative zoom. Ray intersection/pick results go through the mapping adapter, then domain bounds validation.
- Dispose old batches, buffers, listeners, and selection on regeneration. Clear stale picks and selection before showing a replacement map.
- Detect missing WebGL2 and display a useful fallback message rather than an empty canvas.

### Future incremental work and simulation costs

Implemented fog is a faction-owned sparse immutable record of explored/visible tile IDs; absent entries are unseen. Terrain is immutable, so the map itself is the remembered terrain source. Moving copies the discovered record, processes old/new/traveled sight regions (not every map tile) and returns only changed visibility IDs. End-turn and camera motion do not alter fog. Mutable last-known terrain and enemy-unit hiding remain brief 11 work.

Renderer matrices and RGBA colors are dynamic thin-instance buffers. Unknown terrain receives a uniform height/color and hidden trees, with no terrain-dependent silhouette or picking result. Explored terrain/trees are dimmed. Commands update only dirty visibility and old/new movement-range instances via partial GPU buffer writes; affected terrain-chunk bounds and Babylon CPU picking matrices are synchronized. Trees retain conservative original world bounds rather than rescanning the entire forest after every move. Full mode transitions/regeneration initialize all tiles. A separate non-pickable scout indicator renders above decorative trees and is disposed on leaving the expedition or regeneration. No per-tile meshes or per-frame visibility computations are added.

Pathfinding should start with deterministic A* for a single destination and Dijkstra for movement ranges. On a four-cardinal grid, edges scale with tile count; heap-based searches can approach O(V log V) and O(V) memory. Repeating a full search for every unit/candidate can dominate AI turns. Bound AI candidate sets and search counts, reuse valid results with explicit terrain/occupancy invalidation, and measure expanded nodes and per-turn work. Defer Web Workers until profiling shows main-thread stalls justify serialization and coordination costs. If introduced, use immutable inputs, explicit RNG state and ordered results; worker scheduling must not alter outcomes. This refers to browser threads, not gameplay worker units.

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
| Draw calls per frame | ≤20 | ≤800 | Terrain and markers, shadows/postprocessing disabled; instrument, do not infer from mesh count |
| Future turn resolution, p95 | ≤100 ms | ≤500 ms | Domain + one AI faction; fixed fixture of 100 total units/10 cities; excludes animation/rendering |

Future turn budgets are unimplemented targets, not generator performance claims. Publish actual numbers, fixture details and gaps before calling any target met. Optimize only demonstrated bottlenecks while retaining deterministic fixtures and correct picking.
