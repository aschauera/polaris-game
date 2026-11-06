import './style.css'
import { generateMap, tileAt, type Tile, type WorldMap } from './game/map'
import {
  applyCommand, createExpedition, FACTIONS, findPath, movementRange, SCOUT, visibilityAt,
  type Command, type Expedition,
} from './game/expedition'
import { WorldRenderer } from './rendering/world'
import { createHud } from './ui/hud'

const hud = createHud()
let renderer: WorldRenderer | undefined
let map: WorldMap | undefined
let generationMs = 0
let renderSetupMs = 0
let expedition: Expedition | undefined
let selectedTile: Tile | undefined
let scoutSelected = false

function updateExpeditionHud(): void {
  if (!expedition) { hud.expedition(); return }
  const scout = expedition.scouts[0]!
  const faction = expedition.factions[0]!
  hud.expedition({
    faction: FACTIONS[faction.id], round: expedition.round, movement: scout.movement, maxMovement: SCOUT.movement,
    discovered: Object.keys(faction.fog).length, total: expedition.map.tiles.length,
    scoutSelected, canOrder: scoutSelected && !!selectedTile && selectedTile.id !== scout.tileId,
  })
}

function select(tile?: Tile): void {
  selectedTile = tile
  hud.selection(tile)
  if (!expedition) return
  const scout = expedition.scouts[0]!
  if (tile?.id === scout.tileId) scoutSelected = true
  if (tile && tile.id !== scout.tileId && scoutSelected) {
    const route = findPath(expedition, scout.id, tile.id)
    const visibility = visibilityAt(expedition, expedition.activeFaction, tile.id)
    hud.order(route ? `${visibility === 'explored' ? 'Remembered terrain. ' : ''}Route: ${route.cost} movement. Choose Move scout here.`
      : 'No affordable known route. Choose another tile or end the turn.')
  } else hud.order(scoutSelected ? 'Scout selected. Choose a charted destination or use N/E/S/W.' : 'Select the gold scout to begin.')
  updateExpeditionHud()
}

function renderExpedition(dirtyTiles?: readonly number[]): void {
  if (!expedition) { renderer?.setExploration(); updateExpeditionHud(); return }
  renderer?.setExploration({
    fog: expedition.factions[0]!.fog, scoutTileId: expedition.scouts[0]!.tileId,
    reachable: [...movementRange(expedition, expedition.scouts[0]!.id).keys()],
  }, dirtyTiles)
  updateExpeditionHud()
}

function order(command: Command): void {
  if (!expedition) return
  const result = applyCommand(expedition, command)
  if (!result.ok) { hud.order(result.reason, true); return }
  expedition = result.state
  renderExpedition(result.dirtyTiles)
  if (scoutSelected) renderer?.selectTile(expedition.scouts[0]!.tileId)
  hud.order(result.message)
}

function move(to: number): void {
  if (!expedition || !scoutSelected) return
  order({ type: 'move', factionId: expedition.activeFaction, sequence: expedition.commands.length + 1,
    unitId: expedition.scouts[0]!.id, to })
}

function regenerate(): void {
  try {
    const config = hud.config()
    const start = performance.now()
    const next = generateMap(config)
    const nextExpedition = expedition ? createExpedition(next) : undefined
    generationMs = performance.now() - start
    const renderStart = performance.now()
    renderer ??= new WorldRenderer(hud.canvas, select, hud.hover, hud.error)
    expedition = nextExpedition
    scoutSelected = false
    renderer.setMap(next)
    renderSetupMs = performance.now() - renderStart
    map = next
    hud.loaded(next)
    if (expedition) {
      renderExpedition()
      renderer.focusTile(expedition.scouts[0]!.tileId)
    }
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
hud.startExpedition.addEventListener('click', () => {
  if (!map || !renderer) return
  try {
    expedition = createExpedition(map)
    scoutSelected = false
    renderExpedition()
    renderer.focusTile(expedition.scouts[0]!.tileId)
    hud.order('Select the gold scout to begin. Sight reaches two cardinal steps.')
  } catch (error) {
    hud.error(error instanceof Error ? error.message : 'Unable to start the expedition.')
  }
})
hud.leaveExpedition.addEventListener('click', () => {
  expedition = undefined
  scoutSelected = false
  renderExpedition()
  renderer?.reset()
})
hud.selectScout.addEventListener('click', () => {
  if (!expedition) return
  renderer?.selectTile(expedition.scouts[0]!.tileId)
  renderer?.focusTile(expedition.scouts[0]!.tileId)
})
hud.moveScout.addEventListener('click', () => { if (selectedTile) move(selectedTile.id) })
hud.endTurn.addEventListener('click', () => {
  if (expedition) order({ type: 'end-turn', factionId: expedition.activeFaction, sequence: expedition.commands.length + 1 })
})
const offsets = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] } as const
for (const direction of Object.keys(offsets) as (keyof typeof offsets)[]) {
  hud.directions[direction].addEventListener('click', () => {
    if (!expedition) return
    const tile = expedition.map.tiles[expedition.scouts[0]!.tileId]!
    const [dx, dz] = offsets[direction]
    move(tileAt(expedition.map, tile.x + dx, tile.z + dz)?.id ?? -1)
  })
}

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
    expedition: () => expedition ? {
      round: expedition.round, movement: expedition.scouts[0]!.movement, scoutTileId: expedition.scouts[0]!.tileId,
      commandCount: expedition.commands.length,
      fog: { ...expedition.factions[0]!.fog },
      reachable: [...movementRange(expedition, expedition.scouts[0]!.id).keys()],
    } : undefined,
  }
}
window.addEventListener('pagehide', event => { if (!event.persisted) renderer?.dispose() })
if (import.meta.hot) import.meta.hot.dispose(() => renderer?.dispose())
