# Polaris: implementation roadmap

Planning briefs, not automatically created issues. **This PR is limited to the map prototype and its original visual concept.** The pure `src/game` generator and tests are implemented; the renderer uses 16×16 chunk/type box instances. Briefs below retain acceptance gates rather than implying every gate is verified. Future gameplay remains planned.

Sizes are rough focused-development estimates: **S** 1–2 days, **M** 3–5 days, **L** 6–10 days. Split an L brief before execution if acceptance cannot be reviewed together. Dependencies refer to brief numbers.

## Map prototype

| Brief / objective | Depends on | Boundaries | Acceptance | Size |
| --- | --- | --- | --- | --- |
| **1. Establish browser shell**: strict TS, Vite, Babylon WebGL2, Node Vitest, Playwright | None | One package; `src/game`, `src/rendering`, `src/ui`; no gameplay | App boots; unsupported WebGL2 has useful message; existing scripts support typecheck, domain and browser checks | S |
| **2. Build deterministic map model**: implemented generator/tests; retain regression gate | 1 | No DOM/rendering; 8–256 integer dimensions; seed 1–64 ASCII alphanumeric/underscore/hyphen; version 1 FNV-1a/Mulberry32 | Fixed fixtures repeat; invalid inputs rejected; rectangular IDs equal `z * width + x`; explicit PRNG state and stable iteration tested | M |
| **3. Render voxel terrain**: Art Deco materials and silhouettes | 2 | 16×16 spatial chunk/type thin instances; no units or economy | All terrain distinguishable; 32×32 showcase and 256×256 fixture render; regeneration disposes old resources; instance→tile mapping checked | M |
| **4. Make map inspectable**: fixed orthographic camera, bounded pan/zoom, picking and inputs | 3 | No rotation; no movement; future HUD controls not presented as functional | Resize/touch/mouse work; corner picks resolve canonical IDs; reset and regeneration clear stale selection; validation errors visible; keyboard-accessible inputs | M |
| **5. Verify prototype**: browser regression and measured benchmark report | 4 | No gameplay expansion or speculative optimization; initial shorter software-rendered runner evidence is not the full future device protocol | Domain/browser checks pass; sample duration/environment and limitations published; measured results separate from provisional budgets; regeneration and WebGL2 fallback covered; unperformed full-protocol checks explicitly pending | M |

**Recommended next task:** brief 5's initial benchmark evidence and remaining map-prototype acceptance checks, closing any unmet brief 1–4 gates first. Use the architecture's separate generation, interaction, memory and draw-call targets; do not treat a short software-rendered run as full-protocol verification or start gameplay to compensate for an incomplete prototype.

## First playable: two factions, one feature each

| Brief / objective | Depends on | Boundaries | Acceptance | Size |
| --- | --- | --- | --- | --- |
| **6. Add turn commands and movement** | 5 | Four-cardinal adjacency; integer movement costs; occupancy; diagonals deferred | Invalid commands do not mutate state/RNG; stable resolution and path ties tested; UI explains rejected orders | M |
| **7. Add founding, yields and production** | 6 | Small claim radius, food/material economy, one city queue | Valid founding/spacing, population food consumption, growth and queue completion tested; costs and progress visible | L |
| **8. Add workers and roads** | 7 | Turn-consuming improvements on owned deposits; road movement discount | Illegal work rejected; completion updates yields; connected road movement correct; no double completion | M |
| **9. Add tactical combat** | 6 | Adjacent on-map attacks, health and terrain defense; no separate battle scene | Preview matches resolution; death/occupancy handled; attacks and turn limits tested; visible damage explanation | M |
| **10. Add research, policies and unrest** | 7, 8 | Short prerequisite graph, one policy choice, explicit unrest thresholds | Unlocks/effects driven by validated definitions; thresholds and warning UI tested; no silent stacking | L |
| **11. Add faction fog** | 6, 9 | Unseen/explored/visible; last-known terrain; dirty regions/chunks, not whole-map updates per action/frame | Per-faction visibility updates correctly; unseen tiles and hidden units inaccessible through HUD/picks; explored information stays stale until seen; camera motion does not recompute fog | M |
| **12. Add basic diplomacy** | 7, 9 | Peace/war, bilateral proposals; no trade network | Acceptance/rejection and state transitions tested; war gates attacks; proposal UI shows terms | M |
| **13. Add two faction features and AI** | 8, 10, 11, 12 | Meridian civic improvement/unrest benefit; Lantern scout movement bonus; bounded heuristic AI/search; browser workers only after profiling | Both features observable and tested; deterministic decisions, no fog cheating or deadlock; search counts and future turn budget measured on fixed fixtures | L |
| **14. Close the first playable loop** | 13 | One territorial victory, defeat/draw; no additional factions | Two factions can complete a match; win/tie ordering documented and tested; tutorial explains representative features; recorded balance/playtest feedback | L |

## Reliability and later depth

| Brief / objective | Depends on | Boundaries | Acceptance | Size |
| --- | --- | --- | --- | --- |
| **15. Add validated saves and replay** | 14 | Versioned schema/rules/content/generator/RNG; explicit migrations only | Round-trip state/RNG exact; rejected corrupt/unsupported inputs; replay hashes match; no render objects in saves | L |
| **16. Deepen exploration and infrastructure** | 15 | Biomes, strategic extraction, embarkation, logistics; reassess diagonals separately | New map/rules versions documented; movement and economy edge cases tested; measured performance remains reported | L |
| **17. Deepen cities, research and society** | 15 | Districts, queue projects, research branches, policy slots, revolt/recovery | Effects and dependencies validated; unrest offers recoverable decisions; costs and outcomes legible; balance tests/playtests recorded | L |
| **18. Deepen conflict and diplomacy** | 16, 17 | Ranged/siege units, treaties/trade, AI personalities; no multiplayer commitment | AI respects legal commands/fog; combat previews remain correct; treaties resolve consistently; bounded decision time measured | L |
| **19. Expand victories and faction content** | 18 | Research/diplomatic/civic goals and new factions only after two-faction balance | Every victory has tested simultaneous-outcome rules; faction features are distinct and understandable; full-match playtests completed | L |
| **20. Harden browser release** | 19 | Accessibility, onboarding, device compatibility, delivery and dependency/terms review; no source license choice here | Keyboard and contrast checks; named-device benchmarks; loading/error/recovery flows; save compatibility policy and release checklist reviewed | L |

Later briefs describe outcomes, not authorization to expand this PR. Re-estimate and split them using measured prototype and first-playable evidence; create issues only through a separate explicit action.
