import './style.css'
import { generateMap, tileAt, type Tile, type WorldMap } from './game/map'
import {
  applyCommand, CITY_RULES, cityYields, createExpedition, FACTIONS, findPath, movementRange, PRODUCTION_ITEMS,
  SCOUT, visibilityAt, type Command, type Expedition, type FactionId, type ProductionItemId,
} from './game/expedition'
import { compactCommand, exportMatch, MATCH_FACTIONS, receiveTurn, stateHash } from './game/match'
import { decodeTurn, encodeTurn, linkedTurn, turnLink } from './exchange/turn-code'
import { clearMatch, restoreMatch, saveMatch } from './exchange/match-storage'
import { WorldRenderer } from './rendering/world'
import { createHud } from './ui/hud'
import { createMessengerPanel } from './ui/messenger'

const hud = createHud()
const messenger = createMessengerPanel(hud.messenger, {
  start: () => startMatch(),
  open: text => { void receive(text) },
  openFile: file => { void openFile(file) },
  leave: () => leaveMatch(),
})
let renderer: WorldRenderer | undefined
let map: WorldMap | undefined
let generationMs = 0
let renderSetupMs = 0
let expedition: Expedition | undefined
let selectedTile: Tile | undefined
let scoutSelected = false
// The local side of a messenger match. A solo expedition has none and simply plays whichever faction is active.
let match: { readonly id: string; readonly faction: FactionId } | undefined
let outboxToken = 0

const viewerOf = (state: Expedition): FactionId => match?.faction ?? state.activeFaction
const scoutOf = (state: Expedition) => state.scouts.find(unit => unit.factionId === viewerOf(state))!
const canAct = (state: Expedition) => !match || state.activeFaction === match.faction
const turnsEnded = (state: Expedition) => state.commands.filter(command => command.type === 'end-turn').length

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    // Merely reading the property throws when the browser blocks storage.
    return undefined
  }
}

function isProductionItemId(value: string): value is ProductionItemId {
  return Object.hasOwn(PRODUCTION_ITEMS, value)
}

function updateExpeditionHud(): void {
  const state = expedition
  if (!state) { hud.expedition(); return }
  const factionId = viewerOf(state)
  const acting = canAct(state)
  const scout = scoutOf(state)
  const faction = state.factions.find(item => item.id === factionId)!
  hud.expedition({
    faction: FACTIONS[state.activeFaction], round: state.round, movement: scout.movement, maxMovement: SCOUT.movement,
    discovered: Object.keys(faction.fog).length, total: state.map.tiles.length,
    scoutSelected, canOrder: acting && scoutSelected && !!selectedTile && selectedTile.id !== scout.tileId,
    canAct: acting, inMatch: !!match, status: match ? (acting ? 'your turn' : 'opponent\'s turn') : undefined,
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
  hud.cities(cities, founder ? { x: state.map.tiles[founder.tileId]!.x, z: state.map.tiles[founder.tileId]!.z } : undefined, acting)
}

function select(tile?: Tile): void {
  selectedTile = tile
  hud.selection(tile)
  const state = expedition
  if (!state) return
  const scout = scoutOf(state)
  if (tile?.id === scout.tileId) scoutSelected = true
  if (!canAct(state)) {
    hud.order(`Waiting for ${FACTIONS[state.activeFaction]}. Open their turn from your messenger to continue.`)
  } else if (tile && tile.id !== scout.tileId && scoutSelected) {
    const route = findPath(state, scout.id, tile.id)
    const visibility = visibilityAt(state, viewerOf(state), tile.id)
    hud.order(route ? `Destination (${tile.x}, ${tile.z}). ${visibility === 'explored' ? 'Remembered terrain. ' : ''}Route: ${route.cost} movement. Choose Move scout here.`
      : 'No affordable known route. Choose another tile or end the turn.')
  } else hud.order(scoutSelected ? 'Scout selected. Choose a charted destination or use N/E/S/W.' : 'Select the gold scout to begin.')
  updateExpeditionHud()
}

function renderExpedition(dirtyTiles?: readonly number[]): void {
  const state = expedition
  if (!state) { renderer?.setExploration(); updateExpeditionHud(); return }
  const scout = scoutOf(state)
  renderer?.setExploration({
    fog: state.factions.find(item => item.id === viewerOf(state))!.fog, scoutTileId: scout.tileId,
    // Only the active faction can move, so this stays empty while the opponent is on turn.
    reachable: [...movementRange(state, scout.id).keys()],
  }, dirtyTiles)
  updateExpeditionHud()
}

function persist(): void {
  const storage = browserStorage()
  if (storage && match && expedition) saveMatch(storage, { faction: match.faction, match: exportMatch(match.id, expedition) })
}

function order(command: Command): void {
  const state = expedition
  if (!state) return
  if (!canAct(state)) {
    hud.order(`It is ${FACTIONS[state.activeFaction]}'s turn. Open their turn from your messenger first.`, true)
    return
  }
  const result = applyCommand(state, command)
  if (!result.ok) { hud.order(result.reason, true); return }
  expedition = result.state
  renderExpedition(result.dirtyTiles)
  if (scoutSelected) renderer?.selectTile(scoutOf(result.state).tileId)
  hud.order(result.message)
  if (!match) return
  persist()
  if (command.type === 'end-turn') {
    hud.order(`Your turn is complete. Send it to ${FACTIONS[result.state.activeFaction]} and wait for their reply.`)
    syncMessenger()
    messenger.notice('')
    messenger.reveal()
  }
}

function move(to: number): void {
  const state = expedition
  if (!state || !scoutSelected) return
  order({ type: 'move', factionId: viewerOf(state), sequence: state.commands.length + 1, unitId: scoutOf(state).id, to })
}

const MAX_TURN_FILE_BYTES = 2_000_000
const MAX_REFILL_CHARS = 20_000

function syncForm(world: WorldMap): void {
  hud.inputs.seed.value = world.seed
  hud.inputs.width.value = String(world.width)
  hud.inputs.height.value = String(world.height)
}

function show(next: WorldMap, session?: Expedition): void {
  try {
    const renderStart = performance.now()
    renderer ??= new WorldRenderer(hud.canvas, select, hud.hover, hud.error)
    expedition = session
    scoutSelected = false
    renderer.setMap(next)
    map = next
    hud.loaded(next)
    if (session) {
      renderExpedition()
      renderer.focusTile(scoutOf(session).tileId)
    }
    syncMessenger()
    renderSetupMs = performance.now() - renderStart
  } catch (error) {
    hud.error(error instanceof Error ? error.message : 'Unable to generate or render the atlas.')
  }
}

function regenerate(): void {
  if (match) return
  try {
    const config = hud.config()
    const start = performance.now()
    const next = generateMap(config)
    generationMs = performance.now() - start
    show(next, expedition ? createExpedition(next) : undefined)
  } catch (error) {
    hud.error(error instanceof Error ? error.message : 'Unable to generate or render the atlas.')
  }
}

// Enters an expedition on the map that is already on screen.
function begin(state: Expedition): void {
  expedition = state
  scoutSelected = false
  renderExpedition()
  renderer?.focusTile(scoutOf(state).tileId)
  syncMessenger()
}

function syncMessenger(): void {
  const token = ++outboxToken
  const state = expedition
  if (!state) { messenger.idle(!!map); return }
  if (!match) { messenger.hide(); return }
  const own = FACTIONS[match.faction]
  const waiting = !canAct(state)
  const view = {
    status: waiting ? `You play ${own}. Waiting for ${FACTIONS[state.activeFaction]}.` : `You play ${own}. It's your turn.`,
    waiting,
  }
  messenger.match(view)
  if (!waiting) return
  // Packing compresses the whole history, so the share buttons stay disabled until it is done.
  void encodeTurn(exportMatch(match.id, state)).then(
    code => {
      if (token !== outboxToken) return
      messenger.match({ ...view, outbox: { code, link: turnLink(code, location), fileName: `polaris-turn-${turnsEnded(state)}.txt` } })
    },
    () => {
      if (token === outboxToken) messenger.notice('Your turn could not be packed for sending. Reload the page and try again.', true)
    },
  )
}

// Hex keeps the identifier URL-safe, and getRandomValues also works on plain http addresses on a local network.
function newMatchId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, '0')).join('')
}

function startMatch(): void {
  if (!map || !renderer || match) return
  try {
    match = { id: newMatchId(), faction: MATCH_FACTIONS[0]! }
    syncForm(map)
    hud.worldLocked(true)
    begin(createExpedition(map, MATCH_FACTIONS))
    persist()
    hud.order('Match started. Play your turn, then choose End turn and send it to your opponent.')
    messenger.notice('')
  } catch (error) {
    match = undefined
    hud.worldLocked(false)
    hud.error(error instanceof Error ? error.message : 'Unable to start the match.')
  }
}

function leaveMatch(): void {
  if (!match) return
  match = undefined
  outboxToken++
  const storage = browserStorage()
  if (storage) clearMatch(storage)
  expedition = undefined
  scoutSelected = false
  hud.worldLocked(false)
  renderExpedition()
  renderer?.reset()
  messenger.fill('')
  syncMessenger()
  messenger.notice('You left the match. This device forgot it; your opponent still has their copy.')
}

function resume(saved: { readonly matchId: string; readonly faction: FactionId; readonly state: Expedition }): void {
  match = { id: saved.matchId, faction: saved.faction }
  syncForm(saved.state.map)
  hud.worldLocked(true)
  show(saved.state.map, saved.state)
}

const lastSender = (state: Expedition) => {
  const last = state.commands.at(-1)
  return last ? FACTIONS[last.factionId] : 'Your opponent'
}
const orderCount = (count: number) => `${count} ${count === 1 ? 'order' : 'orders'}`

async function receive(text: string): Promise<void> {
  const decoded = await decodeTurn(text)
  const reject = (reason: string) => {
    messenger.notice(reason, true)
    if (text.trim() && text.length <= MAX_REFILL_CHARS) messenger.fill(text)
  }
  if (!decoded.ok) { reject(decoded.reason); return }
  // The board can change while a code is unpacked, so it is only looked at from here on.
  const state = expedition
  if (state && !match) {
    hud.order('A solo expedition is running. Return to the atlas before opening a messenger turn.', true)
    return
  }
  let result: ReturnType<typeof receiveTurn>
  try {
    result = receiveTurn(decoded.value, match && state
      ? { matchId: match.id, faction: match.faction, commands: state.commands.map(compactCommand) }
      : undefined)
  } catch {
    reject('This turn could not be opened.')
    return
  }
  if (!result.ok) {
    if (result.kind === 'known') messenger.notice(result.reason)
    else reject(result.reason)
    return
  }
  const sender = lastSender(result.state)
  if (match) {
    expedition = result.state
    // The opponent's orders never change what this player has charted, so only the reachable area is redrawn.
    renderExpedition([])
    hud.order('Your move. Select the gold scout to begin.')
    syncMessenger()
    messenger.notice(`Received ${sender}'s turn (${orderCount(result.newOrders)}).`)
  } else {
    match = { id: result.matchId, faction: result.faction }
    syncForm(result.state.map)
    hud.worldLocked(true)
    show(result.state.map, result.state)
    hud.order('You joined the match. Select the gold scout to begin.')
    messenger.notice(`Joined as ${FACTIONS[result.faction]}. ${sender} played ${orderCount(result.newOrders)}.`)
  }
  messenger.fill('')
  persist()
}

async function openFile(file: File): Promise<void> {
  if (file.size > MAX_TURN_FILE_BYTES) {
    messenger.notice('That file is too large to be a Polaris turn.', true)
    return
  }
  let text: string
  try {
    text = await file.text()
  } catch {
    messenger.notice('That file could not be read.', true)
    return
  }
  await receive(text)
}

// A turn link carries the code after the hash, so opening it never sends the turn to any server.
function takeLinkedTurn(): void {
  const code = linkedTurn(location.hash)
  if (!code) return
  history.replaceState(null, '', location.pathname + location.search)
  void receive(code)
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
    begin(createExpedition(map))
    hud.order('Select the gold scout to begin. Sight reaches two cardinal steps.')
  } catch (error) {
    hud.error(error instanceof Error ? error.message : 'Unable to start the expedition.')
  }
})
hud.leaveExpedition.addEventListener('click', () => {
  if (match) return
  expedition = undefined
  scoutSelected = false
  renderExpedition()
  renderer?.reset()
  syncMessenger()
})
hud.selectScout.addEventListener('click', () => {
  const state = expedition
  if (!state) return
  const tileId = scoutOf(state).tileId
  renderer?.selectTile(tileId)
  renderer?.focusTile(tileId)
})
hud.moveScout.addEventListener('click', () => { if (selectedTile) move(selectedTile.id) })
hud.endTurn.addEventListener('click', () => {
  const state = expedition
  if (state) order({ type: 'end-turn', factionId: viewerOf(state), sequence: state.commands.length + 1 })
})
hud.foundCity.addEventListener('click', () => {
  const state = expedition
  if (!state) return
  const founder = state.founders.find(unit => unit.factionId === viewerOf(state))
  if (founder) order({ type: 'found-city', factionId: viewerOf(state),
    sequence: state.commands.length + 1, founderId: founder.id })
})
hud.queueProduction.addEventListener('click', () => {
  const state = expedition
  if (!state) return
  const cityId = hud.selectedCityId()
  const itemId = hud.productionChoice.value
  if (!isProductionItemId(itemId)) {
    hud.order('Choose a supported production item.', true)
    return
  }
  order({ type: 'queue-production', factionId: viewerOf(state),
    sequence: state.commands.length + 1, cityId, itemId })
})
hud.cityChoice.addEventListener('change', updateExpeditionHud)
hud.productionChoice.addEventListener('change', updateExpeditionHud)
const offsets = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] } as const
for (const direction of Object.keys(offsets) as (keyof typeof offsets)[]) {
  hud.directions[direction].addEventListener('click', () => {
    const state = expedition
    if (!state) return
    const tile = state.map.tiles[scoutOf(state).tileId]!
    const [dx, dz] = offsets[direction]
    move(tileAt(state.map, tile.x + dx, tile.z + dz)?.id ?? -1)
  })
}
window.addEventListener('hashchange', takeLinkedTurn)

const params = new URLSearchParams(location.search)
hud.inputs.seed.value = params.get('seed') ?? 'polaris'
hud.inputs.width.value = params.get('width') ?? '32'
hud.inputs.height.value = params.get('height') ?? '32'
messenger.idle(false)
const storage = browserStorage()
const saved = storage ? restoreMatch(storage) : undefined
if (saved?.ok) resume(saved)
else {
  regenerate()
  if (saved) messenger.notice(saved.reason, true)
}
takeLinkedTurn()

// Opt-in, read-only diagnostics work in production benchmarks without exposing state mutation.
if (params.get('diagnostics') === '1') {
  window.polarisDiagnostics = {
    stats: () => ({ ...renderer?.stats(), generationMs, renderSetupMs, seed: map?.seed,
      width: map?.width, height: map?.height, rngState: map?.rngState }),
    projectTile: id => renderer?.projectTile(id),
    camera: () => renderer?.cameraState(),
    expedition: () => {
      const state = expedition
      if (!state) return undefined
      const scout = scoutOf(state)
      return {
        round: state.round, movement: scout.movement, scoutTileId: scout.tileId,
        commandCount: state.commands.length,
        founders: state.founders, cities: state.cities, units: state.units,
        fog: { ...state.factions.find(item => item.id === viewerOf(state))!.fog },
        reachable: [...movementRange(state, scout.id).keys()],
      }
    },
    match: () => match && expedition ? {
      id: match.id, faction: match.faction, active: expedition.activeFaction,
      commandCount: expedition.commands.length, stateHash: stateHash(expedition),
    } : undefined,
  }
}
window.addEventListener('pagehide', event => { if (!event.persisted) renderer?.dispose() })
if (import.meta.hot) import.meta.hot.dispose(() => renderer?.dispose())
