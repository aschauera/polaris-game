import './style.css'
import { generateMap, type WorldMap } from './game/map'
import { WorldRenderer } from './rendering/world'
import { createHud } from './ui/hud'

const hud = createHud()
let renderer: WorldRenderer | undefined
let map: WorldMap | undefined
let generationMs = 0
let renderSetupMs = 0

function regenerate(): void {
  try {
    const config = hud.config()
    const start = performance.now()
    const next = generateMap(config)
    generationMs = performance.now() - start
    const renderStart = performance.now()
    renderer ??= new WorldRenderer(hud.canvas, hud.selection, hud.hover, hud.error)
    renderer.setMap(next)
    renderSetupMs = performance.now() - renderStart
    map = next
    hud.loaded(next)
  } catch (error) {
    hud.error(error instanceof Error ? error.message : 'Unable to generate or render the atlas.')
  }
}

hud.form.addEventListener('submit', event => { event.preventDefault(); regenerate() })
hud.reset.addEventListener('click', () => renderer?.reset())
hud.zoomIn.addEventListener('click', () => renderer?.zoom(0.85))
hud.zoomOut.addEventListener('click', () => renderer?.zoom(1.15))
hud.fixture.addEventListener('click', () => { hud.dimensions(256); regenerate() })
hud.showcase.addEventListener('click', () => { hud.dimensions(32); regenerate() })

const params = new URLSearchParams(location.search)
hud.inputs.seed.value = params.get('seed') ?? 'polaris'
hud.inputs.width.value = params.get('width') ?? '32'
hud.inputs.height.value = params.get('height') ?? '32'
regenerate()

// Opt-in, read-only diagnostics work in production benchmarks without exposing state mutation.
if (params.get('diagnostics') === '1') {
  window.polarisDiagnostics = {
    stats: () => ({ ...renderer?.stats(), generationMs, renderSetupMs, seed: map?.seed,
      width: map?.width, height: map?.height, rngState: map?.rngState }),
    projectTile: id => renderer?.projectTile(id),
    camera: () => renderer?.cameraState(),
  }
}
window.addEventListener('pagehide', event => { if (!event.persisted) renderer?.dispose() })
if (import.meta.hot) import.meta.hot.dispose(() => renderer?.dispose())
