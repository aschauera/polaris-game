# Polaris · World Atlas

An original voxel-isometric strategy **foundation**, not a playable 4X game. This PR implements only a deterministic map, chunked WebGL 2 rendering, an orthographic camera, picking, and a small Art Deco HUD.

![Polaris procedural showcase, captured from the running app](docs/showcase.png)

## Plan and visual direction

- [Game design and planned first playable](docs/game-design.md)
- [Architecture decisions, determinism, and performance targets](docs/architecture.md)
- [Dependency-ordered follow-up briefs](docs/roadmap.md)
- [Initial original visual mockup](docs/visual-mockup.svg) — a direction-setting concept, not a rendered screenshot.

**Recommended next task:** roadmap brief 6, deterministic commands/turns, movement, exploration, and fog. Cities, combat, research, policies, diplomacy, and opponent AI are deliberately deferred. No follow-up issues are automatically created.

## Requirements and setup

- **Node.js 24 LTS**, npm 11 (Node 24's bundled npm); other Node majors are not supported by this foundation.
- Desktop-class current Chromium or Microsoft Edge with **WebGL 2** enabled. Windows is the initial target; this PR's automated evidence is Linux Chromium, not a claim of Windows hardware validation.
- No editor, account, backend, GPU-equipped workstation, runtime CDN, or asset-authoring tool is required.

On Windows, install Node 24, open PowerShell in this checkout, then:

```powershell
npm ci
npm run dev
```

Open the local URL printed by Vite. Run the same commands in a Linux/macOS shell. For a production build:

```powershell
npm run build
npm run preview
```

Deploy `dist/` to a static web host. Run through an HTTP server, not by opening `index.html` from disk. For subdirectory hosting, build with Vite's `--base` option.

## Commands and CI

| Command | Purpose |
| --- | --- |
| `npm ci` | Reproduce the committed dependency tree |
| `npm run dev` | Vite development server |
| `npm run typecheck` | Strict TypeScript checks, including tests/configuration |
| `npm run lint` | ESLint |
| `npm run test:unit` | Vitest, Node-only domain tests; no DOM/Babylon |
| `npm run test:e2e` | Playwright Chromium against a managed production build/server |
| `npm run build` | Type-check and build static production output |
| `npm run preview` | Serve the production output locally |

Before the first browser-test run:

```powershell
npx playwright install chromium
```

Linux CI uses `npx playwright install --with-deps chromium`. `.github/workflows/validate.yml` installs Node 24, runs `npm ci`, type-check, lint, unit tests, browser install, browser tests, and build. No manually started server is needed; stop a server already occupying port 4173 before browser tests.

Headless tests explicitly use Chromium ANGLE **SwiftShader** via `--use-angle=swiftshader --enable-unsafe-swiftshader`. The latter opts into local software WebGL for testing; it is not an app requirement or a rendering bypass. Tests require actual WebGL 2, inspect nonuniform framebuffer pixels, check tile picks, and fail on **every unexpected console error or page error**. GPU performance warnings are not suppressed. Hardware-sensitive FPS is not a CI gate.

## Map inputs and controls

- Seed: **1–64 ASCII letters, digits, `_`, or `-`**; case-sensitive.
- Width and height: independent integers **8–256**. Defaults: `polaris`, 32 × 32.
- **Regenerate atlas** repeats exactly the same map for the same inputs and resets camera/selection.
- **256² fixture** loads 65,536 tiles using the current seed; **32² showcase** returns to the small fixture.
- Deep link: `/?seed=polaris&width=256&height=256` (append to the local server URL).
- Click a visible tile to select; hover to inspect. Coordinates are zero-based `(x, z)`; canonical ID is `z * width + x`.
- Left-drag to pan; movement over 5 CSS pixels is a drag, not a selection. Scroll to zoom. Buttons provide zoom/reset.
- With the canvas focused: arrows pan, `+`/`-` zoom, `R` resets. Orientation is fixed; there is no rotation.
- HUD inputs/buttons do not send camera events. Pan target is bounded to map tile centers; zoom is bounded between inspection and whole-map fit. Resize preserves relative zoom.

Generator 2 builds broad, irregular landforms before adding local coast variation, elevation steps and clustered trees. Grassland is a green low plateau, water a blue shelf, and hills a taller sand-colored block; elevation is shown by connected stepped silhouettes, with low-poly canopy clusters for scale. Terrain and tree shapes are original procedural placeholders, not actual volumetric/destructible terrain. Selection/hover outlines are renderer-only data. Invalid inputs leave the prior valid map intact and show an explicit error. Missing WebGL 2 or context loss shows an error rather than a fake successful scene; reload after context loss.

## Validation and benchmark evidence

The automated suite checks complete-map deterministic fingerprints for four seeds, continent separation and stepped elevation, dimensions/bounds and invalid inputs, real rendering/picking after pan/zoom/resize, HUD isolation, regeneration, and unavailable WebGL 2. Structural browser checks prove **16 meshes / 7 materials / 16 geometries** for 32² and **772 / 7 / 772** for 256²: one source per populated 16 × 16 chunk/terrain batch, two map-wide tree meshes and two markers, not one object per tile.

Three successive regenerations of **each** size retain those counts. The disposal counter confirms 36 showcase or 2,304 stress source meshes disposed, respectively. Matrix buffers are 64 KiB / 4 MiB. Materials persist across regenerations; full teardown disposes scene/engine, buffers, instrumentation, and listeners. Stable resource counts demonstrate bounded scene resources, **not** a proof of absence of every browser/driver memory leak.

Local validation: clean `npm ci`, type-check, lint, **19 unit tests**, **5 browser tests**, and production build pass. GitHub's initial validation runs reported `action_required` with zero jobs; repository approval is required before hosted CI evidence is available. Local results are not presented as a completed hosted CI run.

Measured results and reproduction details are recorded below. Architecture budgets are provisional targets, not acceptance claims for arbitrary hardware.

### Measured runner sample · 2026-11-05

[Raw measurements, including all 120 frame intervals per fixture](docs/benchmark.json). Production build at commit `2ab5ae7`; seed `polaris`, generator 1, Chromium **156.0.8078.4**, Linux **7.0.0-1017-azure**, Intel Xeon Platinum 8573C, 4 logical CPUs, 15.61 GiB RAM. Headless ANGLE/Vulkan **SwiftShader (Subzero)**, 1440 × 900 viewport, DPR 1; no physical GPU or controlled power profile. Another software-rendered browser was active during part of this sample, so CPU contention is a confounder.

| Actual measurement | 32 × 32 | 256 × 256 |
| --- | ---: | ---: |
| First generation / scene setup, ms | 1.1 / 111.4 | 9.8 / 375.9 |
| Five regenerations: generation median / max, ms | 0.3 / 2.5 | 11.4 / 12.1 |
| Five regenerations: scene setup median / max, ms | 11.3 / 13.4 | 355.1 / 3,186.0 |
| Idle frame intervals p50 / p95 / max, ms | 100 / 116.7 / 200 | 1,516.6 / 2,966.6 / 3,499.8 |
| 120-frame sample duration, seconds | 11.75 | 183.98 |
| Whole-map draw calls, markers hidden | 12 | 768 |
| Draw calls after four zoom/pan steps | 12 | 675 |
| Used JS heap snapshot, MiB | 27.21 | 41.87 |
| Estimated terrain vertex/index + matrix buffers, MiB | 0.072 | 4.615 |

**Method:** open each fixture with `?diagnostics=1`, wait two animation frames, record first timings; regenerate five times; warm up ten frames, then record 120 consecutive `requestAnimationFrame` timestamp differences. Percentiles use sorted sample indices 60 and 114 (approximate p50/p95); do not substitute Babylon's CPU-only `frameMs` for wall-clock frame intervals. Then perform four zoom-in/alternating-arrow-pan steps and sample draw calls/heap. Functional picks and three-regeneration disposal checks run separately in the browser suite. No unexpected console/page errors occurred in the benchmark.

Generation timing surrounds only pure `generateMap`; scene setup surrounds renderer construction/rebuilding and **does not measure first GPU presentation or time-to-interactive**. Heap is Chromium's `performance.memory.usedJSHeapSize` with `--enable-precise-memory-info`, a whole-page snapshot, not map-attributable memory or a forced-GC leak measurement. Buffer estimate is `matrix bytes + batch count × (24 vertices × 8 floats × 4 bytes + 36 indices × 2 bytes)`; it excludes driver copies, framebuffer, markers, JS objects, and allocator overhead. This is a lower-bound allocation estimate, not measured VRAM.

**Result and gap:** generation and structural batching work, but software-rendered frame pacing is poor, especially at 256². The fixture accepts pan/zoom/selection but is **not smoothly interactive on this runner**. The provisional frame targets are not met here; neither native GPU performance nor the full architecture benchmark protocol has been established. Follow up with an isolated Windows Chromium/Edge GPU benchmark, then profile vertex/draw cost and assess an overview LOD or chunk-size adjustment before expanding map sizes. A software-renderer result alone does not justify replacing Babylon with another engine.

**Reproduce:** run the validation commands above; then `npm run build` and `npm run preview`. Open either fixture with `&diagnostics=1`. Read-only `window.polarisDiagnostics.stats()`, `.camera()`, and `.projectTile(id)` expose timing/resource/picking diagnostics only when explicitly requested. For the frame sample, run in the browser console after warming up:

```js
const samples = [];
let last = await new Promise(requestAnimationFrame);
for (let i = 0; i < 120; i++) {
  const now = await new Promise(requestAnimationFrame);
  samples.push(now - last);
  last = now;
}
console.log({ samples, stats: window.polarisDiagnostics.stats() });
```

For CI-equivalent software measurements, use the Chromium flags documented above; add `--enable-precise-memory-info` only for heap reporting. Repeat on isolated hardware and report environment changes rather than comparing absolute times without context.

## Known limitations

- No units, turns, cities, resources, economy, combat, research, policies, fog, diplomacy, AI, save/load, multiplayer, physics, or external services.
- Only Chromium is automated. Windows Edge hardware, Firefox/Safari, long-duration profiling, touch/mobile UX, assistive-technology map navigation, and WebGPU are unvalidated/deferred.
- Continents and tree clusters are seeded procedural shapes, not a climate or hydrology simulation; rivers, bridges and settlements are not yet represented. At full stress-map zoom tiles are intentionally tiny; zoom in to inspect them.
- Thin-instance picking and scene upload remain synchronous; large-map interactions must be profiled before promising larger maps. The 256² fixture is not a finished-game performance promise.
- The recorded SwiftShader 256² frame intervals are seconds, not a smooth-play claim; native GPU validation and focused rendering profiling remain open.
- Babylon's initial bundle is substantial; Vite reports a chunk-size advisory. It is not a build failure. Loading/code-splitting optimization is deferred until measured.

## Dependencies, assets, and licensing

Runtime: Babylon.js (`@babylonjs/core`, Apache-2.0). Tooling: Vite, Vitest, ESLint, typescript-eslint and Node type definitions (MIT); TypeScript and Playwright (Apache-2.0). Exact package versions and transitive license metadata are in `package-lock.json`; full notices/licenses are included in installed packages and must be retained as required when distributing dependencies.

The minimatch override pins a patched release for the lint toolchain's transitive denial-of-service advisory, GHSA-g3hv-75wg-m249. Re-evaluate the override with future lint-tool upgrades; do not silently restore the vulnerable resolution.

All map geometry, CSS, SVG concept art, favicon, and screenshot are original procedural/code-created placeholders. No reference-game code, names, maps, text, music, art, paid assets, generated artwork, or remote fonts are used. System fonts only. Blockbench (cuboid models) and Blender (cleanup/glTF pipeline) are optional future authoring tools, never setup dependencies. No inspector is bundled; use browser developer tools now and verify a development-only inspector integration in a later task.

**No license is selected for Polaris's own source or assets.** That decision belongs to the repository owner; dependency licenses do not license this game.
