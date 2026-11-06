import type { Terrain, Tile, WorldMap } from './map'

export const RULES_VERSION = 1
export const SCOUT = Object.freeze({ movement: 4, sight: 2 })
export const MOVEMENT_COST: Readonly<Record<Terrain, number>> = Object.freeze({ grassland: 1, hills: 2, water: Infinity })
export const FACTIONS = Object.freeze({ meridian: 'Meridian Union', lantern: 'Lantern Compact' })
export type FactionId = keyof typeof FACTIONS
export type Visibility = 'unseen' | 'explored' | 'visible'
export interface Scout {
  readonly id: string
  readonly factionId: FactionId
  readonly tileId: number
  readonly movement: number
}
export interface Faction {
  readonly id: FactionId
  readonly fog: Readonly<Record<number, Exclude<Visibility, 'unseen'>>>
}
interface Order { readonly factionId: FactionId; readonly sequence: number }
export type Command = Order & (
  { readonly type: 'move'; readonly unitId: string; readonly to: number } |
  { readonly type: 'end-turn' }
)
export interface Expedition {
  readonly rulesVersion: typeof RULES_VERSION
  readonly map: WorldMap
  readonly rngState: number
  readonly round: number
  readonly activeFaction: FactionId
  readonly factions: readonly Faction[]
  readonly scouts: readonly Scout[]
  readonly commands: readonly Command[]
}
export interface Route { readonly path: readonly number[]; readonly cost: number }
export type CommandResult =
  | { readonly ok: false; readonly state: Expedition; readonly reason: string }
  | { readonly ok: true; readonly state: Expedition; readonly dirtyTiles: readonly number[]; readonly message: string }

export function neighbors(map: WorldMap, id: number): number[] {
  if (!Number.isInteger(id) || !map.tiles[id]) return []
  const { x, z } = map.tiles[id]!
  const result: number[] = []
  if (z > 0) result.push(id - map.width)
  if (x + 1 < map.width) result.push(id + 1)
  if (z + 1 < map.height) result.push(id + map.width)
  if (x > 0) result.push(id - 1)
  return result
}

export function visibilityAt(state: Expedition, factionId: FactionId, id: number): Visibility {
  return state.factions.find(faction => faction.id === factionId)?.fog[id] ?? 'unseen'
}

export function knownTile(state: Expedition, factionId: FactionId, id: number): Tile | undefined {
  return visibilityAt(state, factionId, id) === 'unseen' ? undefined : state.map.tiles[id]
}

function distance(map: WorldMap, a: number, b: number): number {
  const start = map.tiles[a]!, end = map.tiles[b]!
  return Math.abs(start.x - end.x) + Math.abs(start.z - end.z)
}

function sight(map: WorldMap, id: number): number[] {
  const tile = map.tiles[id]!
  const ids: number[] = []
  for (let z = Math.max(0, tile.z - SCOUT.sight); z <= Math.min(map.height - 1, tile.z + SCOUT.sight); z++) {
    for (let x = Math.max(0, tile.x - SCOUT.sight); x <= Math.min(map.width - 1, tile.x + SCOUT.sight); x++) {
      if (Math.abs(x - tile.x) + Math.abs(z - tile.z) <= SCOUT.sight) ids.push(z * map.width + x)
    }
  }
  return ids
}

function startingTiles(map: WorldMap, count: number): number[] {
  const visited = new Set<number>()
  let largest: number[] = []
  for (const tile of map.tiles) {
    if (tile.terrain === 'water' || visited.has(tile.id)) continue
    const component = [tile.id]
    visited.add(tile.id)
    for (let index = 0; index < component.length; index++) {
      for (const id of neighbors(map, component[index]!)) {
        if (map.tiles[id]!.terrain !== 'water' && !visited.has(id)) {
          visited.add(id)
          component.push(id)
        }
      }
    }
    if (component.length > largest.length) largest = component
  }
  if (largest.length < count) throw new Error('This world has too little connected land for an expedition.')
  const center = (Math.floor(map.height / 2) * map.width) + Math.floor(map.width / 2)
  largest.sort((a, b) => distance(map, a, center) - distance(map, b, center) || a - b)
  const starts = [largest[0]!]
  while (starts.length < count) {
    const candidates = largest.filter(id => !starts.includes(id))
    candidates.sort((a, b) =>
      Math.min(...starts.map(id => distance(map, b, id))) - Math.min(...starts.map(id => distance(map, a, id))) || a - b)
    starts.push(candidates[0]!)
  }
  return starts
}

export function createExpedition(map: WorldMap, factionIds: readonly FactionId[] = ['meridian']): Expedition {
  if (!factionIds.length || new Set(factionIds).size !== factionIds.length ||
    factionIds.some(id => !Object.hasOwn(FACTIONS, id))) throw new Error('Choose unique supported factions for the expedition.')
  const starts = startingTiles(map, factionIds.length)
  const scouts = factionIds.map((factionId, index) =>
    Object.freeze({ id: `scout-${factionId}`, factionId, tileId: starts[index]!, movement: SCOUT.movement }))
  const factions = factionIds.map((id, index) => {
    const fog: Record<number, 'visible'> = {}
    for (const tileId of sight(map, starts[index]!)) fog[tileId] = 'visible'
    return Object.freeze({ id, fog: Object.freeze(fog) })
  })
  return Object.freeze({
    rulesVersion: RULES_VERSION, map, rngState: map.rngState, round: 1, activeFaction: factionIds[0]!,
    factions: Object.freeze(factions), scouts: Object.freeze(scouts), commands: Object.freeze([]),
  })
}

interface SearchNode { id: number; cost: number; priority: number; order: number }

// Equal priorities use insertion order; neighbors are always north, east, south, west.
class Frontier {
  private readonly heap: SearchNode[] = []
  private before(a: SearchNode, b: SearchNode): boolean {
    return a.priority < b.priority || (a.priority === b.priority && a.order < b.order)
  }
  push(node: SearchNode): void {
    let index = this.heap.length
    this.heap.push(node)
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (!this.before(node, this.heap[parent]!)) break
      this.heap[index] = this.heap[parent]!
      index = parent
    }
    this.heap[index] = node
  }
  pop(): SearchNode | undefined {
    const first = this.heap[0], last = this.heap.pop()
    if (!first || !last || !this.heap.length) return first
    let index = 0
    while (index * 2 + 1 < this.heap.length) {
      let child = index * 2 + 1
      if (child + 1 < this.heap.length && this.before(this.heap[child + 1]!, this.heap[child]!)) child++
      if (!this.before(this.heap[child]!, last)) break
      this.heap[index] = this.heap[child]!
      index = child
    }
    this.heap[index] = last
    return first
  }
}

function search(state: Expedition, scout: Scout, goal?: number) {
  const frontier = new Frontier()
  const costs = new Map<number, number>([[scout.tileId, 0]])
  const parents = new Map<number, number>()
  const occupied = new Set(state.scouts.filter(other => other.id !== scout.id).map(other => other.tileId))
  const fog = state.factions.find(faction => faction.id === scout.factionId)!.fog
  let order = 0
  frontier.push({ id: scout.tileId, cost: 0, priority: 0, order: order++ })
  for (let current = frontier.pop(); current; current = frontier.pop()) {
    if (current.cost !== costs.get(current.id)) continue
    if (current.id === goal) break
    for (const id of neighbors(state.map, current.id)) {
      if (!fog[id] || occupied.has(id)) continue
      const cost = current.cost + MOVEMENT_COST[state.map.tiles[id]!.terrain]
      if (cost > scout.movement || cost >= (costs.get(id) ?? Infinity)) continue
      costs.set(id, cost)
      parents.set(id, current.id)
      frontier.push({ id, cost, priority: cost + (goal === undefined ? 0 : distance(state.map, id, goal)), order: order++ })
    }
  }
  return { costs, parents }
}

export function movementRange(state: Expedition, unitId: string): ReadonlyMap<number, number> {
  const scout = state.scouts.find(unit => unit.id === unitId)
  if (!scout || scout.factionId !== state.activeFaction) return new Map()
  return search(state, scout).costs
}

export function findPath(state: Expedition, unitId: string, to: number): Route | undefined {
  const scout = state.scouts.find(unit => unit.id === unitId)
  if (!scout || scout.factionId !== state.activeFaction || !Number.isInteger(to) ||
    !knownTile(state, scout.factionId, to)) return
  const { costs, parents } = search(state, scout, to)
  const cost = costs.get(to)
  if (cost === undefined) return
  const path = [to]
  while (path[0] !== scout.tileId) path.unshift(parents.get(path[0]!)!)
  return { path: Object.freeze(path), cost }
}

function moveFog(state: Expedition, scout: Scout, path: readonly number[], scouts: readonly Scout[]) {
  const faction = state.factions.find(faction => faction.id === scout.factionId)!
  const fog = { ...faction.fog }
  const affected = new Set<number>(sight(state.map, scout.tileId))
  for (const id of affected) fog[id] = 'explored'
  for (const id of path) {
    for (const seen of sight(state.map, id)) {
      affected.add(seen)
      fog[seen] = 'explored'
    }
  }
  for (const unit of scouts) {
    if (unit.factionId !== scout.factionId) continue
    for (const seen of sight(state.map, unit.tileId)) {
      affected.add(seen)
      fog[seen] = 'visible'
    }
  }
  const dirtyTiles = [...affected].filter(id => fog[id] !== faction.fog[id]).sort((a, b) => a - b)
  const factions = state.factions.map(item => item === faction ? Object.freeze({ ...item, fog: Object.freeze(fog) }) : item)
  return { factions: Object.freeze(factions), dirtyTiles: Object.freeze(dirtyTiles) }
}

export function applyCommand(state: Expedition, command: Command): CommandResult {
  const reject = (reason: string): CommandResult => ({ ok: false, state, reason })
  if (command.factionId !== state.activeFaction) return reject('It is not this faction\'s turn.')
  if (command.sequence !== state.commands.length + 1) return reject('This order is stale. Choose an order for the current turn.')
  const commands = Object.freeze([...state.commands, Object.freeze({ ...command })])
  if (command.type === 'end-turn') {
    const index = state.factions.findIndex(faction => faction.id === state.activeFaction)
    const next = (index + 1) % state.factions.length
    const activeFaction = state.factions[next]!.id
    const scouts = Object.freeze(state.scouts.map(scout => scout.factionId === activeFaction
      ? Object.freeze({ ...scout, movement: SCOUT.movement }) : scout))
    return { ok: true, state: Object.freeze({ ...state, commands, scouts, activeFaction,
      round: state.round + Number(next === 0) }), dirtyTiles: [],
    message: `${FACTIONS[activeFaction]} is ready. Movement restored.` }
  }
  if (command.type !== 'move') return reject('Unknown expedition order.')
  const scout = state.scouts.find(unit => unit.id === command.unitId)
  if (!scout || scout.factionId !== command.factionId) return reject('Choose a scout belonging to the active faction.')
  if (!Number.isInteger(command.to) || !state.map.tiles[command.to]) return reject('Choose a tile inside the map.')
  const tile = knownTile(state, command.factionId, command.to)
  if (!tile) return reject('That territory is uncharted. Explore closer before issuing an order.')
  if (command.to === scout.tileId) return reject('The scout is already on that tile.')
  if (tile.terrain === 'water') return reject('Scouts cannot cross water.')
  if (state.scouts.some(unit => unit.tileId === command.to)) return reject('The destination is occupied.')
  const route = findPath(state, scout.id, command.to)
  if (!route) return reject('No known, unoccupied route fits the remaining movement. End the turn or choose a closer tile.')
  const scouts = Object.freeze(state.scouts.map(unit => unit === scout
    ? Object.freeze({ ...unit, tileId: command.to, movement: unit.movement - route.cost }) : unit))
  const { factions, dirtyTiles } = moveFog(state, scout, route.path, scouts)
  return { ok: true, state: Object.freeze({ ...state, commands, scouts, factions }), dirtyTiles,
    message: `Scout moved to (${tile.x}, ${tile.z}). Used ${route.cost} movement.` }
}
