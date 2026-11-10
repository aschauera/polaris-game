# Copilot instructions

These rules apply to every Copilot agent and contributor working on Polaris, so that the agents of @aschauera and @KlausThyri build the same game. The documentation holds the details: [game design](../docs/game-design.md), [architecture](../docs/architecture.md), [roadmap](../docs/roadmap.md) and the [README](../README.md). This file and the documentation must never contradict each other.

## Working order: issues, blocked-by and stacked PRs

- Work starts from a GitHub issue. Before picking one, check its **Relationships** in the sidebar: start only issues whose *blocked by* issues are all closed, and do not implement a blocked issue early as part of another change.
- GitHub allows *blocked by* relationships only between issues, not between pull requests. So every PR closes its own issue (`Closes #N` in the description), and the issues carry the order. When new work builds on unmerged work, create an issue for it and mark it blocked by the issue of that work: sidebar → Relationships → *Mark as blocked by*, or `gh api -X POST repos/aschauera/polaris-game/issues/<N>/dependencies/blocked_by -F issue_id=<database id of the blocker>`.
- A PR that builds on another unmerged PR is **stacked**: its base is that PR's branch, and its description states the merge order. Merge in *blocked by* order. When a base PR merges and its branch is deleted, GitHub retargets the next PR to `main`. Closing keywords only take effect for PRs that target `main`, so check that the issue closed after the merge.
- Issue texts can be older than the current contracts. Briefs 8–14 (#9–#15), for example, were written for the square grid and generator 2. Where an issue contradicts the documentation or this file, the documentation and this file win; correct or annotate the issue when you notice.

## Keep docs and agent guidance in sync

- A PR that changes rules, visuals, architecture, workflow or deployment updates the affected documentation **and** this file in the same PR. A decision that lives only in a chat, a PR comment or one person's local instructions is not binding for the other agent: write it down here or in the docs.
- Before finishing, search this file, the README and `docs/` for statements your change makes stale: grid shape, rules and generator versions, references, palette, controls, test counts and captures. Fix them in the same PR.
- Record each decision with its reason where it belongs: architecture ADRs for technical decisions, game design for rules and visuals, roadmap for scope and order, README for setup, controls and verified evidence.

## Game and multiplayer decisions

- The board is a **pointy-top hex grid** in odd-r offset rows with six neighbours (`src/game/hex.ts`; neighbour order east, south-east, south-west, west, north-west, north-east). Canonical tile IDs stay `z * width + x`. Rules remain **version 3**; the generator is **version 4**.
- Gameplay is deterministic ([ADR-002](../docs/architecture.md#adr-002-deterministic-domain)): integer arithmetic, explicit PRNG state, stable order. A change that alters generated maps or rule outcomes bumps the generator version or `RULES_VERSION`; messenger turns of another version are rejected with a reason.
- Generator-v4 bays are real, ocean-connected water, not cosmetic holes in land. Keep broad separated landmasses, warped shores and deep curved inlets on sufficiently large forms. Never silently reinterpret older-generator matches: retain their stored records, clear only their auto-resume pointer and explain the incompatibility.
- Authoritative rules live in `src/game`, without DOM or Babylon. Rendering and UI consume snapshots and submit commands; they never resolve rules.
- Multiplayer is **play by messenger** ([ADR-005](../docs/architecture.md#adr-005-serverless-play-by-messenger)): players exchange turn links, codes or files, and each copy replays the command log. The server-authoritative online variant (#17, #23) was discarded. Do not add a server, relay or WebRTC without a new decision recorded in the architecture.

## Validation

Run `npm run typecheck`, `npm run lint`, `npm run test:unit` and `npm run test:e2e` before handing over; CI runs them on every push and pull request. Report the actual results and any limitations in the PR.

## Azure deployment

Deploy Polaris as an **Azure Container App**, not a static website or App Service.
Local setup provisions or reuses Azure resources; the Container App is configured
for built-in GitHub continuous deployment. Azure generates the GitHub Actions
workflow and secrets; the Azure-generated workflow is maintained in this repo.
GitHub builds the root Dockerfile and deploys **only when a GitHub release is
published**, after validating its tagged commit. Pushes, tag pushes, drafts and
manual dispatches must not deploy. Do not replace this with local image builds
or another deployment workflow. Keep the release workflow on the default branch;
Azure setup regenerates push triggers, so do not rerun bootstrap setup against a
release-managed app.

Keep both Azure setup scripts interactive by default: list existing resources
at each resource-selection step and include a **(new)** option. Preserve explicit
parameters, `-NonInteractive`, and side-effect-free `-WhatIf` for automation.
Subscriptions are an existing-account prerequisite, not resources these scripts
create. See [deployment documentation](../README.md#docker-and-azure-container-apps)
and run `pwsh -File .\scripts\azure-setup.tests.ps1` after script changes.

## Visual references

Two images are authoritative, each for its own scope. Inspect both before planning or implementing visual or world changes.

| Reference | Authoritative for |
| --- | --- |
| [`docs/concept-hex-voxel.jpg`](../docs/concept-hex-voxel.jpg), the approved hex voxel concept | The look of the board: hex fields built from cubic voxels, diorama sides, palette, calm terrain with a few small trees, voxel unit figures, territory borders and city name plates |
| [`docs/showcase.png`](../docs/showcase.png) | The world: landforms (broad irregular continents, coasts, stepped highlands), composition and map scale |

`docs/visual-mockup.svg`, `docs/voxel map visual reference image.jpg`, the games that inspired the concept and all other images are supplementary and must not override these two. Do not replace or regenerate either reference to match an implementation. Changing a reference, or departing from it or from the graphics rules below, requires explicit approval by both maintainers in the PR that makes the change, and that PR updates this section.

## Graphics rules for the hex voxel world

Details and numbers are in [ADR-004](../docs/architecture.md#adr-004-map-and-rendering) and the [visual direction](../docs/game-design.md#visual-and-interaction-direction). Binding rules:

- **Hex fields of cubic voxels.** Land hexes stack soil, dirt or rock cliffs and a grass, sand or rock top. Hills form low connected elevation terraces, never a separate grassy cone or tall pillar on every hex. Keep the four detailed land levels at 0.625, 0.75, 0.875 and 1 world units; coarse voxels may merge levels instead of exaggerating heights. Water hexes contain a stepped voxel seabed under a level translucent surface, with blue diorama cut walls. No hexagonal voxels, smoothed terrain, decorative image textures or imported models.
- **Voxel density.** Use 16 voxels across a hex when both map dimensions are at most 32, then 8 up to 64, 4 up to 128 and 2 above. The fine showcase has roughly four times the surface cells of the former 8-voxel view. Scale trees, settlement stamps, hill height and coast width in world units rather than shrinking them with the voxel size; keep decoration counts sparse. All three measured fixtures retain a 900k vertex ceiling.
- **A calm, readable board**, as in *Into the Breach*: few elements per hex, and smaller trees on the back row, so the centre stays free for a unit. Detailed trees are at most 0.75 world units high with narrower crowns; simplify them at coarse scales without clipping settlements. Terrain identity must not rely on colour alone. Both land and water caps use visible, crisp screen-space hex hairlines that fade when zoomed out; the earlier open-water suppression is superseded. Preserve pixel-aware edge coverage, not broad blurry strokes; selection, reachable outline and territory border stay distinct and readable.
- **Voxel water and readable coasts.** Build four broad underwater terraces and sparse seeded coastal rock groups, both fully submerged and emerging through shallow water. Keep their world-space depths independent of fine voxel density; do not restore ten or more microsteps. Use compact, irregular voxel lobes, not tall thin pillars; exposed grey rock displaces the cap in its footprint and participates in actual-height picking while remaining a water tile. A flat plane with square shading or colour bands is not a substitute. Warp charted-land distance with broad and fine noise so the shoal, shelf and seabed break into irregular coves instead of concentric rings; show pale sand in the shallows, muted stone at the shelf and deep blue farther out. Never use hidden coasts. Draw water hexes only on the level cap, not on submerged floors; range and territory overlays remain land-only. Classify every seabed palette kind as water floor and keep terrain/water shader-cache variants distinct. Share chunk geometry between opaque and transparent submeshes; no per-cube meshes, refraction or continuous wave animation. See ADR-004 for exact heights and coarse-scale merging.
- **Irregular sandbanks.** Lower broad sandy pockets inside existing land hexes so they occupy areas and physically interrupt cliffs; never substitute a painted narrow rim. Vary their width, retaining intact cliffs between them. Only charted water can shape a bank. Keep whole trunk footprints on their charted tile and off sand, use sparse stones rather than tufts, and preserve level settlements and dry land-resource sites. Meshing, picking, figures and marker positioning share actual ground heights; refresh markers after coastal remeshing. Banks do not change domain terrain/elevation, land/water identity or movement. See ADR-004 for heights and coarse-scale omission.
- **Visual resources, not new rules.** Stone deposits, apple groves and fish shoals share a seeded presentation classifier for geometry, original projected SVG annotations and inspection names. Stone deposits are broad irregular grey blocks with different flat cap heights, chipped shoulders and occasional rubble, not repeated narrow towers; keep the tile centre clear for units. No `Tile` mutation, simulation RNG, harvesting, yields or movement change. Only charted occurrences may be exposed; remembered ones are dimmed and settlements suppress them. Use the existing projected label layer, with camera-bounded candidates, at most 128 visible resource nodes, overview culling and cleanup on regeneration/disposal; no extra per-resource WebGL objects. The inspector must state that harvesting is not available.
- **Shaded surfaces, not flat fills.** Calm water does not mean uniform colour: use deterministic light/dark material patches on the water cap and grass, sand and rock tops. Keep tones anchored to world voxel coordinates across hexes and chunks, with five shade levels, broader 2-by-2-voxel water cells and one-voxel ground cells. Fade fine contrast when zoomed out and soften it at the shoreline. These shades supplement real underwater geometry; they never replace it. Keep fog uniform, decorations unchanged and gameplay overlays readable; no extra image textures, geometry or animation.
- **Clear territory**, as in *Polytopia*: a faction-coloured border band on the inner edge of each territory, and a name plate with the population above each visible city. Selection is a gold hex outline; hexes reachable this turn get their own outline. Keep the three distinct.
- **Chunky voxel figures**, as in *Voxel Tactics*: units are small voxel figures in faction colours, standing on their hex. No sprites or billboards.
- Learn from these games' design; never copy their art, names or assets.
- **Palette.** The world uses `VOXEL` in `src/rendering/voxels.ts`: reference yellow-green grass, cyan shallows, saturated deep blue, pale sand, warm earth, grey stone, forest/olive foliage and terracotta roofs. Calibrate actual framebuffer colours after shading/blending, not raw hex values; preserve the reference-median and thin-grid regressions in `tests/atlas.spec.ts`. Shallow/shoal/shelf/deep cap colours share one transparent material and derive only from charted coasts; never replace the real underwater relief with colour bands. The Art Deco navy, teal, gold and ivory palette is for the HUD and UI; gold also marks focus and city plates.
- **Fog.** Uncharted hexes are opaque and uniform and hide terrain, trees, resources, figures, picks and tooltips. Remembered hexes are dimmed; visible hexes are bright.
- **Camera.** Fixed orthographic camera, yaw 45°, pitch `atan(1/sqrt(2))` (about 35.264°), no rotation: cube axes project symmetrically at 30°, matching the concept's isometric reading. This is a geometric calibration, not recovered camera metadata from the illustration. Keep camera, screen-aligned tree placement, figure facing and picking tests on the shared basis in `src/rendering/view.ts`. Movement buttons retain their six relative screen directions; hex edges are no longer forced vertical/horizontal on screen.
- **Performance.** Terrain is meshed in chunks, never one mesh per hex. Explored dimming, ranges and borders update through state textures; newly charted terrain remeshes affected chunks, including the full coastal-band reach and trees dependent on a changing sandbank. Rendering is on demand: code in `src/rendering/world.ts` that changes the scene calls `invalidate()`, and nothing renders every frame without need. Stay within the vertex budgets the unit tests enforce.
- Deferred concept elements (resource harvesting and further kinds, rivers and bridges, danger markers, palms, fields and harbours) are listed in the [roadmap](../docs/roadmap.md); add them through their own issues.

## Visual review delivery

Whenever visual changes are requested, implement them first, then capture fresh screenshots or other suitable visuals from the updated, running application for human inspection. Deliver these in a separate **Visual overview**, distinct from the implementation summary, with directly viewable visuals or links. Show the actual implemented result, not the reference image, a mockup, or stale screenshots. If fresh visuals cannot be captured, explicitly state the limitation and its cause.
