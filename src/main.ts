import './style.css'
import { generateMap, tileAt, type Tile, type WorldMap } from './game/map'
import {
  applyCommand, CITY_RULES, cityYields, createExpedition, FACTIONS, findPath, movementRange, PRODUCTION_ITEMS,
  SCOUT, visibilityAt, type Command, type Expedition, type ProductionItemId,
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

function isProductionItemId(value: string): value is ProductionItemId {
  return Object.hasOwn(PRODUCTION_ITEMS, value)
}

function updateExpeditionHud(): void {
  const state = expedition
  if (!state) { hud.expedition(); return }
  const factionId = state.activeFaction
  const scout = state.scouts.find(unit => unit.factionId === factionId)!
  const faction = state.factions.find(item => item.id === factionId)!
  hud.expedition({
    faction: FACTIONS[faction.id], round: state.round, movement: scout.movement, maxMovement: SCOUT.movement,
    discovered: Object.keys(faction.fog).length, total: state.map.tiles.length,
    scoutSelected, canOrder: scoutSelected && !!selectedTile && selectedTile.id !== scout.tileId,
  })
  const cities = state.cities.filter(city => city.factionId === factionId).map(city => {
    const yields = cityYields(state, city)
    const production = city.production
      ? { name: PRODUCTION_ITEMS[city.production.itemId].name, progress: city.production.progress,
        cost: PRODUCTION_ITEMS[city.production.itemId].cost }
      : undefined
    return { id: city.id, x: state.map.tiles[city.tileId]!.x, z: state.map.tiles[city.tileId]!.z,
      population: city.population, food: city.food, foodYield: yields.food,
      foodConsumption: city.population * CITY_RULES.foodPerPopulation,
      materials: city.materials, materialYield: yields.materials,
      production, storehouse: city.storehouse, claimCount: city.claimTileIds.length,
      units: state.units.filter(unit => unit.factionId === factionId && city.claimTileIds.includes(unit.tileId))
        .map(unit => {
          const tile = state.map.tiles[unit.tileId]!
          return `${PRODUCTION_ITEMS[unit.type].name} at (${tile.x}, ${tile.z})`
        }) }
  })
  const founder = state.founders.find(unit => unit.factionId === factionId)
  hud.cities(cities, founder ? { x: state.map.tiles[founder.tileId]!.x, z: state.map.tiles[founder.tileId]!.z } : undefined)
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
    hud.order(route ? `Destination (${tile.x}, ${tile.z}). ${visibility === 'explored' ? 'Remembered terrain. ' : ''}Route: ${route.cost} movement. Choose Move scout here.`
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
    generationMs = performance.now() - start
    const nextExpedition = expedition ? createExpedition(next) : undefined
    const renderStart = performance.now()
    renderer ??= new WorldRenderer(hud.canvas, select, hud.hover, hud.error)
    expedition = nextExpedition
    scoutSelected = false
    renderer.setMap(next)
    map = next
    hud.loaded(next)
    if (expedition) {
      renderExpedition()
      renderer.focusTile(expedition.scouts[0]!.tileId)
    }
    renderSetupMs = performance.now() - renderStart
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
hud.foundCity.addEventListener('click', () => {
  const state = expedition
  if (!state) return
  const founder = state.founders.find(unit => unit.factionId === state.activeFaction)
  if (founder) order({ type: 'found-city', factionId: state.activeFaction,
    sequence: state.commands.length + 1, founderId: founder.id })
})
hud.queueProduction.addEventListener('click', () => {
  if (!expedition) return
  const cityId = hud.selectedCityId()
  const itemId = hud.productionChoice.value
  if (!isProductionItemId(itemId)) {
    hud.order('Choose a supported production item.', true)
    return
  }
  order({ type: 'queue-production', factionId: expedition.activeFaction,
    sequence: expedition.commands.length + 1, cityId, itemId })
})
hud.cityChoice.addEventListener('change', updateExpeditionHud)
hud.productionChoice.addEventListener('change', updateExpeditionHud)
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
      founders: expedition.founders, cities: expedition.cities, units: expedition.units,
      fog: { ...expedition.factions[0]!.fog },
      reachable: [...movementRange(expedition, expedition.scouts[0]!.id).keys()],
    } : undefined,
  }
}
window.addEventListener('pagehide', event => { if (!event.persisted) renderer?.dispose() })
if (import.meta.hot) import.meta.hot.dispose(() => renderer?.dispose())
