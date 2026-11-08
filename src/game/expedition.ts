import type { Terrain, Tile, WorldMap } from './map'

export const RULES_VERSION = 2
export const SCOUT = Object.freeze({ movement: 4, sight: 2 })
export const MOVEMENT_COST: Readonly<Record<Terrain, number>> = Object.freeze({ grassland: 1, hills: 2, water: Infinity })
export const FACTIONS = Object.freeze({ meridian: 'Meridian Union', lantern: 'Lantern Compact' })
export const CITY_RULES = Object.freeze({
  claimRadius: 1,
  minimumSpacing: 5,
  maximumPerFaction: 2,
  foodPerPopulation: 2,
  growthBase: 8,
  growthPerPopulation: 4,
  storehouseMaterialBonus: 1,
  terrainYield: Object.freeze({
    grassland: Object.freeze({ food: 2, materials: 1 }),
    hills: Object.freeze({ food: 1, materials: 2 }),
    water: Object.freeze({ food: 0, materials: 0 }),
  }),
})
export const PRODUCTION_ITEMS = Object.freeze({
  guard: Object.freeze({ name: 'Guard', cost: 8, kind: 'unit' }),
  worker: Object.freeze({ name: 'Worker', cost: 10, kind: 'unit' }),
  storehouse: Object.freeze({ name: 'Storehouse', cost: 12, kind: 'building' }),
} as const)
export type ProductionItemId = keyof typeof PRODUCTION_ITEMS
export type FactionId = keyof typeof FACTIONS
export type Visibility = 'unseen' | 'explored' | 'visible'
export interface Scout {
  readonly id: string
  readonly factionId: FactionId
  readonly tileId: number
  readonly movement: number
}
export interface Founder {
  readonly id: string
  readonly factionId: FactionId
  readonly tileId: number
}
export interface ProducedUnit {
  readonly id: string
  readonly factionId: FactionId
  readonly type: 'guard' | 'worker'
  readonly tileId: number
}
export interface City {
  readonly id: string
  readonly factionId: FactionId
  readonly tileId: number
  readonly claimTileIds: readonly number[]
  readonly population: number
  readonly food: number
  readonly materials: number
  readonly production: { readonly itemId: ProductionItemId; readonly progress: number } | undefined
  readonly storehouse: boolean
}
export interface Faction {
  readonly id: FactionId
  readonly fog: Readonly<Record<number, Exclude<Visibility, 'unseen'>>>
}
interface Order { readonly factionId: FactionId; readonly sequence: number }
export type Command = Order & (
  { readonly type: 'move'; readonly unitId: string; readonly to: number } |
  { readonly type: 'found-city'; readonly founderId: string } |
  { readonly type: 'queue-production'; readonly cityId: string; readonly itemId: ProductionItemId } |
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
  readonly founders: readonly Founder[]
  readonly units: readonly ProducedUnit[]
  readonly cities: readonly City[]
  readonly nextCityId: number
  readonly nextUnitId: number
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
  const occupied = new Set(starts)
  const founders = factionIds.map((factionId, index) => {
    const tileId = neighbors(map, starts[index]!).find(id =>
      map.tiles[id]!.terrain !== 'water' && !occupied.has(id))
    if (tileId === undefined) throw new Error('This world has too little connected land for each faction to place a founder.')
    occupied.add(tileId)
    return Object.freeze({ id: `founder-${factionId}`, factionId, tileId })
  })
  const scouts = factionIds.map((factionId, index) =>
    Object.freeze({ id: `scout-${factionId}`, factionId, tileId: starts[index]!, movement: SCOUT.movement }))
  const factions = factionIds.map((id, index) => {
    const fog: Record<number, 'visible'> = {}
    for (const tileId of sight(map, starts[index]!)) fog[tileId] = 'visible'
    return Object.freeze({ id, fog: Object.freeze(fog) })
  })
  return Object.freeze({
    rulesVersion: RULES_VERSION, map, rngState: map.rngState, round: 1, activeFaction: factionIds[0]!,
    factions: Object.freeze(factions), scouts: Object.freeze(scouts), founders: Object.freeze(founders),
    units: Object.freeze([]), cities: Object.freeze([]), nextCityId: 1, nextUnitId: 1,
    commands: Object.freeze([]),
  })
}

function claimedTiles(map: WorldMap, center: number): number[] {
  const origin = map.tiles[center]!
  return map.tiles.filter(tile => tile.terrain !== 'water' &&
    Math.abs(tile.x - origin.x) + Math.abs(tile.z - origin.z) <= CITY_RULES.claimRadius)
    .map(tile => tile.id)
}

export function cityYields(state: Expedition, city: City): { readonly food: number; readonly materials: number } {
  const result = city.claimTileIds.reduce((total, id) => {
    const yieldForTerrain = CITY_RULES.terrainYield[state.map.tiles[id]!.terrain]
    return { food: total.food + yieldForTerrain.food, materials: total.materials + yieldForTerrain.materials }
  }, { food: 0, materials: city.storehouse ? CITY_RULES.storehouseMaterialBonus : 0 })
  return Object.freeze(result)
}

function occupiedTiles(state: Expedition): Set<number> {
  return new Set([
    ...state.scouts.map(unit => unit.tileId),
    ...state.founders.map(unit => unit.tileId),
    ...state.units.map(unit => unit.tileId),
  ])
}

function productionPlacement(state: Expedition, city: City, occupied: ReadonlySet<number>): number | undefined {
  return neighbors(state.map, city.tileId).find(id =>
    state.map.tiles[id]!.terrain !== 'water' && !occupied.has(id))
}

function completeProduction(state: Expedition, city: City, units: ProducedUnit[], nextUnitId: number) {
  const itemId = city.production!.itemId
  if (itemId === 'storehouse') {
    return { city: Object.freeze({ ...city, production: undefined, storehouse: true }),
      units, nextUnitId, completed: PRODUCTION_ITEMS[itemId].name }
  }
  const tileId = productionPlacement(state, city, occupiedTiles({ ...state, units }))
  if (tileId === undefined) return { city, units, nextUnitId, completed: undefined }
  const unit = Object.freeze({ id: `unit-${city.factionId}-${nextUnitId}`, factionId: city.factionId,
    type: itemId, tileId })
  units.push(unit)
  return { city: Object.freeze({ ...city, production: undefined }),
    units, nextUnitId: nextUnitId + 1, completed: PRODUCTION_ITEMS[itemId].name }
}

function resolveCity(state: Expedition, city: City, units: ProducedUnit[], nextUnitId: number) {
  const yields = cityYields(state, city)
  const availableFood = city.food + yields.food
  const requiredFood = city.population * CITY_RULES.foodPerPopulation
  const fed = availableFood >= requiredFood
  let food = Math.max(0, availableFood - requiredFood)
  let population = city.population
  if (fed && food >= CITY_RULES.growthBase + population * CITY_RULES.growthPerPopulation) {
    food -= CITY_RULES.growthBase + population * CITY_RULES.growthPerPopulation
    population++
  }
  let materials = city.materials + yields.materials
  let production = city.production
  if (production) {
    const cost = PRODUCTION_ITEMS[production.itemId].cost
    const spent = Math.min(materials, cost - production.progress)
    materials -= spent
    production = Object.freeze({ ...production, progress: production.progress + spent })
  }
  let updated = Object.freeze({ ...city, food, materials, population, production })
  let completed: string | undefined
  if (production && production.progress >= PRODUCTION_ITEMS[production.itemId].cost) {
    const result = completeProduction(state, updated, units, nextUnitId)
    updated = result.city
    nextUnitId = result.nextUnitId
    completed = result.completed
  }
  const message = `${city.id}: +${yields.food} food, +${yields.materials} materials; ` +
    `${fed ? 'population fed' : 'insufficient food—population did not grow'}` +
    (population > city.population ? ` and grew to ${population}` : '') +
    (completed ? `; completed ${completed}` : '')
  return { city: updated, units, nextUnitId, message }
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
  const occupied = occupiedTiles(state)
  occupied.delete(scout.tileId)
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
    const units = [...state.units]
    let nextUnitId = state.nextUnitId
    const resolutions = state.cities.filter(city => city.factionId === state.activeFaction).map(city => {
      const result = resolveCity(state, city, units, nextUnitId)
      nextUnitId = result.nextUnitId
      return result
    })
    const resolvedCities = new Map(resolutions.map(result => [result.city.id, result.city]))
    const cities = state.cities.map(city => resolvedCities.get(city.id) ?? city)
    const index = state.factions.findIndex(faction => faction.id === state.activeFaction)
    const next = (index + 1) % state.factions.length
    const activeFaction = state.factions[next]!.id
    const scouts = Object.freeze(state.scouts.map(scout => scout.factionId === activeFaction
      ? Object.freeze({ ...scout, movement: SCOUT.movement }) : scout))
    return { ok: true, state: Object.freeze({ ...state, commands, scouts, cities: Object.freeze(cities),
      units: Object.freeze(units), nextUnitId, activeFaction,
      round: state.round + Number(next === 0) }), dirtyTiles: [],
    message: `${resolutions.map(result => result.message).join(' ')}${resolutions.length ? ' ' : ''}` +
      `${FACTIONS[activeFaction]} is ready. Movement restored.` }
  }
  if (command.type === 'found-city') {
    const founder = state.founders.find(unit => unit.id === command.founderId)
    if (!founder || founder.factionId !== command.factionId) return reject('Choose a founder belonging to the active faction.')
    if (state.cities.filter(city => city.factionId === command.factionId).length >= CITY_RULES.maximumPerFaction) {
      return reject(`A faction may found at most ${CITY_RULES.maximumPerFaction} cities.`)
    }
    const tile = state.map.tiles[founder.tileId]!
    if (!knownTile(state, founder.factionId, founder.tileId)) return reject('The founder cannot settle uncharted territory.')
    if (tile.terrain === 'water') return reject('Cities can only be founded on land.')
    if (state.cities.some(city => distance(state.map, city.tileId, founder.tileId) < CITY_RULES.minimumSpacing)) {
      return reject(`Cities must be at least ${CITY_RULES.minimumSpacing} tiles apart.`)
    }
    const claimTileIds = claimedTiles(state.map, founder.tileId)
    const claimed = new Set(state.cities.flatMap(city => city.claimTileIds))
    if (claimTileIds.some(id => claimed.has(id))) return reject('A city cannot claim territory owned by another city.')
    const city = Object.freeze({
      id: `city-${command.factionId}-${state.nextCityId}`, factionId: command.factionId,
      tileId: founder.tileId, claimTileIds: Object.freeze(claimTileIds), population: 1,
      food: 0, materials: 0, production: undefined, storehouse: false,
    })
    const founders = Object.freeze(state.founders.filter(unit => unit !== founder))
    return { ok: true, state: Object.freeze({ ...state, commands,
      founders, cities: Object.freeze([...state.cities, city]), nextCityId: state.nextCityId + 1 }),
    dirtyTiles: [], message: `${FACTIONS[command.factionId]} founded a city at (${tile.x}, ${tile.z}).` }
  }
  if (command.type === 'queue-production') {
    const city = state.cities.find(item => item.id === command.cityId)
    if (!city || city.factionId !== command.factionId) return reject('Choose a city belonging to the active faction.')
    if (!Object.hasOwn(PRODUCTION_ITEMS, command.itemId)) return reject('Choose a supported production item.')
    if (city.production) return reject('This city already has an item in its production queue.')
    if (command.itemId === 'storehouse' && city.storehouse) return reject('This city already has a storehouse.')
    const production = Object.freeze({ itemId: command.itemId, progress: 0 })
    const cities = Object.freeze(state.cities.map(item => item === city ? Object.freeze({ ...item, production }) : item))
    return { ok: true, state: Object.freeze({ ...state, commands, cities }), dirtyTiles: [],
      message: `${PRODUCTION_ITEMS[command.itemId].name} queued in ${city.id} (${PRODUCTION_ITEMS[command.itemId].cost} materials).` }
  }
  if (command.type !== 'move') return reject('Unknown expedition order.')
  const scout = state.scouts.find(unit => unit.id === command.unitId)
  if (!scout || scout.factionId !== command.factionId) return reject('Choose a scout belonging to the active faction.')
  if (!Number.isInteger(command.to) || !state.map.tiles[command.to]) return reject('Choose a tile inside the map.')
  const tile = knownTile(state, command.factionId, command.to)
  if (!tile) return reject('That territory is uncharted. Explore closer before issuing an order.')
  if (command.to === scout.tileId) return reject('The scout is already on that tile.')
  if (tile.terrain === 'water') return reject('Scouts cannot cross water.')
  if ([...state.scouts, ...state.founders, ...state.units].some(unit => unit.tileId === command.to)) {
    return reject('The destination is occupied.')
  }
  const route = findPath(state, scout.id, command.to)
  if (!route) return reject('No known, unoccupied route fits the remaining movement. End the turn or choose a closer tile.')
  const scouts = Object.freeze(state.scouts.map(unit => unit === scout
    ? Object.freeze({ ...unit, tileId: command.to, movement: unit.movement - route.cost }) : unit))
  const { factions, dirtyTiles } = moveFog(state, scout, route.path, scouts)
  return { ok: true, state: Object.freeze({ ...state, commands, scouts, factions }), dirtyTiles,
    message: `Scout moved to (${tile.x}, ${tile.z}). Used ${route.cost} movement.` }
}
