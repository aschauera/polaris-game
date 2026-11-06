import './style.css'
import { generateMap, tileAt, type Tile, type WorldMap } from './game/map'
import {
  applyCommand, createExpedition, FACTIONS, findPath, movementRange, SCOUT, visibilityAt,
  type Command, type Expedition,
} from './game/expedition'
import { WorldRenderer, type RenderMap } from './rendering/world'
import { createHud } from './ui/hud'
import { OnlineClient, type ConnectionState } from './network/client'
import type { PlayerView } from './network/protocol'

const hud = createHud()
let renderer: WorldRenderer | undefined
let map: WorldMap | undefined
let generationMs = 0
let renderSetupMs = 0
let expedition: Expedition | undefined
let selectedTile: Tile | undefined
let scoutSelected = false
let onlineView: PlayerView | undefined
let connection: ConnectionState = { connected: false, busy: false, message: '' }

function displayMap(view: PlayerView): RenderMap {
  const known = new Map(view.tiles.map(tile => [tile.id, tile]))
  return { width: view.width, height: view.height,
    tiles: Array.from({ length: view.width * view.height }, (_, id): Tile =>
      known.get(id) ?? { id, x: id % view.width, z: Math.floor(id / view.width), terrain: 'grassland', elevation: 1, trees: 0 }) }
}

function returnToAtlas(): void {
  onlineView = undefined
  expedition = undefined
  scoutSelected = false
  client.pause()
  hud.online()
  if (map) { renderer?.setMap(map); hud.loaded(map) }
  renderExpedition()
}

const client = new OnlineClient(view => {
  if (!view) { if (onlineView) returnToAtlas(); return }
  const sameRoom = onlineView?.roomId === view.roomId
  const wasWaiting = onlineView?.status === 'waiting'
  onlineView = view
  expedition = undefined
  if (!sameRoom) scoutSelected = false
  try {
    renderer ??= new WorldRenderer(hud.canvas, select, hud.hover, hud.error)
    renderer.setMap(displayMap(view), sameRoom)
    const visible = new Set(view.visible)
    renderer.setExploration({ fog: Object.fromEntries(view.tiles.map(tile => [tile.id, visible.has(tile.id) ? 'visible' : 'explored'])),
      scoutTileId: view.scout.tileId, reachable: view.moves.map(move => move.tileId),
      opponents: view.opponents.map(unit => unit.tileId) })
    if (!sameRoom) renderer.focusTile(view.scout.tileId)
    if (scoutSelected) renderer.selectTile(view.scout.tileId)
    hud.online(view)
    if (view.status === 'active' && (!sameRoom || wasWaiting)) hud.networkPanel.open = false
    updateExpeditionHud()
  } catch (error) { hud.error(error instanceof Error ? error.message : 'Unable to render the online world.') }
}, state => { connection = state; hud.connection(state); updateExpeditionHud() }, reply => {
  if (reply.invite) hud.invitation(reply.invite)
  if (reply.message) hud.order(reply.message)
})

function updateExpeditionHud(): void {
  if (onlineView) {
    const view = onlineView
    hud.expedition({ faction: FACTIONS[view.factionId], activeFaction: FACTIONS[view.activeFaction],
      round: view.round, movement: view.scout.movement, maxMovement: SCOUT.movement,
      discovered: view.tiles.length, total: view.width * view.height, scoutSelected,
      canOrder: scoutSelected && selectedTile?.id !== view.scout.tileId && view.moves.some(move => move.tileId === selectedTile?.id),
      canAct: view.status === 'active' && view.activeFaction === view.factionId && connection.connected && !connection.busy })
    return
  }
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
  if (onlineView) {
    if (tile?.id === onlineView.scout.tileId) scoutSelected = true
    const route = onlineView.moves.find(move => move.tileId === tile?.id)
    hud.order(route && tile?.id !== onlineView.scout.tileId ? `Visible destination. Cost: ${route.cost}. Choose Move scout here.`
      : 'Select your gold scout and a reachable visible tile. Orders are available only on your turn.')
    updateExpeditionHud()
    return
  }
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
  if (onlineView && scoutSelected) { void client.command({ type: 'move', to }); return }
  if (!expedition || !scoutSelected) return
  order({ type: 'move', factionId: expedition.activeFaction, sequence: expedition.commands.length + 1,
    unitId: expedition.scouts[0]!.id, to })
}

function regenerate(): void {
  if (onlineView) return
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
  if (!map || !renderer || onlineView) return
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
  if (onlineView) { returnToAtlas(); return }
  expedition = undefined
  scoutSelected = false
  renderExpedition()
  renderer?.reset()
})
hud.selectScout.addEventListener('click', () => {
  if (onlineView) { renderer?.selectTile(onlineView.scout.tileId); renderer?.focusTile(onlineView.scout.tileId); return }
  if (!expedition) return
  renderer?.selectTile(expedition.scouts[0]!.tileId)
  renderer?.focusTile(expedition.scouts[0]!.tileId)
})
hud.moveScout.addEventListener('click', () => { if (selectedTile) move(selectedTile.id) })
hud.endTurn.addEventListener('click', () => {
  if (onlineView) { void client.command({ type: 'end-turn' }); return }
  if (expedition) order({ type: 'end-turn', factionId: expedition.activeFaction, sequence: expedition.commands.length + 1 })
})
const offsets = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] } as const
for (const direction of Object.keys(offsets) as (keyof typeof offsets)[]) {
  hud.directions[direction].addEventListener('click', () => {
    if (onlineView) {
      const view = onlineView
      const tile = view.tiles.find(tile => tile.id === view.scout.tileId)!
      const [dx, dz] = offsets[direction]
      const x = tile.x + dx, z = tile.z + dz
      if (x < 0 || z < 0 || x >= onlineView.width || z >= onlineView.height) { hud.order('Destination is outside the map.', true); return }
      move(z * onlineView.width + x)
      return
    }
    if (!expedition) return
    const tile = expedition.map.tiles[expedition.scouts[0]!.tileId]!
    const [dx, dz] = offsets[direction]
    move(tileAt(expedition.map, tile.x + dx, tile.z + dz)?.id ?? -1)
  })
}
hud.resumeOnline.addEventListener('click', () => { void client.connect() })
hud.createRoom.addEventListener('click', () => { void client.create() })
hud.joinRoom.addEventListener('click', () => { void client.join(hud.joinCode.value.trim()) })
hud.replaceInvite.addEventListener('click', () => { void client.replaceInvite() })
hud.forgetSession.addEventListener('click', () => {
  if (window.confirm('Permanently forget this device seat? You cannot recover it or rejoin the same game.')) void client.forget()
})
hud.copyInvite.addEventListener('click', () => {
  void navigator.clipboard.writeText(hud.shareInvite.value).then(() => hud.connection({ ...connection, message: 'Invitation copied. Share it privately.' }))
    .catch(() => { hud.shareInvite.select(); hud.connection({ ...connection, message: 'Clipboard unavailable. Copy the selected link manually.' }) })
})

const params = new URLSearchParams(location.search)
hud.inputs.seed.value = params.get('seed') ?? 'polaris'
hud.inputs.width.value = params.get('width') ?? '32'
hud.inputs.height.value = params.get('height') ?? '32'
regenerate()
const invitation = new URLSearchParams(location.hash.slice(1)).get('invite')
if (invitation) {
  history.replaceState(null, '', `${location.pathname}${location.search}`)
  hud.joinCode.value = invitation
  hud.networkPanel.open = true
  hud.connection({ ...connection, message: 'Invitation received. Choose Join game to accept it.' })
} else if (client.shouldResume()) void client.connect()

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js').catch(error => {
    hud.connection({ ...connection, message: `Offline installation unavailable: ${error instanceof Error ? error.message : 'service worker failed'}` })
  })
}

// Opt-in, read-only diagnostics work in production benchmarks without exposing state mutation.
if (params.get('diagnostics') === '1') {
  window.polarisDiagnostics = {
    stats: () => ({ ...renderer?.stats(), generationMs, renderSetupMs, seed: onlineView ? undefined : map?.seed,
      width: onlineView?.width ?? map?.width, height: onlineView?.height ?? map?.height, rngState: onlineView ? undefined : map?.rngState }),
    online: () => onlineView ? structuredClone(onlineView) : undefined,
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
if (import.meta.hot) import.meta.hot.dispose(() => { renderer?.dispose(); client.dispose() })
