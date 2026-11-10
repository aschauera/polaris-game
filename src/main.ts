import './style.css'
import { HEX_DIRECTIONS, hexOffsets, type HexDirection } from './game/hex'
import { generateMap, tileAt, type Tile, type WorldMap } from './game/map'
import {
  applyCommand, CITY_RULES, cityYields, createExpedition, FACTIONS, findPath, movementRange, PRODUCTION_ITEMS,
  SCOUT, visibilityAt, type Command, type Expedition, type FactionId, type ProductionItemId,
} from './game/expedition'
import { compactCommand, exportMatch, MATCH_FACTIONS, matchIdOf, receiveTurn, stateHash } from './game/match'
import { decodeTurn, encodeTurn, linkedTurn, turnLink } from './exchange/turn-code'
import {
  currentMatchId, forgetMatch, listMatches, MATCH_NAME_LIMIT, migrateLegacyMatch, restoreMatch, saveMatch, setCurrentMatch,
  type MatchSummary,
} from './exchange/match-storage'
import { WorldRenderer } from './rendering/world'
import { RESOURCES } from './rendering/resources'
import { createHud, SCREEN_DIRECTIONS, type ScreenDirection } from './ui/hud'
import { createMessengerPanel } from './ui/messenger'

const hud = createHud()
const messenger = createMessengerPanel(hud.messenger, {
  start: () => startMatch(),
  open: text => { void receive(text) },
  openFile: file => { void openFile(file) },
  resume: matchId => continueMatch(matchId),
  rename: name => renameMatch(name),
  shelve: () => shelveMatch(),
  leave: () => leaveMatch(),
})
let renderer: WorldRenderer | undefined
let map: WorldMap | undefined
let generationMs = 0
let renderSetupMs = 0
let expedition: Expedition | undefined
let selectedTile: Tile | undefined
let scoutSelected = false
// The open messenger match. A solo expedition has none and simply plays whichever faction is active.
// Other matches stay saved on this device until they are opened again.
interface OpenMatch { readonly id: string; readonly faction: FactionId; readonly name: string }
let match: OpenMatch | undefined
let outboxToken = 0

const viewerOf = (state: Expedition): FactionId => match?.faction ?? state.activeFaction
const scoutOf = (state: Expedition) => state.scouts.find(unit => unit.factionId === viewerOf(state))!
const canAct = (state: Expedition) => !match || state.activeFaction === match.faction
const turnsEnded = (state: Expedition) => state.commands.filter(command => command.type === 'end-turn').length
const bannerOf = (factionId: FactionId): 0 | 1 => factionId === 'lantern' ? 1 : 0

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
    return { id: city.id, name: city.name, x: state.map.tiles[city.tileId]!.x, z: state.map.tiles[city.tileId]!.z,
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

function resourceName(tile?: Tile): string | undefined {
  const kind = tile && renderer?.resource(tile.id)
  return kind ? RESOURCES[kind].name : undefined
}

function select(tile?: Tile): void {
  selectedTile = tile
  hud.selection(tile, resourceName(tile))
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
  } else hud.order(scoutSelected ? 'Scout selected. Choose a charted destination or use the arrows.' : 'Select the gold scout to begin.')
  updateExpeditionHud()
}

function renderExpedition(dirtyTiles?: readonly number[]): void {
  const state = expedition
  if (!state) { renderer?.setExploration(); updateExpeditionHud(); return }
  const scout = scoutOf(state)
  const viewer = viewerOf(state)
  const fog = state.factions.find(item => item.id === viewer)!.fog
  renderer?.setExploration({
    fog, scoutTileId: scout.tileId,
    // Only the active faction can move, so this stays empty while the opponent is on turn.
    reachable: [...movementRange(state, scout.id).keys()],
    // Rival cities show only while in sight; remembering them belongs to last-known-state rendering.
    settlements: state.cities.filter(city => city.factionId === viewer || fog[city.tileId] === 'visible')
      .map(city => ({ tileId: city.tileId, houses: city.population, storehouse: city.storehouse,
        banner: bannerOf(city.factionId), name: city.name, population: city.population, claimTileIds: city.claimTileIds })),
    // Own units are always shown; rival units only while their tile is in sight.
    units: [
      ...state.scouts.map(unit => ({ ...unit, kind: 'scout' as const })),
      ...state.founders.map(unit => ({ ...unit, kind: 'founder' as const })),
      ...state.units.map(unit => ({ ...unit, kind: unit.type })),
    ].filter(unit => unit.factionId === viewer || fog[unit.tileId] === 'visible')
      .map(unit => ({ tileId: unit.tileId, kind: unit.kind, banner: bannerOf(unit.factionId), rival: unit.factionId !== viewer })),
  }, dirtyTiles)
  hud.selection(selectedTile, resourceName(selectedTile))
  updateExpeditionHud()
}

// Saving also makes the match the one that reopens after a reload.
function persist(): void {
  const storage = browserStorage()
  if (!storage || !match || !expedition) return
  saveMatch(storage, { faction: match.faction, name: match.name, match: exportMatch(match.id, expedition) })
  setCurrentMatch(storage, match.id)
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
    renderer ??= new WorldRenderer(hud.canvas, select, tile => hud.hover(tile, resourceName(tile)), hud.error)
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

const matchTitle = (open: Pick<OpenMatch, 'id' | 'name'>) => open.name || `Match ${open.id.slice(0, 4).toUpperCase()}`

// The identifier travels with every turn, so both players see the same default title for a match.
function describeMatch(saved: MatchSummary) {
  const yourTurn = saved.active === saved.faction
  const when = saved.savedAt ? ` · ${new Date(saved.savedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}` : ''
  return {
    matchId: saved.matchId,
    title: matchTitle({ id: saved.matchId, name: saved.name }),
    detail: `${yourTurn ? 'Your turn' : `Waiting for ${FACTIONS[saved.active]}`} · turn ${saved.round} · you play ` +
      `${FACTIONS[saved.faction]} · ${saved.seed} ${saved.width}×${saved.height}${when}`,
    yourTurn,
  }
}

function syncMessenger(): void {
  const token = ++outboxToken
  const state = expedition
  if (!state) {
    const storage = browserStorage()
    messenger.idle(!!map, storage ? listMatches(storage).matches.map(describeMatch) : [])
    return
  }
  if (!match) { messenger.hide(); return }
  const own = FACTIONS[match.faction]
  const waiting = !canAct(state)
  const view = {
    status: `${matchTitle(match)} · ` +
      (waiting ? `You play ${own}. Waiting for ${FACTIONS[state.activeFaction]}.` : `You play ${own}. It's your turn.`),
    matchId: match.id, name: match.name, nameLimit: MATCH_NAME_LIMIT, waiting,
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
    match = { id: newMatchId(), faction: MATCH_FACTIONS[0]!, name: '' }
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

// Returns to the atlas and the match list. Whether the match stays saved is up to the caller.
function closeMatch(): void {
  match = undefined
  outboxToken++
  expedition = undefined
  scoutSelected = false
  hud.worldLocked(false)
  renderExpedition()
  renderer?.reset()
  messenger.fill('')
  syncMessenger()
}

function shelveMatch(): void {
  if (!match) return
  const storage = browserStorage()
  if (storage) setCurrentMatch(storage)
  closeMatch()
  messenger.notice(storage ? 'The match is saved. Continue it from Your matches, or open your opponent\'s next turn.'
    : 'This browser cannot keep matches. Open the latest turn from your messenger to continue this one.')
}

function leaveMatch(): void {
  if (!match) return
  const storage = browserStorage()
  if (storage) forgetMatch(storage, match.id)
  closeMatch()
  messenger.notice('You left the match. This device forgot it; your opponent still has their copy.')
}

function renameMatch(name: string): void {
  if (!match) return
  match = { ...match, name: name.trim().slice(0, MATCH_NAME_LIMIT) }
  persist()
  syncMessenger()
}

// Opens a match on its own world. Any match that was open before has been saved after its last order.
function resume(next: OpenMatch, state: Expedition): void {
  match = next
  syncForm(state.map)
  hud.worldLocked(true)
  show(state.map, state)
  const storage = browserStorage()
  if (storage) setCurrentMatch(storage, next.id)
  hud.order(canAct(state) ? 'Your move. Select the gold scout to begin.'
    : `Waiting for ${FACTIONS[state.activeFaction]}. Open their turn from your messenger to continue.`)
}

function storedMatch(matchId: string): { readonly open: OpenMatch; readonly state: Expedition } | { readonly reason: string } | undefined {
  const storage = browserStorage()
  const saved = storage ? restoreMatch(storage, matchId) : undefined
  if (!saved) return
  return saved.ok ? { open: { id: saved.matchId, faction: saved.faction, name: saved.name }, state: saved.state } : saved
}

function continueMatch(matchId: string): void {
  if (expedition) return
  const saved = storedMatch(matchId)
  if (saved && 'open' in saved) {
    resume(saved.open, saved.state)
    messenger.notice('')
    return
  }
  syncMessenger()
  messenger.notice(saved?.reason ?? 'This match is no longer saved on this device.', true)
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
  // Every turn names its match, so it is checked against that match whether or not it is the open one.
  // A saved copy that no longer verifies has been discarded, and the turn then opens the match afresh.
  const matchId = matchIdOf(decoded.value)
  const open = match && state && match.id === matchId ? { open: match, state } : undefined
  const found = open || !matchId ? undefined : storedMatch(matchId)
  const saved = found && 'open' in found ? found : undefined
  const local = open ?? saved
  let result: ReturnType<typeof receiveTurn>
  try {
    result = receiveTurn(decoded.value, local
      ? { matchId: local.open.id, faction: local.open.faction, commands: local.state.commands.map(compactCommand) }
      : undefined)
  } catch {
    reject('This turn could not be opened.')
    return
  }
  if (!result.ok) {
    if (result.kind !== 'known') { reject(result.reason); return }
    // An old message of another saved match still brings that match up.
    if (saved) resume(saved.open, saved.state)
    messenger.notice(result.reason)
    return
  }
  // Without storage the open match lives only on screen, so it is not silently replaced by another one.
  if (match && !open && !browserStorage()) {
    reject('This turn belongs to another match. This browser cannot keep matches, so choose All matches first. ' +
      'You can bring the current match back later by opening its latest turn.')
    return
  }
  const sender = lastSender(result.state)
  const received = `${sender}'s turn (${orderCount(result.newOrders)})`
  const previous = open ? undefined : match
  if (open) {
    expedition = result.state
    // The opponent's orders never change what this player has charted, so only the reachable area is redrawn.
    renderExpedition([])
    syncMessenger()
  } else {
    resume(saved?.open ?? { id: result.matchId, faction: result.faction, name: '' }, result.state)
  }
  hud.order(local ? 'Your move. Select the gold scout to begin.' : 'You joined the match. Select the gold scout to begin.')
  const switched = previous ? ` ${matchTitle(previous)} stays saved under All matches.` : ''
  const lost = found && !('open' in found) ? `${found.reason} ` : ''
  messenger.notice(open ? `Received ${received}.`
    : saved ? `Opened ${matchTitle(saved.open)} and received ${received}.${switched}`
      : `${lost}Joined as ${FACTIONS[result.faction]}. ${sender} played ${orderCount(result.newOrders)}.${switched}`)
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
    hud.order('Select the gold scout to begin. Sight reaches two hexes in every direction.')
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
// The camera looks along the south-east axis, so each pad arrow maps to a fixed hex neighbour.
const SCREEN_HEX: Record<ScreenDirection, HexDirection> = {
  'up-left': 'north-east', up: 'north-west', 'up-right': 'west',
  'down-left': 'east', down: 'south-east', 'down-right': 'south-west',
}
for (const direction of SCREEN_DIRECTIONS) {
  hud.directions[direction].addEventListener('click', () => {
    const state = expedition
    if (!state) return
    const tile = state.map.tiles[scoutOf(state).tileId]!
    const [dx, dz] = hexOffsets(tile.z)[HEX_DIRECTIONS.indexOf(SCREEN_HEX[direction])]!
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
const problems: string[] = []
if (storage) {
  migrateLegacyMatch(storage)
  problems.push(...listMatches(storage).discarded.map(reason => `A saved match was discarded. ${reason}`))
}
const current = storage ? currentMatchId(storage) : undefined
const saved = current ? storedMatch(current) : undefined
if (saved && 'open' in saved) resume(saved.open, saved.state)
else {
  regenerate()
  if (saved) problems.push(saved.reason)
}
if (problems.length) messenger.notice(problems.join(' '), true)
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
      id: match.id, faction: match.faction, name: match.name, active: expedition.activeFaction,
      commandCount: expedition.commands.length, stateHash: stateHash(expedition),
    } : undefined,
  }
}
window.addEventListener('pagehide', event => { if (!event.persisted) renderer?.dispose() })
if (import.meta.hot) import.meta.hot.dispose(() => renderer?.dispose())
