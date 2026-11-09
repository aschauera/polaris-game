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

- The board is a **pointy-top hex grid** in odd-r offset rows with six neighbours (`src/game/hex.ts`; neighbour order east, south-east, south-west, west, north-west, north-east). Canonical tile IDs stay `z * width + x`. Rules and generator are **version 3**.
- Gameplay is deterministic ([ADR-002](../docs/architecture.md#adr-002-deterministic-domain)): integer arithmetic, explicit PRNG state, stable order. A change that alters generated maps or rule outcomes bumps the generator version or `RULES_VERSION`; messenger turns of another version are rejected with a reason.
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

- **Hex fields of cubic voxels.** Land hexes stack soil, dirt or rock cliffs, a grass, sand or rock top, and terraced mounds for hills. Water hexes form a blue voxel volume, not an earth slab with a blue cap. No hexagonal voxels, smooth meshes, textures or imported models.
- **A calm, readable board**, as in *Into the Breach*: few elements per hex, and small trees on the back row, so the centre stays free for a unit. Terrain identity must not rely on colour alone. The plain hex grid stays subtle: faint on open water and fading when zoomed out, while selection, reachable outline and territory border keep full strength.
- **Voxel water and readable coasts.** Preserve visible square water-cell faces and blue volume sides; depth colours alone must not replace the voxel structure. Cell tones and directional edge shading follow the same cubic lattice as the terrain and fade when subpixel. Keep the surface level and the large hex grid secondary. A bright shallow rim, turquoise shoal, blue shelf and deeper open-water tint derive from charted land only, never hidden coasts.
- **Clear territory**, as in *Polytopia*: a faction-coloured border band on the inner edge of each territory, and a name plate with the population above each visible city. Selection is a gold hex outline; hexes reachable this turn get their own outline. Keep the three distinct.
- **Chunky voxel figures**, as in *Voxel Tactics*: units are small voxel figures in faction colours, standing on their hex. No sprites or billboards.
- Learn from these games' design; never copy their art, names or assets.
- **Palette.** The world uses the bright diorama palette `VOXEL` in `src/rendering/voxels.ts`: green grass, blue water, sandy coasts, brown soil and cliffs. The Art Deco navy, teal, gold and ivory palette is for the HUD and UI; gold also marks focus and city plates.
- **Fog.** Uncharted hexes are opaque and uniform and hide terrain, trees, figures, picks and tooltips. Remembered hexes are dimmed; visible hexes are bright.
- **Camera.** Fixed orthographic camera, yaw 60°, pitch 42°, no rotation. Hexes appear flat-topped on screen, and the six directions map to ↖ ↑ ↗ ↙ ↓ ↘.
- **Performance.** Terrain is meshed in chunks, never one mesh per hex. Explored dimming, ranges and borders update through state textures; newly charted terrain remeshes affected chunks, including the full coastal-band reach. Rendering is on demand: code in `src/rendering/world.ts` that changes the scene calls `invalidate()`, and nothing renders every frame without need. Stay within the vertex budgets the unit tests enforce.
- Deferred concept elements (resource icons, rivers and bridges, danger markers, palms, fields and harbours) are listed in the [roadmap](../docs/roadmap.md); add them through their own issues.

## Visual review delivery

Whenever visual changes are requested, implement them first, then capture fresh screenshots or other suitable visuals from the updated, running application for human inspection. Deliver these in a separate **Visual overview**, distinct from the implementation summary, with directly viewable visuals or links. Show the actual implemented result, not the reference image, a mockup, or stale screenshots. If fresh visuals cannot be captured, explicitly state the limitation and its cause.
